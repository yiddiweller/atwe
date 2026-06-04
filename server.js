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

app.post('/api/chat', async (req, res) => {
  const { messages, plan } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const maxTokens = plan === 'pro' ? 4096 : 1500;

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:
        'You are Atwe AI, an intelligent assistant built for modern businesses. Provide clear, actionable, insightful responses. Be professional yet conversational, thorough yet concise. Format responses with markdown when helpful — use **bold**, `code`, bullet lists, and headers where appropriate.',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    stream.on('text', (text) => send({ type: 'text', text }));
    stream.on('finalMessage', (msg) => {
      send({ type: 'done', usage: msg.usage });
      res.end();
    });
    stream.on('error', (err) => {
      send({ type: 'error', error: err.message });
      res.end();
    });

    req.on('close', () => stream.abort());
  } catch (err) {
    send({ type: 'error', error: err.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀  Atwe server → http://localhost:${PORT}\n`);
});
