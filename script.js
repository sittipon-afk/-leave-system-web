const uploader = document.getElementById('uploader');
const preview = document.getElementById('preview');
const statusDiv = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const tableBody = document.querySelector('#resultTable tbody');
const rawTextDiv = document.getElementById('rawTextOutput'); // ต้องเพิ่ม div นี้ใน HTML ด้วย

let extractedData = [];

// ตรวจสอบว่ามี element สำหรับแสดง raw text หรือไม่ ถ้าไม่มีให้สร้างชั่วคราว
if (!rawTextDiv) {
    const div = document.createElement('div');
    div.id = 'rawTextOutput';
    div.style.cssText = 'margin-top: 20px; padding: 10px; background: #f4f4f4; border: 1px solid #ddd; white-space: pre-wrap; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; display: none;';
    document.body.appendChild(div);
}

uploader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // รีเซ็ตค่าต่างๆ
    tableBody.innerHTML = '';
    extractedData = [];
    downloadBtn.disabled = true;
    const rawTextEl = document.getElementById('rawTextOutput');
    rawTextEl.style.display = 'block';
    rawTextEl.innerText = 'กำลังประมวลผล...';
    
    // กรณีเป็น PDF ต้องใช้ pdf.js แปลงเป็นรูปก่อน (ถ้ามี logic เดิมให้คงไว้ ส่วนนี้สมมติว่าเป็นรูปภาพหรือจัดการ PDF แล้ว)
    // หากต้องการรองรับ PDF แบบเต็มรูปแบบ ต้องใส่โค้ดส่วนแปลง PDF to Image ตรงนี้
    // แต่เพื่อให้โฟกัสที่การแก้ Regex ขอสมมติว่าเรากำลังส่ง image ไปให้ Tesseract
    
    statusDiv.innerText = 'กำลังโหลดโมเดลภาษาไทย (อาจใช้เวลาสักครู่)...';

    try {
        // 1. สร้าง Worker และโหลดภาษา ไทย + อังกฤษ
        const worker = await Tesseract.createWorker({
            logger: m => {
                if(m.status === 'recognizing text') {
                    statusDiv.innerText = `กำลังอ่านข้อความ: ${Math.round(m.progress * 100)}%`;
                }
            }
        });

        // โหลดภาษา tha (ไทย) และ eng (อังกฤษ/ตัวเลข)
        await worker.loadLanguage('tha+eng');
        await worker.initialize('tha+eng');

        // 2. ทำการ OCR
        const { data: { text } } = await worker.recognize(file);
        
        statusDiv.innerText = 'ประมวลผลเสร็จสิ้น! กำลังวิเคราะห์ข้อมูล...';
        
        // 3. แสดง Raw Text ให้ผู้ใช้ดูเพื่อ Debug
        rawTextEl.innerText = "--- ข้อความดิบที่อ่านได้ (Raw Text) ---\n" + text;
        console.log("Raw Text from OCR:", text);

        // 4. แยกข้อมูลด้วย Logic ใหม่
        const lines = text.split('\n');
        extractedData = parseBankStatementLoose(lines);

        if (extractedData.length === 0) {
            statusDiv.innerText = 'ไม่พบข้อมูลรายการเดินบัญชีในรูปแบบที่รู้จัก (ลองดู Raw Text ด้านล่างเพื่อตรวจสอบ)';
        } else {
            statusDiv.innerText = `พบ ${extractedData.length} รายการ`;
            renderTable(extractedData);
            downloadBtn.disabled = false;
        }

        await worker.terminate();

    } catch (error) {
        console.error(error);
        statusDiv.innerText = 'เกิดข้อผิดพลาด: ' + error.message;
        rawTextEl.innerText += "\n\nError: " + error.message;
    }
});

