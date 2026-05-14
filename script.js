onst uploader = document.getElementById('uploader');
const preview = document.getElementById('preview');
const statusDiv = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const tableBody = document.querySelector('#resultTable tbody');

let extractedData = [];

// ฟังก์ชันช่วยแสดงสถานะและ Log
function logStatus(msg, isError = false) {
    console.log(msg);
    statusDiv.innerText = msg;
    if (isError) {
        statusDiv.style.color = 'red';
    } else {
        statusDiv.style.color = '#666';
    }
}

uploader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // รีเซ็ตค่า
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
    tableBody.innerHTML = '';
    extractedData = [];
    downloadBtn.disabled = true;
    logStatus('กำลังโหลดโมเดล OCR (อาจใช้เวลาสักครู่)...');

    try {
        // สร้าง Worker โดยระบุ core path ชัดเจนเพื่อป้องกันปัญหาใน GitHub Pages
        const worker = await Tesseract.createWorker({
            logger: m => {
                if(m.status === 'recognizing text') {
                    logStatus(`กำลังอ่านข้อความ: ${Math.round(m.progress * 100)}%`);
                }
            },
            // บังคับโหลดจาก CDN ที่เสถียร
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
            langPath: 'https://tesseract-data.projectnaptha.com/4.0.0' 
        });

        // ใช้ภาษาอังกฤษก่อน (ถ้าต้องการไทยต้องเปลี่ยนเป็น 'tha' และโหลดไฟล์ภาษาไทยซึ่งมีขนาดใหญ่)
        // ใบแจ้งยอดธนาคารมักเป็นตัวเลขและอังกฤษเป็นหลัก
        await worker.loadLanguage('eng');
        await worker.initialize('eng');

        logStatus('กำลังประมวลผลรูปภาพ...');
        const { data: { text } } = await worker.recognize(file);
        
        logStatus('ประมวลผลเสร็จสิ้น! กำลังจัดรูปแบบข้อมูล...');
        console.log("=== Raw Text From OCR ===");
        console.log(text); // ดูผลลัพธ์ดิบใน Console (กด F12)
        console.log("=========================");

        const lines = text.split('\n');
        extractedData = parseBankStatement(lines);

        if (extractedData.length === 0) {
            logStatus('ไม่พบข้อมูลรูปแบบบัญชีธนาคาร กรุณาลองรูปที่ชัดเจนกว่านี้', true);
        } else {
            renderTable(extractedData);
            downloadBtn.disabled = false;
            logStatus('พร้อมดาวน์โหลดไฟล์ Excel');
        }

        await worker.terminate();

    } catch (error) {
        console.error(error);
        logStatus('เกิดข้อผิดพลาด: ' + error.message, true);
        alert("เกิดข้อผิดพลาดในการประมวลผล กรุณาเปิด Console (F12) เพื่อดูรายละเอียด");
    }
});

function parseBankStatement(lines) {
    const results = [];
    // ปรับ Regex ตามรูปแบบวันที่ของธนาคารคุณ (สมมติว่าเป็น DD/MM/YYYY หรือ DD/MM/YY)
    const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
    
    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        const dateMatch = line.match(dateRegex);
        
        // กรองบรรทัดที่มีวันที่เท่านั้น
        if (dateMatch) {
            // พยายามดึงตัวเลขที่เป็นเงิน (รูปแบบมีลูกน้ำหรือจุด)
            // หมายเหตุ: Logic นี้เป็นแบบกว้างๆ อาจต้องปรับตามธนาคาร
            const numbers = line.match(/([\d,]+(?:\.\d{2})?)/g);
            
            let description = line.replace(dateMatch[0], '').trim();
            // ลบตัวเลขออกจากคำอธิบายเบื้องต้น
            if (numbers) {
                numbers.forEach(num => {
                    description = description.replace(num, '');
                });
            }
            description = description.replace(/\s+/g, ' ').trim(); // จัดช่องว่าง

            // สมมติว่าตัวเลขสุดท้ายคือยอดคงเหลือ (Balance)
            let balance = numbers ? numbers[numbers.length - 1] : '';
            let transactionAmount = numbers && numbers.length > 1 ? numbers[numbers.length - 2] : '';
            
            // แยกฝาก/ถอน (อย่างง่าย: ถ้าไม่มีเครื่องหมายลบ ถือว่าเป็นการเคลื่อนไหวทั่วไป)
            // ส่วนใหญ่ต้องดูคำว่า "Deposit", "Transfer", "-" เป็นต้น
            let deposit = '';
            let withdrawal = '';

            if (transactionAmount) {
                // Logic อย่างง่าย: ถ้าบรรทัดมีคำว่า Transfer out หรือ Withdraw ให้ใส่ช่องถอน
                if (line.toLowerCase().includes('transfer') || line.toLowerCase().includes('withdraw') || line.includes('-')) {
                    withdrawal = transactionAmount;
                } else {
                    deposit = transactionAmount;
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
    if (data.length === 0) return;
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.description}</td>
            <td style="color:green">${row.deposit}</td>
            <td style="color:red">${row.withdrawal}</td>
            <td><b>${row.balance}</b></td>
        `;
        tableBody.appendChild(tr);
    });
}

downloadBtn.addEventListener('click', () => {
    if (extractedData.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(extractedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");

    XLSX.writeFile(wb, "Bank_Statement_Result.xlsx");
});
