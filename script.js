const uploader = document.getElementById('uploader');
const preview = document.getElementById('preview');
const statusDiv = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const tableBody = document.querySelector('#resultTable tbody');

let extractedData = [];

uploader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
    tableBody.innerHTML = '';
    extractedData = [];
    downloadBtn.disabled = true;
    statusDiv.innerText = 'กำลังเตรียมประมวลผล...';

    try {
        const worker = await Tesseract.createWorker({
            logger: m => {
                if(m.status === 'recognizing text') {
                    statusDiv.innerText = `กำลังอ่านข้อความ: ${Math.round(m.progress * 100)}%`;
                }
            }
        });

        await worker.loadLanguage('eng');
        await worker.initialize('eng');

        const { data: { text } } = await worker.recognize(file);
        
        statusDiv.innerText = 'ประมวลผลเสร็จสิ้น! กำลังจัดรูปแบบข้อมูล...';
        console.log("Raw Text:", text);

        const lines = text.split('\n');
        extractedData = parseBankStatement(lines);

        renderTable(extractedData);
        
        await worker.terminate();
        downloadBtn.disabled = false;
        statusDiv.innerText = 'พร้อมดาวน์โหลด';

    } catch (error) {
        console.error(error);
        statusDiv.innerText = 'เกิดข้อผิดพลาด: ' + error.message;
    }
});

function parseBankStatement(lines) {
    const results = [];
    const dateRegex = /(\d{2}\/\d{2}\/\d{4})/;
    const amountRegex = /([\d,]+\.\d{2})/g;

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        const dateMatch = line.match(dateRegex);
        const amounts = line.match(amountRegex);

        if (dateMatch && amounts && amounts.length >= 1) {
            let deposit = '';
            let withdrawal = '';
            let balance = '';
            let description = line.replace(dateMatch[0], '').replace(/[0-9,.]/g, '').trim();

            if (amounts.length > 0) {
                balance = amounts[amounts.length - 1]; 
                if (amounts.length > 1) {
                    withdrawal = amounts[0]; 
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
            <td>${row.deposit}</td>
            <td>${row.withdrawal}</td>
            <td>${row.balance}</td>
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
