// ตั้งค่า Worker ของ PDF.js ให้ชี้ไปที่ CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const pdfUploader = document.getElementById('pdfUploader');
const statusDiv = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const previewContainer = document.getElementById('preview-container');
const downloadBtn = document.getElementById('downloadBtn');
const tableBody = document.querySelector('#resultTable tbody');

let extractedData = [];

pdfUploader.addEventListener('change', async (e) => {
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
    progressBar.style.display = 'block';
    progressFill.style.width = '0%';
    
    try {
        statusDiv.innerText = 'กำลังอ่านไฟล์ PDF...';
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const totalPages = pdf.numPages;
        
        statusDiv.innerText = `พบ ${totalPages} หน้า กำลังแปลงเป็นรูปภาพเพื่อทำ OCR...`;
        
        let allText = "";

        // วนลูปทุกหน้าใน PDF
        for (let i = 1; i <= totalPages; i++) {
            updateProgress(i, totalPages);
            statusDiv.innerText = `กำลังประมวลผลหน้า ${i} จาก ${totalPages}...`;

            const page = await pdf.getPage(i);
            
            // ตั้งค่าความละเอียด (Scale 2.0 เพื่อความชัดสำหรับ OCR)
            const scale = 2.0;
            const viewport = page.getViewport({ scale });

            // สร้าง Canvas เพื่อวาดรูปจาก PDF
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // แสดงตัวอย่างรูปภาพ (Optional)
            const imgPreview = document.createElement('div');
            imgPreview.className = 'page-preview';
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            const label = document.createElement('div');
            label.className = 'page-label';
            label.innerText = `หน้า ${i}`;
            imgPreview.appendChild(img);
            imgPreview.appendChild(label);
            previewContainer.appendChild(imgPreview);

            // ทำ OCR กับรูปภาพนี้
            const worker = await Tesseract.createWorker('eng+tha'); // ใช้ภาษาไทยและอังกฤษ
            const { data: { text } } = await worker.recognize(canvas);
            await worker.terminate();

            allText += text + "\n"; // รวมข้อความทุกหน้า
        }

        statusDiv.innerText = 'OCR เสร็จสิ้น! กำลังจัดรูปแบบข้อมูล...';
        console.log("Raw Text from PDF:\n", allText);

        // แยกข้อมูล (ต้องปรับ Regex ตามรูปแบบธนาคารของคุณ)
        extractedData = parseBankStatement(allText);
        
        renderTable(extractedData);

        if (extractedData.length > 0) {
            downloadBtn.disabled = false;
            statusDiv.innerText = 'พร้อมดาวน์โหลด! (ตรวจสอบความถูกต้องในตารางด้านล่าง)';
        } else {
            statusDiv.innerText = 'ไม่พบข้อมูลธุรกรรม อาจเกิดจากรูปแบบไฟล์ที่ไม่ตรง หรือตัวหนังสือเบลอ';
        }

    } catch (error) {
        console.error(error);
        statusDiv.innerText = 'เกิดข้อผิดพลาด: ' + error.message;
        progressBar.style.display = 'none';
    }
});

function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    progressFill.style.width = `${percent}%`;
}

function parseBankStatement(text) {
    const results = [];
    const lines = text.split('\n');
    
    // Regex ตัวอย่าง (ต้องปรับตามจริง):
    // หาวันที่รูปแบบ DD/MM/YYYY หรือ DD/MM/YY
    const dateRegex = /(\d{1,2}\/\d{1,2}\/\d{2,4})/;
    // หาตัวเลขที่มีทศนิยม (จำนวนเงิน)
    const moneyRegex = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        const dateMatch = line.match(dateRegex);
        
        if (dateMatch) {
            const amounts = line.match(moneyRegex);
            let deposit = "";
            let withdrawal = "";
            let balance = "";
            
            // Logic การแยกเงินฝาก/ถอน/ยอดคงเหลือ 
            // หมายเหตุ: ส่วนใหญ่ Bank Statement จะเรียง: วันที่ | รายการ | เงินเข้า | เงินออก | ยอดคงเหลือ
            // แต่ OCR อาจจะดึงมาปนกัน ต้องใช้ตรรกะเพิ่มเติม เช่น ถ้ามี 3 ตัวเลข ตัวสุดท้ายมักคือยอดคงเหลือ
            
            if (amounts && amounts.length > 0) {
                // สมมติว่าตัวเลขตัวสุดท้ายคือยอดคงเหลือ (Balance)
                balance = amounts[amounts.length - 1];
                
                // ถ้ามี 2 ตัวขึ้นไป ตัวแรกอาจจะเป็นเงินถอนหรือฝาก ขึ้นอยู่กับรูปแบบธนาคาร
                // กรณีนี้สมมติง่ายๆ ว่าถ้ามี 2 ตัว: ตัวแรก=ธุรกรรม, ตัวสอง=ยอดคงเหลือ
                if (amounts.length >= 2) {
                    // ตรวจสอบคำสำคัญในบรรทัดเพื่อแยกว่า ฝาก หรือ ถอน
                    const lowerLine = line.toLowerCase();
                    if (lowerLine.includes("transfer") || lowerLine.includes("deposit") || lowerLine.includes("จ่าย")) {
                         // Logic นี้ต้องปรับตามคำที่ปรากฏใน statement จริง
                         withdrawal = amounts[0]; 
                    } else {
                         deposit = amounts[0];
                    }
                }
            }

            // ลบวันที่และตัวเลขออกจากข้อความเพื่อให้ได้เฉพาะ "รายการ"
            let description = line.replace(dateMatch[0], "")
                                  .replace(/[0-9,.]/g, " ")
                                  .replace(/\s+/g, " ")
                                  .trim();
            
            // กรองบรรทัดที่ไม่มีข้อมูลสำคัญ
            if (description.length > 2 || amounts) {
                results.push({
                    "Date": dateMatch[0],
                    "Description": description,
                    "Deposit": deposit,
                    "Withdrawal": withdrawal,
                    "Balance": balance
                });
            }
        }
    });

    return results;
}

function renderTable(data) {
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.Date}</td>
            <td>${row.Description}</td>
            <td style="color:green">${row.Deposit}</td>
            <td style="color:red">${row.Withdrawal}</td>
            <td><b>${row.Balance}</b></td>
        `;
        tableBody.appendChild(tr);
    });
}

downloadBtn.addEventListener('click', () => {
    if (extractedData.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(extractedData);
    
    // ปรับความกว้างคอลัมน์
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

    const fileName = `Statement_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
});
