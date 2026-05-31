const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();

// Use memory storage — works on Railway (no disk write needed)
const upload = multer({ storage: multer.memoryStorage() });

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
    return res.status(429).json({ error: 'limit_reached' });
  }

  const password = req.body.password || '';

  // Write buffer to temp files
  const tmpPdf = path.join(os.tmpdir(), `upload_${Date.now()}.pdf`);
  const tmpDecrypted = path.join(os.tmpdir(), `decrypted_${Date.now()}.pdf`);

  try {
    // Write uploaded buffer to temp file
    fs.writeFileSync(tmpPdf, req.file.buffer);

    // Decrypt with pikepdf
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/python3', [
        path.join(__dirname, 'decrypt.py'),
        tmpPdf,
        tmpDecrypted,
        password
      ], (err, stdout, stderr) => {
        const output = (stdout || '').trim();
        console.log('decrypt output:', output, 'stderr:', stderr, 'err:', err);
        if (output === 'ok') resolve();
        else if (output === 'wrong_password') reject(new Error('wrong_password'));
        else reject(new Error('decrypt_failed: ' + output + ' ' + stderr));
      });
    });

    const dataBuffer = fs.readFileSync(tmpDecrypted);
    const pdfData = await pdfParse(dataBuffer);
    const rows = parseTransactions(pdfData.text);

    // Cleanup temp files
    if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
    if (fs.existsSync(tmpDecrypted)) fs.unlinkSync(tmpDecrypted);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No transactions found. The PDF format may not be supported yet.' });
    }

    incrementUsage(req);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      ...rows
    ]);

    ws['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

    // Write xlsx to temp and stream back
    const tmpXlsx = path.join(os.tmpdir(), `output_${Date.now()}.xlsx`);
    XLSX.writeFile(wb, tmpXlsx);

    res.download(tmpXlsx, 'bank_statement.xlsx', () => {
      if (fs.existsSync(tmpXlsx)) fs.unlinkSync(tmpXlsx);
    });

  } catch (err) {
    if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
    if (fs.existsSync(tmpDecrypted)) fs.unlinkSync(tmpDecrypted);

    if (err.message === 'wrong_password') {
      return res.status(400).json({ error: 'Wrong password. Please try again.' });
    }
    console.error('Upload error:', err.message);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BankPDF running at http://localhost:${PORT}`));
