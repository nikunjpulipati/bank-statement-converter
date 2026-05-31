const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

// IP-based usage tracking
const usageMap = {};
const FREE_LIMIT = 5;

function getMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
}

function checkUsage(req) {
  const ip = getIP(req);
  const month = getMonth();
  if (!usageMap[ip] || usageMap[ip].month !== month) {
    usageMap[ip] = { count: 0, month };
  }
  return usageMap[ip].count;
}

function incrementUsage(req) {
  const ip = getIP(req);
  usageMap[ip].count++;
}

app.get('/usage', (req, res) => {
  const used = checkUsage(req);
  res.json({ used, limit: FREE_LIMIT, remaining: Math.max(0, FREE_LIMIT - used) });
});

app.post('/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Check free limit
  const used = checkUsage(req);
  if (used >= FREE_LIMIT) {
    fs.unlinkSync(req.file.path);
    return res.status(429).json({ error: 'limit_reached' });
  }

  const password = req.body.password || '';
  const pdfPath = req.file.path;
  const decryptedPath = pdfPath + '_decrypted.pdf';

  try {
    await new Promise((resolve, reject) => {
      execFile('python3', [
        path.join(__dirname, 'decrypt.py'),
        pdfPath,
        decryptedPath,
        password
      ], (err, stdout, stderr) => {
        const output = (stdout || '').trim();
        if (output === 'ok') resolve();
        else if (output === 'wrong_password') reject(new Error('wrong_password'));
        else reject(new Error('decrypt_failed'));
      });
    });

    const dataBuffer = fs.readFileSync(decryptedPath);
    const pdfData = await pdfParse(dataBuffer);
    const rows = parseTransactions(pdfData.text);

    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(decryptedPath)) fs.unlinkSync(decryptedPath);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No transactions found. The PDF format may not be supported yet.' });
    }

    // Count successful conversion
    incrementUsage(req);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      ...rows
    ]);

    ws['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

    const outPath = path.join('uploads', `${req.file.filename}.xlsx`);
    XLSX.writeFile(wb, outPath);

    res.download(outPath, 'bank_statement.xlsx', () => {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    });

  } catch (err) {
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(decryptedPath)) fs.unlinkSync(decryptedPath);

    if (err.message === 'wrong_password') {
      return res.status(400).json({ error: 'Wrong password. Please try again.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to process PDF.' });
  }
});

function parseTransactions(text) {
  const rows = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const datePattern = /^(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;
  const amountPattern = /[\d,]+\.\d{2}/g;

  for (const line of lines) {
    if (!datePattern.test(line)) continue;
    const dateMatch = line.match(datePattern);
    const date = dateMatch[1];
    const rest = line.slice(date.length).trim();
    const amounts = rest.match(amountPattern) || [];
    const description = rest.replace(/[\d,]+\.\d{2}/g, '').replace(/\s+/g, ' ').trim();

    let debit = '', credit = '', balance = '';
    if (amounts.length === 1) balance = amounts[0];
    else if (amounts.length === 2) { debit = amounts[0]; balance = amounts[1]; }
    else if (amounts.length >= 3) { debit = amounts[0]; credit = amounts[1]; balance = amounts[2]; }

    rows.push([date, description, debit, credit, balance]);
  }
  return rows;
}

const PORT = 3000;
app.listen(PORT, () => console.log(`BankPDF running at http://localhost:${PORT}`));
