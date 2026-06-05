require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'atwe-dev-secret-change-in-production';

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── User storage (file-based) ───────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function saveUsers(users) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users));
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name?.trim() || !email?.trim() || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const users = loadUsers();
  if (users.find(u => u.email === email.toLowerCase().trim()))
    return res.status(409).json({ error: 'An account with this email already exists' });

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: Date.now().toString(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    hash,
    plan: 'free',
    createdAt: Date.now(),
  };
  users.push(user);
  saveUsers(users);

  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim() || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const users = loadUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user)
    return res.status(401).json({ error: 'No account found with this email' });

  const ok = await bcrypt.compare(password, user.hash);
  if (!ok)
    return res.status(401).json({ error: 'Incorrect password' });

  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
});

// ─── Existing endpoints ───────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/test', async (_req, res) => {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    res.json({ status: 'ok', reply: msg.content[0].text });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages, plan } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'Invalid messages' });

  try {
    const maxTokens = plan === 'pro' ? 4096 : 1500;
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:
        'You are Atwe AI, an intelligent assistant built for modern businesses. Provide clear, actionable, insightful responses. Be professional yet conversational, thorough yet concise. Format responses with markdown when helpful — use **bold**, `code`, bullet lists, and headers where appropriate.',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    res.json({ content: msg.content[0].text, usage: msg.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀  Atwe server → http://localhost:${PORT}\n`);
});
