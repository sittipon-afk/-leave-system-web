// ตั้งค่า PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const uploader = document.getElementById('uploader');
const statusDiv = document.getElementById('status');
const previewContainer = document.getElementById('preview-container');
const downloadBtn = document.getElementById('downloadBtn');
const tableBody = document.querySelector('#resultTable tbody');

let extractedData = [];

uploader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        statusDiv.innerHTML = '<span class="error">กรุณาเลือกไฟล์ PDF เท่านั้น</span>';
        return;
    }

    // รีเซ็ตค่า
    tableBody.innerHTML = '';
    extractedData = [];
    previewContainer.innerHTML = '';
    downloadBtn.disabled = true;
    statusDiv.innerText = 'กำลังอ่านไฟล์ PDF...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const totalPages = pdf.numPages;
        
        statusDiv.innerText = `พบ ${totalPages} หน้า กำลังเริ่ม OCR (อาจใช้เวลาสักครู่)...`;

        // สร้าง Tesseract Worker และโหลดภาษา ไทย + อังกฤษ
        // ใช้ CDN ที่เสถียรสำหรับ GitHub Pages
        const worker = await Tesseract.createWorker({
            logger: m => {
                if(m.status === 'recognizing text') {
                    statusDiv.innerText = `กำลังประมวลผลหน้า ${m.currentPage || 1}/${totalPages}: ${Math.round(m.progress * 100)}%`;
                }
            },
            // ระบุ path ของ core และ language data ชัดเจน
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/dist/tesseract-core.wasm.js',
            langPath: 'https://tessdata.projectnaptha.com/4.0.0' 
        });

        // โหลดภาษา ไทย (tha) และ อังกฤษ (eng) เพื่อความแม่นยำ
        await worker.loadLanguage('tha+eng');
        await worker.initialize('tha+eng');

        let allTextLines = [];

        // วนลูปทุกหน้าใน PDF
        for (let i = 1; i <= totalPages; i++) {
            statusDiv.innerText = `กำลังแปลงหน้า ${i}/${totalPages} เป็นรูปภาพ...`;
            
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Scale 2.0 เพื่อความชัดของตัวอักษร
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // แสดงตัวอย่างรูป (Optional)
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            img.className = 'page-preview';
            img.style.display = 'block';
            img.title = `หน้า ${i}`;
            previewContainer.appendChild(img);

            // ทำ OCR กับรูปภาพนี้
            statusDiv.innerText = `กำลังอ่านข้อความหน้า ${i}/${totalPages}...`;
            const { data: { text } } = await worker.recognize(canvas);
            
            const lines = text.split('\n');
            allTextLines = allTextLines.concat(lines);
        }

        await worker.terminate();

        statusDiv.innerText = 'OCR เสร็จสิ้น! กำลังจัดรูปแบบข้อมูล...';
        
        // แยกข้อมูล (ต้องปรับ Regex ตามรูปแบบธนาคารของคุณ)
        extractedData = parseBankStatement(allTextLines);
        
        renderTable(extractedData);
        
        if (extractedData.length > 0) {
            downloadBtn.disabled = false;
            statusDiv.innerText = `สำเร็จ! พบข้อมูล ${extractedData.length} รายการ`;
        } else {
            statusDiv.innerHTML = '<span class="error">ไม่พบข้อมูลในรูปแบบตาราง กรุณาลองไฟล์อื่น หรือตรวจสอบรูปแบบ</span>';
        }

    } catch (error) {
        console.error(error);
        statusDiv.innerHTML = `<span class="error">เกิดข้อผิดพลาด: ${error.message}</span>`;
    }
});

function parseBankStatement(lines) {
    const results = [];
    // Regex ตัวอย่าง: หาวันที่รูปแบบ DD/MM/YYYY หรือ DD/MM/YY
    // ปรับปรุงตามจริง: ธนาคารบางแห่งใช้ DD-MM-YYYY หรือ มีเวลาติดมาด้วย
    const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/; 
    
    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        const dateMatch = line.match(dateRegex);
        
        if (dateMatch) {
            // ลองแยกตัวเลขที่เป็นเงิน (ที่มีทศนิยม 2 ตำแหน่ง)
            // รูปแบบทั่วไป: ... Description ... Amount ... Balance
            // วิธีนี้อาจต้องปรับเยอะมากขึ้นอยู่กับ Layout ของ Bank Statement นั้นๆ
            const numbers = line.match(/[\d,]+\.\d{2}/g);
            
            let description = line.replace(dateMatch[0], '').trim();
            // ลบตัวเลขออกจากคำอธิบายเบื้องต้น
            if(numbers) {
                numbers.forEach(num => {
                    description = description.replace(num, '').trim();
                });
            }
            // ลบเครื่องหมายวรรคตอนเกินออก
            description = description.replace(/[-|]+/g, ' ').trim();

            let deposit = '';
            let withdrawal = '';
            let balance = '';

            if (numbers && numbers.length > 0) {
                // สมมติว่าตัวสุดท้ายคือยอดคงเหลือ (Balance)
                balance = numbers[numbers.length - 1];
                
                // ถ้ามี 2 ตัวเลข อาจเป็น ยอดทำรายการ + ยอดคงเหลือ
                if (numbers.length >= 2) {
                    const transactionAmount = numbers[numbers.length - 2];
                    // ต้องมี Logic เพิ่มว่าอันไหนฝาก อันไหนถอน (เช่น ดูคำว่า "โอนเข้า", "ATM")
                    // เบื้องต้นใส่เป็นถอนไว้ก่อน หรือเว้นว่างให้ผู้ใช้แก้ใน Excel
                    withdrawal = transactionAmount; 
                }
            }

            results.push({
                date: dateMatch[0],
                description: description,
                deposit: deposit,
                withdrawal: withdrawal,
                balance: balance
            });
        }
    });

    return results;
}

function renderTable(data) {
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.description}</td>
            <td style="text-align:right;">${row.deposit}</td>
            <td style="text-align:right;">${row.withdrawal}</td>
            <td style="text-align:right;">${row.balance}</td>
        `;
        tableBody.appendChild(tr);
    });
}

downloadBtn.addEventListener('click', () => {
    if (extractedData.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(extractedData);
    
    // ตั้งค่าความกว้างคอลัมน์ให้เหมาะสม
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

    XLSX.writeFile(wb, "Bank_Statement_TH.xlsx");
});
