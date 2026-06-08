const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.use(express.json());
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

    incrementUsage(req);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      ...rows
    ]);

    ws['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

    const outPath = path.join(os.tmpdir(), `${req.file.filename}.xlsx`);
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
    console.error('Error:', err.message);
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

// ============ AUTH ADDITIONS ============
require('dotenv').config();
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const mongoose = require('mongoose');

// MongoDB User Model
const userSchema = new mongoose.Schema({
  googleId: String,
  name: String,
  email: String,
  photo: String,
  conversionsUsed: { type: Number, default: 0 },
  conversionsMonth: { type: String, default: '' },
  plan: { type: String, default: 'free' },
  conversionsLimit: { type: Number, default: 5 }
});
const User = mongoose.model('User', userSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).then(() => console.log('MongoDB connected')).catch(err => console.error('MongoDB error:', err));

// Session
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Passport Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://bank-statement-converter-i2vk.onrender.com/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  let user = await User.findOne({ googleId: profile.id });
  if (!user) {
    user = await User.create({ googleId: profile.id, name: profile.displayName, email: profile.emails[0].value, photo: profile.photos[0].value });
  }
  return done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

// Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });
app.get('/me', (req, res) => {
  if (req.user) { User.findById(req.user._id).then(u => res.json({ loggedIn: true, name: u.name, email: u.email, photo: u.photo, plan: u.plan })); }
  else res.json({ loggedIn: false });
});
// ============ END AUTH ============

// Fix unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

// ============ RAZORPAY ============
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const PLANS = {
  basic: { amount: 29900, name: 'Basic Plan', conversions: 50 },
  pro: { amount: 99900, name: 'Pro Plan', conversions: 200 },
  business: { amount: 299900, name: 'Business Plan', conversions: 999999 }
};

app.post('/create-order', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  const plan = PLANS[req.body.plan];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });
  const order = await razorpay.orders.create({ amount: plan.amount, currency: 'INR', receipt: `receipt_${Date.now()}` });
  res.json({ orderId: order.id, amount: plan.amount, name: plan.name, key: process.env.RAZORPAY_KEY_ID });
});

app.post('/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
  const sign = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSign = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(sign).digest('hex');
  if (expectedSign !== razorpay_signature) return res.status(400).json({ error: 'Invalid payment' });
  const p = PLANS[plan];
  await User.findByIdAndUpdate(req.user._id, { plan, conversionsLimit: p.conversions });
  req.user.plan = plan; req.user.conversionsLimit = p.conversionsLimit; res.json({ success: true });
});
// ============ END RAZORPAY ============

// ============ CONTACT FORM ============
const nodemailer = require('nodemailer');

app.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'All fields required' });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  try {
    await transporter.sendMail({
      from: `"Bank Statement Converter" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `Contact Form: ${name}`,
      html: `<p><b>Name:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>Message:</b><br>${message}</p>`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});
// ============ END CONTACT FORM ============
