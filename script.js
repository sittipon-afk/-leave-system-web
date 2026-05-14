const uploader = document.getElementById('uploader');
const previewContainer = document.getElementById('preview-container');
const statusDiv = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const tableBody = document.querySelector('#resultTable tbody');

// ตั้งค่า Worker ของ PDF.js ให้ชี้ไปที่ CDN (จำเป็นสำหรับ GitHub Pages)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let extractedData = [];

uploader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        alert('กรุณาเลือกไฟล์ PDF เท่านั้น');
        return;
    }

    // Reset UI
    previewContainer.innerHTML = '';
    tableBody.innerHTML = '';
    extractedData = [];
    downloadBtn.disabled = true;
    statusDiv.innerText = 'กำลังแปลง PDF เป็นรูปภาพ...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const totalPages = pdf.numPages;
        
        statusDiv.innerText = `พบ ${totalPages} หน้า กำลังประมวลผล...`;

        // วนลูปทุกหน้าใน PDF
        for (let i = 1; i <= totalPages; i++) {
            statusDiv.innerText = `กำลังอ่านหน้า ${i} จาก ${totalPages}...`;
            
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Scale 2.0 เพื่อความชัดเจนของ OCR

            // สร้าง Canvas เพื่อวาดรูปจาก PDF
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            // แสดงตัวอย่างรูปภาพ (Optional)
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            img.className = 'page-preview';
            img.style.maxHeight = '200px'; // ย่อโชว์เฉพาะพอเห็น
            previewContainer.appendChild(img);

            // ทำ OCR กับรูปภาพนี้
            const textFromPage = await runOCR(canvas);
            const parsedData = parseBankStatement(textFromPage);
            extractedData = [...extractedData, ...parsedData];
        }

        renderTable(extractedData);
        statusDiv.innerText = 'เสร็จสิ้น! พร้อมดาวน์โหลด';
        downloadBtn.disabled = false;

    } catch (error) {
        console.error(error);
        statusDiv.innerText = 'เกิดข้อผิดพลาด: ' + error.message;
    }
});

async function runOCR(canvas) {
    return new Promise((resolve, reject) => {
        Tesseract.recognize(
            canvas,
            'eng', // ใช้ภาษาอังกฤษเป็นหลัก (ตัวเลขอ่านได้ดี) ถ้ามีไทยอาจต้องใส่ 'tha+eng' แต่จะช้าลง
            {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        // อัปเดตสถานะย่อยถ้าต้องการ (แต่อาจจะกระพริบเร็วไป)
                    }
                }
            }
        ).then(({ data: { text } }) => {
            resolve(text);
        }).catch(err => {
            reject(err);
        });
    });
}

function parseBankStatement(lines) {
    const results = [];
    // Regex สำหรับหาวันที่รูปแบบ DD/MM/YYYY หรือ DD-MM-YYYY
    const dateRegex = /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/;
    // Regex สำหรับหาจำนวนเงิน (ที่มีทศนิยม 2 ตำแหน่ง)
    const amountRegex = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        const dateMatch = line.match(dateRegex);
        
        // เงื่อนไข: ต้องมีวันที่ และมีตัวเลขที่เป็นจำนวนเงินอย่างน้อย 1 ตัว
        if (dateMatch) {
            const amounts = line.match(amountRegex);
            
            let deposit = '';
            let withdrawal = '';
            let balance = '';
            
            // ลอกเอาวันที่ออกเพื่อหาชื่อบัญชี/รายการ
            let description = line.replace(dateMatch[0], '').trim();
            // ลบตัวเลขและเครื่องหมายวรรคตอนออกจากคำอธิบายคร่าวๆ (ปรับตามความเหมาะสม)
            description = description.replace(/[\d,.]/g, '').trim();

            if (amounts && amounts.length > 0) {
                // สมมติว่าตัวเลขสุดท้ายคือยอดคงเหลือ (Balance)
                balance = amounts[amounts.length - 1];
                
                // ถ้ามีตัวเลข 2 ตัวขึ้นไป ตัวแรกมักจะเป็น เงินเข้า/ออก
                if (amounts.length >= 2) {
                    // ต้องวิเคราะห์เพิ่มว่าตัวไหนคือ Deposit หรือ Withdrawal 
                    // ในกรณีง่ายๆ อาจถือว่าตัวแรกคือ Transaction Amount
                    // *หมายเหตุ:* การแยก Deposit/Withdrawal แบบเป๊ะๆ โดยไม่มี Keyword (เช่น "CR", "DR") 
                    //是做ยากด้วย Regex อย่างเดียว อาจจะต้องดูบริบทหรือตำแหน่งคอลัมน์
                    // ตรงนี้สมมติว่าตัวแรกคือรายการที่เกิดขึ้น
                    withdrawal = amounts[0]; 
                }
            }

            // กรองแถวที่ไม่ใช่ข้อมูลธุรกรรม (เช่น หัวตาราง, โฆษณา)
            if (description.length > 2 || amounts) {
                results.push({
                    date: dateMatch[0],
                    description: description || '-',
                    deposit: deposit,
                    withdrawal: withdrawal,
                    balance: balance
                });
            }
        }
    });

    return results;
}

function renderTable(data) {
    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">ไม่พบข้อมูลธุรกรรม (ลองตรวจสอบไฟล์ PDF)</td></tr>';
        return;
    }
    
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.description}</td>
            <td style="color:green">${row.deposit}</td>
            <td style="color:red">${row.withdrawal}</td>
            <td><strong>${row.balance}</strong></td>
        `;
        tableBody.appendChild(tr);
    });
}

downloadBtn.addEventListener('click', () => {
    if (extractedData.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(extractedData);
    
    // ปรับความกว้างคอลัมน์ใน Excel
    const wscols = [
        {wch: 15}, // Date
        {wch: 40}, // Description
        {wch: 15}, // Deposit
        {wch: 15}, // Withdrawal
        {wch: 15}  // Balance
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bank Statement");

    XLSX.writeFile(wb, "Bank_Statement_Result.xlsx");
});
