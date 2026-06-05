require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  console.log(`[chat] request received, ${messages.length} message(s)`);

  try {
    const maxTokens = plan === 'pro' ? 4096 : 1500;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:
        'You are Atwe AI, an intelligent assistant built for modern businesses. Provide clear, actionable, insightful responses. Be professional yet conversational, thorough yet concise. Format responses with markdown when helpful — use **bold**, `code`, bullet lists, and headers where appropriate.',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    console.log('[chat] response received successfully');
    res.json({ content: msg.content[0].text, usage: msg.usage });
  } catch (err) {
    console.error('[chat] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀  Atwe server → http://localhost:${PORT}\n`);
});