function parseBankStatementLoose(lines) {
    const results = [];
    
    // Regex แบบยืดหยุ่น (Looser)
    // 1. วันที่: รองรับ DD/MM/YY, DD/MM/YYYY, DD-MM-YYYY, DD MM YYYY
    // จับกลุ่ม: วัน, เดือน, ปี
    const dateRegex = /(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})/;

    // 2. ตัวเลขเงิน: รองรับ 100.00, 1,000.00, 1000.50
    // ระวังเรื่อง comma ที่อาจจะถูก OCR อ่านผิดเป็นจุด หรือสลับที่
    const moneyRegex = /(\d{1,3}(?:[,\d]*\.\d{2})|\d+\.\d{2})/g;

    lines.forEach((line, index) => {
        const originalLine = line;
        line = line.trim();
        if (!line) return;

        // หาวันที่ในบรรทัดนี้
        const dateMatch = line.match(dateRegex);
        
        // หาคำว่า "โอน", "จ่าย", "ฝาก", "ยอด" เพื่อช่วยยืนยันว่าเป็นบรรทัดรายการ (Optional แต่ช่วยกรองขยะ)
        const hasTransactionKeyword = /โอน|จ่าย|ฝาก|ถอน|ยอด|ATM|QR|SCB|KBANK|BBL|KTB/i.test(line);

        if (dateMatch) {
            // พบวันที่ ลองหาตัวเลขในบรรทัดเดียวกัน หรือบรรทัดถัดไป (กรณี OCR ตัดบรรทัดผิด)
            let currentLineAmounts = line.match(moneyRegex);
            let description = line.replace(dateMatch[0], '').replace(/[0-9,.]/g, '').trim();
            
            // ลบคำซ้ำๆ ที่มักเกิดจาก OCR ผิดพลาด เช่น "ม ม ก ย" -> "มกราคม" (อันนี้ทำยาก ต้องใช้ dict)
            // เอาแค่ลบตัวเลขออกเพื่อเหลือแต่ข้อความ
            
            // กรณีพิเศษ: ถ้าบรรทัดนี้มีแค่วันที่ แต่ไม่มีตัวเลข อาจต้องไปดูบรรทัดถัดไป (Lookahead)
            if (!currentLineAmounts && lines[index + 1]) {
                const nextLineAmounts = lines[index + 1].match(moneyRegex);
                if (nextLineAmounts) {
                    currentLineAmounts = nextLineAmounts;
                    description += " " + lines[index + 1].replace(/[0-9,.]/g, '').trim();
                }
            }

            if (currentLineAmounts && currentLineAmounts.length > 0) {
                // Logic การแยกประเภทเงิน (อย่างง่าย)
                // โดยปกติ Bank Statement จะมี: [วันที่] [รายละเอียด] [เงินเข้า] [เงินออก] [ยอดคงเหลือ]
                // หรือ [วันที่] [รายละเอียด] [ยอดคงเหลือ] (แล้วมีเครื่องหมาย +/-)
                
                // สมมติว่าตัวเลขตัวสุดท้ายคือ "ยอดคงเหลือ" เสมอ (Common pattern)
                const balance = cleanNumber(currentLineAmounts[currentLineAmounts.length - 1]);
                
                let deposit = '';
                let withdrawal = '';

                // ถ้ามีตัวเลข 2 ตัว: อาจเป็น (เงินเข้า, ยอดคงเหลือ) หรือ (เงินออก, ยอดคงเหลือ)
                // ต้องดูบริบทเพิ่ม แต่ถ้าทำแบบง่าย:
                if (currentLineAmounts.length >= 2) {
                    const potentialTx = cleanNumber(currentLineAmounts[0]);
                    // เช็คว่าเป็นเงินเข้าหรือออกจากรายการ (เช่นคำว่า ฝาก vs จ่าย)
                    if (/ฝาก|รับ|โอนเข้า/i.test(description)) {
                        deposit = potentialTx;
                    } else {
                        withdrawal = potentialTx;
                    }
                }

                results.push({
                    date: normalizeDate(dateMatch[1], dateMatch[2], dateMatch[3]),
                    description: description.replace(/\s+/g, ' '), // ลดช่องว่างซ้ำ
                    deposit: deposit,
                    withdrawal: withdrawal,
                    balance: balance
                });
            }
        }
    });

    return results;
}

// ฟังก์ชันทำความสะอาดตัวเลข (ลบ comma, แปลง string เป็น format ที่เหมาะสม)
function cleanNumber(str) {
    if (!str) return '';
    // ลบ comma ออก (1,000 -> 1000)
    return str.replace(/,/g, '');
}

// ฟังก์ชันจัดรูปแบบวันที่ให้เป็นมาตรฐาน DD/MM/YYYY
function normalizeDate(d, m, y) {
    // เติม 0 ข้างหน้าถ้าหลักเดียว
    const day = d.padStart(2, '0');
    const month = m.padStart(2, '0');
    let year = y;
    
    // ถ้าปีเป็น 2 หลัก (เช่น 67) ให้เติม 20 นำหน้า (สมมติว่าเป็นปี ค.ศ. 20xx หรือ พ.ศ. 25xx ต้องดูตามข้อมูลจริง)
    // ส่วนใหญ่ Bank Statement ไทยมักเป็น พ.ศ. (เช่น 67 คือ 2567)
    if (year.length === 2) {
        year = '25' + year; 
    }
    
    return `${day}/${month}/${year}`;
}

function renderTable(data) {
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
    
    // ปรับความกว้างคอลัมน์ให้สวยงาม
    const wscols = [
        {wch: 15}, // Date
        {wch: 40}, // Description
        {wch: 15}, // Deposit
        {wch: 15}, // Withdrawal
        {wch: 15}  // Balance
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");

    XLSX.writeFile(wb, "Bank_Statement_Result.xlsx");
});
