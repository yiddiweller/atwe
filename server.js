require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const billing = require('./billing');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_HOST = process.env.ADMIN_HOST || 'admin.atwe.ai';

// Honour X-Forwarded-* (Railway terminates TLS at its proxy) so req.hostname
// and req.protocol reflect the real client-facing host.
app.set('trust proxy', 1);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Lightweight in-memory per-IP rate limiter for abuse-prone routes.
const _rlBuckets = new Map();
// `bucket` lets parameterized/auth routes share one limit (e.g. all DM sends by
// a user) instead of keying on the full path (which varies by :id and is trivially
// bypassable). When a bucket is given, the key is user-id (or ip) + bucket.
function rateLimit(max, windowMs, bucket) {
  return (req, res, next) => {
    const who = bucket && req.user ? `u${req.user.id}` : (req.ip || 'unknown');
    const key = who + ':' + (bucket || req.path);
    const now = Date.now();
    let b = _rlBuckets.get(key);
    if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; _rlBuckets.set(key, b); }
    b.count++;
    if (b.count > max) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of _rlBuckets) if (now > b.reset) _rlBuckets.delete(k);
}, 60000).unref();

/* ═══════════════════════════════════════════════
   STRIPE WEBHOOK
   Must read the RAW request body for signature verification, so it is
   mounted BEFORE express.json() (which would otherwise consume the body).
═══════════════════════════════════════════════ */
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!billing.isConfigured() || !billing.hasWebhookSecret()) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  let event;
  try {
    event = billing.constructEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = parseInt(s.metadata?.user_id || s.client_reference_id, 10);
      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id || null;
      if (!Number.isInteger(userId)) {
        console.warn('checkout.session.completed with no resolvable user_id:', s.id);
      } else {
        // Always refresh the customer id; only email when the plan actually flips to Pro.
        const { rows } = await db.query(
          `UPDATE users u SET plan = 'pro', stripe_customer_id = COALESCE($1, u.stripe_customer_id)
           FROM (SELECT plan AS old_plan FROM users WHERE id = $2) prev
           WHERE u.id = $2
           RETURNING u.name, u.email, prev.old_plan`,
          [customerId, userId]
        );
        if (rows[0] && rows[0].old_plan !== 'pro') {
          try {
            await sendProWelcomeEmail(rows[0]);
          } catch (e) {
            console.error('Pro welcome email failed:', e.message);
          }
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const customerId =
        typeof event.data.object.customer === 'string'
          ? event.data.object.customer
          : event.data.object.customer?.id || null;
      const { rowCount } = await db.query('UPDATE users SET plan = $1 WHERE stripe_customer_id = $2', [
        'free',
        customerId,
      ]);
      if (!rowCount) console.warn('Subscription cancelled but no user matched customer', customerId);
    }
    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.use(express.json({ limit: '25mb' })); // large enough for base64 images + PDFs

// On the admin subdomain (admin.atwe.ai), the dashboard is the homepage.
app.use((req, res, next) => {
  if (req.hostname === ADMIN_HOST && (req.path === '/' || req.path === '/index.html')) {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

/* ═══════════════════════════════════════════════
   HEALTH / DIAGNOSTICS
═══════════════════════════════════════════════ */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    db: db.isConfigured() ? 'configured' : 'not-configured',
    timestamp: new Date().toISOString(),
  });
});

// Public feature flags so the frontend can adapt its UI.
app.get('/api/config', (_req, res) => {
  res.json({
    billingEnabled: billing.isConfigured(),
    emailEnabled: mailer.isConfigured(),
  });
});

// Help-center contact form. Saves to the DB (if configured) and emails the
// owner so they can follow up. Works for guests and signed-in users.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'atwe@atwe.ai';
app.post('/api/contact', rateLimit(6, 60000), auth.optionalAuth, async (req, res) => {
  const email = (req.body.email || '').trim();
  const message = (req.body.message || '').trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
  if (message.length < 4) return res.status(400).json({ error: 'Please include a message.' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message is too long.' });

  let saved = false;
  if (db.isConfigured()) {
    try {
      await db.query(
        'INSERT INTO support_requests (user_id, email, message) VALUES ($1, $2, $3)',
        [req.user?.id || null, email, message]
      );
      saved = true;
    } catch (err) {
      console.error('Support request save failed:', err.message);
    }

    // For signed-in users, also surface the message in their admin message
    // thread so the owner can reply from the dashboard. If they typed a
    // different reply-to address, note it so context isn't lost.
    if (req.user?.id) {
      const threadBody = email && email.toLowerCase() !== (req.user.email || '').toLowerCase()
        ? `[via Help center · reply-to ${email}]\n${message}`
        : `[via Help center]\n${message}`;
      try {
        await db.query(
          `INSERT INTO admin_messages (user_id, sender, body, read_by_user, read_by_admin)
           VALUES ($1, 'user', $2, true, false)`,
          [req.user.id, threadBody]
        );
      } catch (err) {
        console.error('Support thread insert failed:', err.message);
      }
    }
  }

  // Notify the owner (best-effort). reply-to is set to the sender's address.
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let mailed = false;
  try {
    await mailer.sendMail({
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `New Atwe support message from ${email}`,
      text: `From: ${email}\n${req.user ? `Account: #${req.user.id}\n` : ''}\n${message}`,
      html: `<p><strong>From:</strong> ${esc(email)}</p>${req.user ? `<p><strong>Account:</strong> #${req.user.id}</p>` : ''}<p>${esc(message)}</p>`,
    });
    mailed = true;
  } catch (err) {
    console.error('Support email failed:', err.message);
  }

  // Succeed only if the message was actually stored or delivered.
  if (!saved && !mailed) {
    return res.status(503).json({ error: 'Support is temporarily unavailable. Please email atwe@atwe.ai directly.' });
  }
  res.json({ ok: true });
});

app.get('/api/test', async (_req, res) => {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    res.json({ status: 'ok', reply: msg.content.find((b) => b.type === 'text')?.text ?? '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', error: 'Diagnostics call failed' });
  }
});

/* ═══════════════════════════════════════════════
   AUTH  —  /api/auth/*
═══════════════════════════════════════════════ */
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    is_admin: row.is_admin,
    email_verified: row.email_verified,
    username: row.username || null,
    avatar: row.avatar || null,
    banner: row.banner || null,
    dob: row.dob ? new Date(row.dob).toISOString().slice(0, 10) : null,
  };
}

// Minimal HTML escaping for values interpolated into email bodies.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Validate an optional photo sent as a base64 data URL.
// Returns: null = none provided, string = valid, undefined = invalid/too large.
const MAX_IMG_CHARS = 3_500_000; // ~2.6 MB decoded — plenty for a chat photo/avatar
function cleanImage(img) {
  if (img == null || img === '') return null;
  if (typeof img !== 'string') return undefined;
  if (img.length > MAX_IMG_CHARS) return undefined;
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(img);
  if (!m) return undefined;
  // Sniff the magic bytes so the payload actually matches the declared type.
  let head;
  try { head = Buffer.from(m[2].slice(0, 24), 'base64'); } catch { return undefined; }
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
  const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  if (!(isPng || isJpg || isGif || isWebp)) return undefined;
  return img;
}

// Rich media (video / audio / file) as a base64 data URL.
// Returns: null = none, { data, kind } = valid, undefined = invalid/too large.
// Kept generous on size since the JSON body limit (25mb) is the real ceiling.
const MAX_MEDIA_CHARS = 22_000_000; // ~16 MB decoded
function cleanMedia(media) {
  if (media == null || media === '') return null;
  if (typeof media !== 'string') return undefined;
  if (media.length > MAX_MEDIA_CHARS) return undefined;
  const m = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(media);
  if (!m) return undefined;
  const mime = m[1].toLowerCase();
  const ok =
    /^video\/(mp4|webm|ogg|quicktime|x-matroska|x-m4v|3gpp)$/.test(mime) ||
    /^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|mp4|aac|x-m4a|m4a|3gpp|flac)$/.test(mime) ||
    /^image\/(png|jpe?g|gif|webp|heic|heif)$/.test(mime) ||
    /^application\/(pdf|zip|x-zip-compressed|msword|rtf|json|octet-stream|vnd\.[a-z0-9.-]+)$/.test(mime) ||
    /^text\/(plain|csv|markdown)$/.test(mime);
  if (!ok) return undefined;
  let kind;
  if (mime.startsWith('video/')) kind = 'video';
  else if (mime.startsWith('audio/')) kind = 'audio';
  else if (mime.startsWith('image/')) kind = 'image';
  else kind = 'file';
  return { data: media, kind };
}
// Sanitize a user-supplied filename for display/download.
function cleanMediaName(n) {
  if (typeof n !== 'string') return null;
  const s = n.replace(/[^\w .()\[\]+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || null;
}
// Pull the optional media attachment out of a request body.
// Returns { data, kind, name } (any of which may be null) or undefined if invalid.
function mediaFromBody(body) {
  const media = cleanMedia(body.media);
  if (media === undefined) return undefined;
  if (!media) return { data: null, kind: null, name: null };
  const name = media.kind === 'file' ? cleanMediaName(body.mediaName) : null;
  return { data: media.data, kind: media.kind, name };
}

/* ═══════════════════════════════════════════════
   REALTIME  —  Server-Sent Events (live messages, typing, presence)
   One stream per connection; client→server signals use normal POSTs.
═══════════════════════════════════════════════ */
const rtClients = new Map(); // userId -> Set<res>
function rtSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}
function rtPush(userId, event, data) {
  const set = rtClients.get(userId);
  if (set) for (const res of set) rtSend(res, event, data);
}
function rtBroadcast(event, data, exceptId) {
  for (const [uid, set] of rtClients) {
    if (uid === exceptId) continue;
    for (const res of set) rtSend(res, event, data);
  }
}
async function groupMemberIds(groupId, exceptId) {
  const { rows } = await db.query('SELECT user_id FROM at_group_members WHERE group_id = $1', [groupId]);
  return rows.map((r) => r.user_id).filter((id) => id !== exceptId);
}
// Contact privacy: can `callerId` start a call/video/DM with `targetId`?
// Allowed when the target permits Everyone, or the caller matches a checked
// category (people the target follows / people who follow the target), or the
// caller is on the target's allow-list. A block always denies.
async function canContact(callerId, targetId) {
  if (callerId === targetId) return true;
  // The block check fails CLOSED — a block must never leak through on a DB error.
  try {
    const blocked = await db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [targetId, callerId]);
    if (blocked.rowCount) return false;
  } catch (e) { return false; }
  try {
    const { rows } = await db.query('SELECT pc_everyone, pc_following, pc_followers FROM users WHERE id = $1', [targetId]);
    const p = rows[0];
    if (!p) return false;
    if (p.pc_everyone) return true;
    const al = await db.query('SELECT 1 FROM contact_allow WHERE owner_id = $1 AND allowed_id = $2', [targetId, callerId]);
    if (al.rowCount) return true;
    if (p.pc_following) { // people the target follows
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [targetId, callerId]);
      if (f.rowCount) return true;
    }
    if (p.pc_followers) { // people who follow the target
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [callerId, targetId]);
      if (f.rowCount) return true;
    }
    return false;
  } catch (e) { return false; } // on error, deny rather than over-share
}

// Record a notification for `userId` caused by `actorId` (and push it live).
// `feedId` deep-links feed notifications (post_id stays null for those).
async function notify(userId, actorId, type, postId, feedId) {
  if (!userId || userId === actorId) return;
  try {
    await db.query('INSERT INTO notifications (user_id, actor_id, type, post_id, feed_id) VALUES ($1, $2, $3, $4, $5)', [userId, actorId, type, postId || null, feedId || null]);
    rtPush(userId, 'notif', { type });
  } catch (e) { /* notifications are best-effort */ }
}

// The live event stream. EventSource can't send headers, so the JWT comes as a
// query param (over HTTPS). Presence is derived from active connections.
app.get('/api/rt/stream', (req, res) => {
  const payload = auth.verifyToken(req.query.token);
  if (!payload) return res.status(401).end();
  const uid = payload.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const wasOffline = !rtClients.has(uid);
  if (wasOffline) rtClients.set(uid, new Set());
  rtClients.get(uid).add(res);
  db.query('UPDATE users SET last_seen = now() WHERE id = $1', [uid]).catch(() => {});
  rtSend(res, 'presence-init', { online: [...rtClients.keys()] });
  if (wasOffline) rtBroadcast('presence', { userId: uid, online: true }, uid);
  const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = rtClients.get(uid);
    if (!set) return;
    set.delete(res);
    if (!set.size) {
      rtClients.delete(uid);
      db.query('UPDATE users SET last_seen = now() WHERE id = $1', [uid]).catch(() => {});
      rtBroadcast('presence', { userId: uid, online: false, last_seen: new Date().toISOString() }, uid);
    }
  });
});

// Typing indicator relay (DM or group).
app.post('/api/rt/typing', auth.requireAuth, async (req, res) => {
  const to = parseInt(req.body.to, 10);
  const groupId = parseInt(req.body.groupId, 10);
  try {
    const me = await chatIdentity(req.user.id);
    const from = { id: req.user.id, name: me ? me.name : '' };
    if (Number.isInteger(groupId)) {
      if (await isGroupMember(groupId, req.user.id)) {
        for (const id of await groupMemberIds(groupId, req.user.id)) rtPush(id, 'typing', { from, groupId });
      }
    } else if (Number.isInteger(to)) {
      rtPush(to, 'typing', { from, groupId: null });
    }
  } catch {}
  res.json({ ok: true });
});

// Presence lookup for a set of user ids (online + last seen).
app.get('/api/atchat/presence', auth.requireAuth, async (req, res) => {
  const ids = (req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Number.isInteger).slice(0, 300);
  try {
    const online = new Set(rtClients.keys());
    const { rows } = ids.length ? await db.query('SELECT id, last_seen FROM users WHERE id = ANY($1)', [ids]) : { rows: [] };
    const presence = {};
    ids.forEach((id) => {
      const r = rows.find((x) => x.id === id);
      presence[id] = { online: online.has(id), last_seen: r ? r.last_seen : null };
    });
    res.json({ presence });
  } catch (err) {
    console.error(err);
    res.json({ presence: {} });
  }
});

// Cloudflare Realtime TURN issues short-lived credentials via its API, so we
// mint a batch and cache it until shortly before it expires (rather than calling
// Cloudflare on every request). Returns a TURN ICE server object, or null.
const STUN_SERVER = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
let _cfTurnCache = null; // { server, exp }
async function cloudflareTurnServer() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) return null;
  if (_cfTurnCache && _cfTurnCache.exp > Date.now()) return _cfTurnCache.server;
  const ttl = 86400; // 24h credentials
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl }),
  });
  if (!r.ok) throw new Error('Cloudflare TURN responded ' + r.status);
  const data = await r.json();
  const ice = data.iceServers || data;
  const urls = ice && ice.urls;
  // Only cache a well-formed credential set; otherwise fall through to the fallback.
  if (!urls || (Array.isArray(urls) && !urls.length)) throw new Error('Cloudflare TURN returned no urls');
  const server = { urls, username: ice.username, credential: ice.credential };
  // Refresh ~10 min before the credentials actually expire.
  _cfTurnCache = { server, exp: Date.now() + (ttl - 600) * 1000 };
  return server;
}

// ICE servers for WebRTC. STUN is always on. TURN priority: Cloudflare Realtime
// (env: CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN) → a static TURN
// server (env: TURN_URL[,url2] / TURN_USERNAME / TURN_CREDENTIAL) → a free public
// relay fallback. Every layer degrades gracefully.
app.get('/api/rt/ice-servers', auth.requireAuth, async (_req, res) => {
  const iceServers = [STUN_SERVER];
  try {
    const cf = await cloudflareTurnServer();
    if (cf) { iceServers.push(cf); return res.json({ iceServers }); }
  } catch (e) {
    console.warn('⚠️  Cloudflare TURN unavailable, falling back:', e.message);
  }
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  } else {
    // No TURN configured → fall back to a free public relay so cross-network
    // calls still connect out of the box. For production reliability + capacity,
    // set the Cloudflare or static TURN env vars above.
    iceServers.push({
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  res.json({ iceServers });
});

// Relay a 1:1 call signal (offer / answer / ICE / end / decline / cancel) to the peer.
const _callNotified = new Set(); // de-dupes the bell notification per callId
app.post('/api/rt/call', auth.requireAuth, rateLimit(300, 60000, 'rt-call'), async (req, res) => {
  const to = parseInt(req.body.to, 10);
  const kind = String(req.body.kind || '');
  if (!Number.isInteger(to)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!['offer', 'answer', 'ice', 'end', 'decline', 'cancel'].includes(kind)) {
    return res.status(400).json({ error: 'Invalid call signal.' });
  }
  // Privacy: only gate the initial offer (later signals belong to a live call).
  if (kind === 'offer' && !(await canContact(req.user.id, to))) {
    return res.status(403).json({ error: 'This person isn’t accepting calls from you.' });
  }
  let me = null;
  try { me = await chatIdentity(req.user.id); } catch {}
  // A new incoming call leaves one bell notification (audio vs video) — de-duped
  // by callId so re-sent offers don't spam the callee.
  if (kind === 'offer') {
    const key = (req.body.callId || ('c' + req.user.id + '-' + to)) + ':' + to;
    if (!_callNotified.has(key)) {
      _callNotified.add(key);
      if (_callNotified.size > 5000) _callNotified.clear();
      notify(to, req.user.id, req.body.media === 'video' ? 'video_call' : 'call', null);
    }
  }
  rtPush(to, 'call', {
    kind,
    callId: req.body.callId || null,
    media: req.body.media === 'video' ? 'video' : 'audio',
    sdp: req.body.sdp || null,
    candidate: req.body.candidate || null,
    from: me ? { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } : { id: req.user.id },
  });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════
   CALL LOG  —  recent-calls history (one row per side, like WhatsApp's Calls tab)
═══════════════════════════════════════════════ */
// Record a finished call from the caller's/callee's own point of view.
app.post('/api/calls', auth.requireAuth, async (req, res) => {
  try {
    const peerId = parseInt(req.body.peerId, 10);
    if (!Number.isInteger(peerId) || peerId === req.user.id) {
      return res.status(400).json({ error: 'Invalid call.' });
    }
    const direction = req.body.direction === 'in' ? 'in' : 'out';
    const media = req.body.media === 'video' ? 'video' : 'audio';
    const missed = !!req.body.missed;
    const duration = Math.max(0, Math.min(86400, parseInt(req.body.duration, 10) || 0));
    const { rows } = await db.query(
      `INSERT INTO calls (user_id, peer_id, direction, media, missed, duration)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.user.id, peerId, direction, media, missed, duration]
    );
    res.json({ id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not log the call.' }); }
});

// Recent calls (newest first), joined with the peer's current profile.
app.get('/api/calls', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.direction, c.media, c.missed, c.duration, c.created_at,
              p.id AS peer_id, p.name AS peer_name, p.username AS peer_username, p.avatar AS peer_avatar
       FROM calls c JOIN users p ON p.id = c.peer_id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    const calls = rows.map((r) => ({
      id: r.id, direction: r.direction, media: r.media, missed: r.missed,
      duration: r.duration, created_at: r.created_at,
      peer: { id: r.peer_id, name: r.peer_name, username: r.peer_username, avatar: r.peer_avatar },
    }));
    res.json({ calls });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load calls.' }); }
});

// Delete one call-log entry (mine only).
app.delete('/api/calls/:id', auth.requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
    await db.query('DELETE FROM calls WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});

// Clear the whole call history.
app.delete('/api/calls', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM calls WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not clear.' }); }
});

/* ═══════════════════════════════════════════════
   LIVE STREAMING  —  P2P (broadcaster → viewers) over WebRTC, signaled via SSE
═══════════════════════════════════════════════ */
const liveStreams = new Map(); // streamId -> { id, userId, name, username, avatar, title, startedAt, viewers:Set }

// Start broadcasting: register a live stream.
app.post('/api/live/start', auth.requireAuth, async (req, res) => {
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    // One live stream per user — replace any existing (tell its viewers it ended).
    for (const [sid, s] of liveStreams) if (s.userId === req.user.id) {
      for (const v of s.viewers) rtPush(v, 'live', { kind: 'ended', streamId: sid });
      liveStreams.delete(sid);
    }
    const id = 'live_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    liveStreams.set(id, {
      id, userId: req.user.id, name: me.name, username: me.username, avatar: me.avatar || null,
      title: (req.body.title || '').trim().slice(0, 120), startedAt: Date.now(), viewers: new Set(),
    });
    res.json({ streamId: id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not start the stream.' }); }
});
// Stop broadcasting.
app.post('/api/live/stop', auth.requireAuth, (req, res) => {
  const s = liveStreams.get(req.body.streamId);
  if (s && s.userId === req.user.id) {
    for (const v of s.viewers) rtPush(v, 'live', { kind: 'ended', streamId: s.id });
    liveStreams.delete(s.id);
  }
  res.json({ ok: true });
});
// List active streams (newest first).
app.get('/api/live', auth.requireAuth, (_req, res) => {
  const list = [...liveStreams.values()].sort((a, b) => b.startedAt - a.startedAt).map((s) => ({
    id: s.id, title: s.title, startedAt: s.startedAt, viewers: s.viewers.size,
    user: { id: s.userId, name: s.name, username: s.username, avatar: s.avatar },
  }));
  res.json({ streams: list });
});
// Relay WebRTC signaling between a broadcaster and a viewer.
app.post('/api/live/signal', auth.requireAuth, async (req, res) => {
  const to = parseInt(req.body.to, 10);
  const kind = String(req.body.kind || '');
  const streamId = req.body.streamId || null;
  if (!Number.isInteger(to)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!['watch', 'offer', 'answer', 'ice', 'leave'].includes(kind)) return res.status(400).json({ error: 'Invalid signal.' });
  const s = streamId ? liveStreams.get(streamId) : null;
  if (s) {
    if (kind === 'watch') s.viewers.add(req.user.id);
    if (kind === 'leave') s.viewers.delete(req.user.id);
  }
  let me = null;
  try { me = await chatIdentity(req.user.id); } catch {}
  rtPush(to, 'live', {
    kind, streamId,
    sdp: req.body.sdp || null, candidate: req.body.candidate || null,
    viewers: s ? s.viewers.size : 0,
    from: me ? { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } : { id: req.user.id },
  });
  res.json({ ok: true });
});

// Issue a single-use token (verification / reset), storing only its hash.
async function issueToken(userId, type, ttlMs) {
  const raw = auth.makeToken();
  await db.query(
    'INSERT INTO auth_tokens (token_hash, user_id, type, expires_at) VALUES ($1, $2, $3, $4)',
    [auth.hashToken(raw), userId, type, new Date(Date.now() + ttlMs)]
  );
  return raw;
}

// Atomically validate + consume a token, returning its user_id or null.
async function consumeToken(raw, type) {
  if (!raw) return null;
  const { rows } = await db.query(
    `DELETE FROM auth_tokens
     WHERE token_hash = $1 AND type = $2 AND expires_at > now()
     RETURNING user_id`,
    [auth.hashToken(raw), type]
  );
  return rows[0]?.user_id || null;
}

async function sendVerifyEmail(user, rawToken) {
  const link = `${mailer.appUrl()}/?verify=${rawToken}`;
  await mailer.sendMail({
    to: user.email,
    subject: 'Verify your Atwe AI email',
    text: `Welcome to Atwe AI! Confirm your email address: ${link}`,
    html: `<p>Welcome to Atwe AI!</p><p><a href="${link}">Confirm your email address</a></p>`,
  });
}

async function sendSignupCode(email, name, code) {
  await mailer.sendMail({
    to: email,
    subject: `${code} is your Atwe verification code`,
    text:
      `Hi ${name || 'there'},\n\n` +
      `Your Atwe verification code is: ${code}\n\n` +
      `Enter it to finish creating your account. The code expires in 15 minutes.\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html:
      `<p>Hi ${name || 'there'},</p>` +
      `<p>Your Atwe verification code is:</p>` +
      `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:14px 0;">${code}</p>` +
      `<p>Enter it to finish creating your account. The code expires in 15 minutes.</p>` +
      `<p style="color:#888;">If you didn't request this, you can ignore this email.</p>`,
  });
}

async function sendResetEmail(user, rawToken) {
  const link = `${mailer.appUrl()}/?reset=${rawToken}`;
  await mailer.sendMail({
    to: user.email,
    subject: 'Reset your Atwe AI password',
    text: `Reset your Atwe AI password: ${link} (link expires in 1 hour)`,
    html: `<p><a href="${link}">Reset your Atwe AI password</a></p><p>This link expires in 1 hour.</p>`,
  });
}

async function sendWelcomeEmail(user) {
  const link = mailer.appUrl();
  await mailer.sendMail({
    to: user.email,
    subject: 'Welcome to Atwe AI',
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `Welcome to Atwe AI — your intelligent assistant for business.\n\n` +
      `Start your first conversation any time: ${link}\n\n` +
      `— The Atwe AI team`,
    html:
      `<p>Hi ${user.name || 'there'},</p>` +
      `<p>Welcome to <strong>Atwe AI</strong> — your intelligent assistant for business.</p>` +
      `<p><a href="${link}">Open Atwe AI</a> to start your first conversation.</p>` +
      `<p>— The Atwe AI team</p>`,
  });
}

async function sendProWelcomeEmail(user) {
  const link = mailer.appUrl();
  await mailer.sendMail({
    to: user.email,
    subject: "You're now on Atwe Pro",
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `Your upgrade to Atwe Pro is complete — thank you!\n\n` +
      `You now have access to longer, more in-depth responses and priority performance.\n\n` +
      `Pick up where you left off: ${link}\n\n` +
      `— The Atwe AI team`,
    html:
      `<p>Hi ${user.name || 'there'},</p>` +
      `<p>Your upgrade to <strong>Atwe Pro</strong> is complete — thank you!</p>` +
      `<p>You now have access to longer, more in-depth responses and priority performance.</p>` +
      `<p><a href="${link}">Open Atwe AI</a> to pick up where you left off.</p>` +
      `<p>— The Atwe AI team</p>`,
  });
}

// Notify a user by email that the Atwe team sent them a message in-app.
async function sendAdminMessageEmail(user, body) {
  const link = mailer.appUrl();
  const preview = body.length > 280 ? body.slice(0, 280) + '…' : body;
  await mailer.sendMail({
    to: user.email,
    subject: 'New message from the Atwe team',
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `You have a new message from the Atwe team:\n\n` +
      `"${preview}"\n\n` +
      `Open Atwe to read it and reply: ${link}\n\n` +
      `— The Atwe team`,
    html:
      `<p>Hi ${escapeHtml(user.name || 'there')},</p>` +
      `<p>You have a new message from the <strong>Atwe</strong> team:</p>` +
      `<blockquote style="margin:14px 0;padding:10px 16px;border-left:3px solid #6366f1;color:#444;">${escapeHtml(preview)}</blockquote>` +
      `<p><a href="${link}">Open Atwe</a> to read it and reply.</p>` +
      `<p>— The Atwe team</p>`,
  });
}

// Exact age in years from a YYYY-MM-DD date of birth (null if unparseable).
function ageFromDob(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
// X-style auto handle: the name (sanitized) + random digits, guaranteed unique.
function baseUsernameFromName(name) {
  let base = (name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]/g, '');
  return (base || 'user').slice(0, 20);
}
async function generateUsername(name) {
  const base = baseUsernameFromName(name);
  for (let i = 0; i < 15; i++) {
    const cand = base + Math.floor(1000 + Math.random() * 90000);
    const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [cand]);
    if (!taken.rowCount) return cand;
  }
  return base + Date.now().toString().slice(-7);
}

// Is a username admin-locked (reserved)? Locked names can't be registered or
// switched-to by anyone (the current holder, if any, keeps theirs).
async function usernameReserved(username) {
  if (!username) return false;
  try {
    const r = await db.query('SELECT 1 FROM reserved_usernames WHERE username = lower($1)', [username]);
    return r.rowCount > 0;
  } catch { return false; }
}

function makeSignupCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
const SIGNUP_CODE_TTL = 15 * 60 * 1000;

// Step 1: validate the details, stash a pending signup, and email a 6-digit code.
// No real account exists until the code is confirmed (step 2).
app.post('/api/auth/signup', rateLimit(15, 60000, 'signup'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const dob = (req.body.dob || '').trim();

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!dob) return res.status(400).json({ error: 'Please enter your date of birth.' });
  const age = ageFromDob(dob);
  if (age === null || age > 120) return res.status(400).json({ error: 'Please enter a valid date of birth.' });
  if (age < 18) return res.status(403).json({ error: 'You must be at least 18 years old to create an account.' });

  let wantUser = (req.body.username || '').trim().replace(/^@/, '');
  if (wantUser) {
    if (wantUser.length > 40) return res.status(400).json({ error: 'Username is too long.' });
    if (!/^[a-zA-Z0-9._-]+$/.test(wantUser)) {
      return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
    }
  }

  try {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'An account with that email already exists.' });
    if (wantUser) {
      const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [wantUser]);
      if (taken.rowCount) return res.status(409).json({ error: 'That username is already taken.' });
      if (await usernameReserved(wantUser)) return res.status(409).json({ error: 'That username isn’t available.' });
    }

    const hash = await auth.hashPassword(password);
    const code = makeSignupCode();
    await db.query(
      `INSERT INTO pending_signups (email, name, password_hash, dob, username, code_hash, attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, dob = EXCLUDED.dob,
         username = EXCLUDED.username, code_hash = EXCLUDED.code_hash, attempts = 0,
         expires_at = EXCLUDED.expires_at, created_at = now()`,
      [email, name, hash, dob, wantUser || null, auth.hashToken(code), new Date(Date.now() + SIGNUP_CODE_TTL)]
    );
    try { await sendSignupCode(email, name, code); }
    catch (e) { console.error('Signup code email failed:', e.message); }
    res.json({ pending: true, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Step 2: confirm the emailed code → create the (email-verified) account.
app.post('/api/auth/signup/verify', rateLimit(20, 60000, 'signup-verify'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const code = (req.body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  try {
    const p = await db.query('SELECT * FROM pending_signups WHERE email = $1', [email]);
    const pend = p.rows[0];
    if (!pend || new Date(pend.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'That code has expired. Please start again.' });
    }
    if (pend.attempts >= 6) {
      await db.query('DELETE FROM pending_signups WHERE email = $1', [email]);
      return res.status(429).json({ error: 'Too many attempts. Please start again.' });
    }
    if (auth.hashToken(code) !== pend.code_hash) {
      await db.query('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = $1', [email]);
      return res.status(400).json({ error: 'That code is incorrect. Please try again.' });
    }
    // Code is good — create the verified account.
    if (pend.username && await usernameReserved(pend.username)) {
      return res.status(409).json({ error: 'That username isn’t available. Please choose another.' });
    }
    let username = pend.username || await generateUsername(pend.name);
    const isAdmin = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
    const dobStr = pend.dob ? new Date(pend.dob).toISOString().slice(0, 10) : null;
    const insert = (u) => db.query(
      `INSERT INTO users (name, email, password_hash, is_admin, email_verified, last_login_at, username, dob)
       VALUES ($1, $2, $3, $4, true, now(), $5, $6)
       RETURNING id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob`,
      [pend.name, email, pend.password_hash, isAdmin, u, dobStr]
    );
    let rows;
    try { ({ rows } = await insert(username)); }
    catch (e) {
      if (e.code === '23505') {
        // email or username taken in the meantime
        const emailTaken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
        if (emailTaken.rowCount) { await db.query('DELETE FROM pending_signups WHERE email = $1', [email]); return res.status(409).json({ error: 'An account with that email already exists.' }); }
        if (pend.username) return res.status(409).json({ error: 'That username is already taken.' });
        ({ rows } = await insert(await generateUsername(pend.name)));
      } else throw e;
    }
    await db.query('DELETE FROM pending_signups WHERE email = $1', [email]);
    const user = rows[0];
    try { await sendWelcomeEmail(user); } catch (e) { console.error('Welcome email failed:', e.message); }
    res.status(201).json({ token: auth.signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Re-send the signup code (no enumeration; always 200 when a pending signup exists).
app.post('/api/auth/signup/resend', rateLimit(6, 60000, 'signup-resend'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  try {
    const p = await db.query('SELECT name FROM pending_signups WHERE email = $1', [email]);
    if (p.rows[0]) {
      const code = makeSignupCode();
      await db.query('UPDATE pending_signups SET code_hash = $1, attempts = 0, expires_at = $2 WHERE email = $3',
        [auth.hashToken(code), new Date(Date.now() + SIGNUP_CODE_TTL), email]);
      try { await sendSignupCode(email, p.rows[0].name, code); } catch (e) { console.error('Resend code failed:', e.message); }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: true });
  }
});

app.post('/api/auth/login', rateLimit(12, 60000), async (req, res) => {
  // Accept either an email or a @username as the identifier.
  const identifier = (req.body.identifier || req.body.email || '').trim().toLowerCase().replace(/^@/, '');
  const password = req.body.password || '';
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Enter your email or username and password.' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob, password_hash FROM users WHERE lower(email) = $1 OR lower(username) = $1',
      [identifier]
    );
    const user = rows[0];
    // Always run a bcrypt comparison (even when the user doesn't exist) so the
    // response time doesn't reveal whether an account exists.
    const ok = await auth.verifyPassword(password, user ? user.password_hash : auth.DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before signing in.' });
    }
    // Record the sign-in so the admin dashboard can show login activity.
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]).catch(() => {});
    // Security alert: a self-notification that a new sign-in happened.
    db.query('INSERT INTO notifications (user_id, actor_id, type) VALUES ($1, $1, $2)', [user.id, 'login']).catch(() => {});
    rtPush(user.id, 'notif', { type: 'login' });
    res.json({ token: auth.signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Refresh the client's view of the account (plan/admin may change server-side).
app.get('/api/auth/me', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update the signed-in user's profile: display name, @username, avatar photo.
app.put('/api/auth/profile', auth.requireAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  const username = (req.body.username || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Name is too long.' });
  if (username.length > 40) return res.status(400).json({ error: 'Username is too long.' });
  if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
  }
  // Block switching to an admin-locked username (but let the holder keep one
  // that was locked after they already had it).
  if (username && await usernameReserved(username)) {
    const mine = await db.query('SELECT 1 FROM users WHERE id = $1 AND lower(username) = lower($2)', [req.user.id, username]);
    if (!mine.rowCount) return res.status(409).json({ error: 'That username isn’t available.' });
  }

  // avatar / banner: absent = leave unchanged; '' / null = remove; data URL = set.
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  let setBanner = false, bannerVal = null;
  if ('banner' in req.body) {
    bannerVal = cleanImage(req.body.banner);
    if (bannerVal === undefined) return res.status(400).json({ error: 'That banner image could not be used.' });
    setBanner = true;
  }

  // birthday (dob): absent = unchanged; '' / null = clear; YYYY-MM-DD = set (must be 18+).
  let setDob = false, dobVal = null;
  if ('dob' in req.body) {
    const raw = (req.body.dob || '').trim();
    if (raw) {
      const age = ageFromDob(raw);
      if (age === null) return res.status(400).json({ error: 'Enter a valid date of birth.' });
      if (age < 18) return res.status(400).json({ error: 'You must be at least 18 years old.' });
      dobVal = raw;
    }
    setDob = true;
  }

  const fields = ['name = $1', 'username = $2'];
  const vals = [name, username || null];
  if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
  if (setBanner) { vals.push(bannerVal); fields.push(`banner = $${vals.length}`); }
  if (setDob) { vals.push(dobVal); fields.push(`dob = $${vals.length}`); }
  vals.push(req.user.id);

  try {
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${vals.length}
       RETURNING id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Erase ALL of the user's history — posts, comments, DMs, group messages, AI
// chats and notifications. The account, profile and username are kept.
app.delete('/api/auth/me/history', auth.requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    // Posts (cascades replies/likes/poll data/circle+feed links via FKs).
    await db.query('DELETE FROM posts WHERE user_id = $1', [uid]);
    // My likes / poll votes on other people's posts.
    await db.query('DELETE FROM post_likes WHERE user_id = $1', [uid]).catch(() => {});
    await db.query('DELETE FROM post_poll_votes WHERE user_id = $1', [uid]).catch(() => {});
    // Direct messages (both directions) and my group messages.
    await db.query('DELETE FROM at_messages WHERE sender_id = $1 OR recipient_id = $1', [uid]).catch(() => {});
    await db.query('DELETE FROM at_group_messages WHERE sender_id = $1', [uid]).catch(() => {});
    // AI assistant chats + projects.
    await db.query('DELETE FROM chats WHERE user_id = $1', [uid]).catch(() => {});
    await db.query('DELETE FROM projects WHERE user_id = $1', [uid]).catch(() => {});
    // Notifications to me or caused by me.
    await db.query('DELETE FROM notifications WHERE user_id = $1 OR actor_id = $1', [uid]).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Confirm an email address from the link in the verification email.
app.post('/api/auth/verify', async (req, res) => {
  try {
    const userId = await consumeToken(req.body.token, 'verify');
    if (!userId) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
    await db.query('UPDATE users SET email_verified = true WHERE id = $1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Re-send the verification email to the signed-in user.
app.post('/api/auth/resend-verification', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    const raw = await issueToken(user.id, 'verify', 24 * 60 * 60 * 1000);
    await sendVerifyEmail(user, raw);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Start a password reset. Always 200 — never reveal whether the email exists.
app.post('/api/auth/forgot', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  try {
    if (email) {
      const { rows } = await db.query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
      if (rows[0]) {
        const raw = await issueToken(rows[0].id, 'reset', 60 * 60 * 1000); // 1 hour
        await sendResetEmail(rows[0], raw);
      }
    }
  } catch (err) {
    console.error('Password reset request failed:', err.message);
  }
  res.json({ ok: true });
});

// Complete a password reset using the emailed token.
app.post('/api/auth/reset', async (req, res) => {
  const password = req.body.password || '';
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const userId = await consumeToken(req.body.token, 'reset');
    if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    const hash = await auth.hashPassword(password);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    // Invalidate any other outstanding reset tokens for this user.
    await db.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'reset'`, [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   PROJECTS  —  /api/projects
═══════════════════════════════════════════════ */
app.get('/api/projects', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ projects: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Upsert (idempotent create/rename) keyed by the client-generated id.
app.put('/api/projects/:id', auth.requireAuth, async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required.' });
  try {
    await db.query(
      `INSERT INTO projects (id, user_id, title) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
       WHERE projects.user_id = $2`,
      [req.params.id, req.user.id, title]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/projects/:id', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   CHATS  —  /api/chats
═══════════════════════════════════════════════ */
app.get('/api/chats', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, project_id, title, messages, created_at
       FROM chats WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ chats: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/chats/:id', auth.requireAuth, async (req, res) => {
  const title = (req.body.title || 'New chat').slice(0, 200);
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  const projectId = req.body.projectId || null;
  try {
    await db.query(
      `INSERT INTO chats (id, user_id, project_id, title, messages, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             messages = EXCLUDED.messages,
             project_id = EXCLUDED.project_id,
             updated_at = now()
       WHERE chats.user_id = $2`,
      [req.params.id, req.user.id, projectId, title, JSON.stringify(messages)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/chats/:id', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/chats', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM chats WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   MESSAGES  —  user side of the admin ↔ user thread
   The signed-in user reads messages from the Atwe team and replies.
═══════════════════════════════════════════════ */
app.get('/api/messages', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, sender, body, image, read_by_user, created_at
       FROM admin_messages WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );
    const unread = rows.filter((m) => m.sender === 'admin' && !m.read_by_user).length;
    res.json({
      messages: rows.map((m) => ({ id: m.id, sender: m.sender, body: m.body, image: m.image || null, created_at: m.created_at })),
      unread,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Mark all admin-sent messages as read (clears the user's unread badge).
app.post('/api/messages/read', auth.requireAuth, async (req, res) => {
  try {
    await db.query(
      `UPDATE admin_messages SET read_by_user = true
       WHERE user_id = $1 AND sender = 'admin' AND read_by_user = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// The user replies to the Atwe team; the reply surfaces in the admin dashboard.
app.post('/api/messages', auth.requireAuth, rateLimit(20, 60000), async (req, res) => {
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  if (!body && !image) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const { rows } = await db.query(
      `INSERT INTO admin_messages (user_id, sender, body, image, read_by_user, read_by_admin)
       VALUES ($1, 'user', $2, $3, true, false)
       RETURNING id, sender, body, image, created_at`,
      [req.user.id, body, image]
    );
    res.json({ message: { ...rows[0], image: rows[0].image || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ATCHAT  —  user ↔ user direct messages (X-style)
   Requires the signed-in user to have a @username.
═══════════════════════════════════════════════ */
async function chatIdentity(userId) {
  const { rows } = await db.query('SELECT id, name, username, avatar FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}
// Strict numeric id from a route param (rejects "5abc" etc.).
function routeId(v) {
  return /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
}
const NEED_USERNAME = { error: 'Choose a username first to use AtChat.', code: 'username_required' };

// Find users by @username (or name) to start a conversation.
app.get('/api/atchat/search', auth.requireAuth, rateLimit(60, 60000, 'atchat-search'), async (req, res) => {
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const q = (req.query.q || '').toString().trim().replace(/^@/, '');
    if (q.length < 1) return res.json({ users: [] });
    const { rows } = await db.query(
      `SELECT id, name, username, avatar FROM users
       WHERE username IS NOT NULL AND id <> $1 AND (username ILIKE $2 OR name ILIKE $2)
       ORDER BY (username ILIKE $3) DESC, username ASC LIMIT 12`,
      [req.user.id, '%' + q + '%', q + '%']
    );
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// List the signed-in user's conversations (latest message + unread count each).
app.get('/api/atchat/conversations', auth.requireAuth, async (req, res) => {
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const { rows } = await db.query(
      `SELECT partner.id, partner.name, partner.username, partner.avatar,
              lm.body AS last_body, (lm.image IS NOT NULL) AS last_image, lm.media_kind AS last_media_kind,
              lm.created_at AS last_at, (lm.sender_id = $1) AS last_mine,
              COALESCE(uc.unread, 0)::int AS unread
       FROM (
         SELECT DISTINCT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id
         FROM at_messages WHERE sender_id = $1 OR recipient_id = $1
       ) p
       JOIN users partner ON partner.id = p.other_id AND partner.username IS NOT NULL
       LEFT JOIN at_cleared cl ON cl.user_id = $1 AND cl.other_id = p.other_id
       JOIN LATERAL (
         SELECT body, image, media_kind, created_at, sender_id FROM at_messages m
         WHERE ((m.sender_id = $1 AND m.recipient_id = p.other_id)
            OR (m.sender_id = p.other_id AND m.recipient_id = $1))
           AND m.created_at > COALESCE(cl.cleared_at, '-infinity'::timestamptz)
         ORDER BY created_at DESC LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread FROM at_messages m
         WHERE m.sender_id = p.other_id AND m.recipient_id = $1 AND m.read_at IS NULL
           AND m.created_at > COALESCE(cl.cleared_at, '-infinity'::timestamptz)
       ) uc ON true
       ORDER BY lm.created_at DESC`,
      [req.user.id]
    );
    res.json({ conversations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Unread split into DMs vs groups (for the AtChat badge + the Messages/Groups tab dots).
app.get('/api/atchat/unread', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM at_messages am WHERE am.recipient_id = $1 AND am.read_at IS NULL
                 AND am.created_at > COALESCE((SELECT cleared_at FROM at_cleared cl WHERE cl.user_id = $1 AND cl.other_id = am.sender_id), '-infinity'::timestamptz)) AS dm,
              (SELECT COUNT(*)::int FROM at_group_members m
                 JOIN at_group_messages x ON x.group_id = m.group_id
                 WHERE m.user_id = $1 AND x.sender_id <> $1 AND x.created_at > m.last_read_at) AS grp`,
      [req.user.id]
    );
    const dm = rows[0]?.dm || 0, grp = rows[0]?.grp || 0;
    res.json({ unread: dm + grp, dmUnread: dm, groupUnread: grp });
  } catch (err) {
    console.error(err);
    res.json({ unread: 0, dmUnread: 0, groupUnread: 0 });
  }
});

// Mark a DM thread read (used when a live message lands while it's open).
app.post('/api/atchat/with/:id/read', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const r = await db.query('UPDATE at_messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL', [req.user.id, other]);
    if (r.rowCount) rtPush(other, 'read', { peerId: req.user.id }); // tell the sender their messages were seen
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});
// Mark a group thread read.
app.post('/api/atchat/groups/:id/read', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    await db.query('UPDATE at_group_members SET last_read_at = now() WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});

// Read the thread with one user (marks their messages to me as read).
app.get('/api/atchat/with/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const peer = await chatIdentity(other);
    if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `SELECT id, sender_id, body, image, media, media_kind, media_name, created_at, read_at FROM at_messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         AND created_at > COALESCE((SELECT cleared_at FROM at_cleared WHERE user_id = $1 AND other_id = $2), '-infinity'::timestamptz)
       ORDER BY created_at ASC`,
      [req.user.id, other]
    );
    // Only mark the messages we actually returned as read — avoids clearing the
    // unread badge for a message that arrived after this SELECT.
    const lastId = rows.length ? rows[rows.length - 1].id : 0;
    db.query(
      `UPDATE at_messages SET read_at = now()
       WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL AND id <= $3`,
      [req.user.id, other, lastId]
    ).then((r) => { if (r.rowCount) rtPush(other, 'read', { peerId: req.user.id }); }).catch(() => {});
    res.json({
      peer: { id: peer.id, name: peer.name, username: peer.username, avatar: peer.avatar || null },
      messages: rows.map((m) => ({
        id: m.id, body: m.body, image: m.image || null,
        media: m.media || null, media_kind: m.media_kind || null, media_name: m.media_name || null,
        created_at: m.created_at, mine: m.sender_id === req.user.id, read_at: m.read_at || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Send a DM to another user.
app.post('/api/atchat/with/:id', auth.requireAuth, rateLimit(40, 60000, 'atchat-send'), async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  if (other === req.user.id) return res.status(400).json({ error: 'You cannot message yourself.' });
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That file could not be attached (unsupported type or too large — 16 MB max).' });
  if (!body && !image && !media.data) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const peer = await chatIdentity(other);
    if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
    if (!(await canContact(req.user.id, other))) {
      return res.status(403).json({ error: 'This person isn’t accepting messages from you.' });
    }
    const { rows } = await db.query(
      `INSERT INTO at_messages (sender_id, recipient_id, body, image, media, media_kind, media_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, body, image, media, media_kind, media_name, created_at`,
      [req.user.id, other, body, image, media.data, media.kind, media.name]
    );
    const r = rows[0];
    const msg = { id: r.id, body: r.body, image: r.image || null, media: r.media || null, media_kind: r.media_kind || null, media_name: r.media_name || null, created_at: r.created_at };
    // Live-deliver to the recipient (their copy is not "mine").
    rtPush(other, 'msg', { kind: 'dm', peerId: req.user.id, message: { ...msg, mine: false } });
    notify(other, req.user.id, 'message', null);
    res.json({ message: { ...msg, mine: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete (clear) a DM conversation for me — hides messages up to now; the chat
// reappears only if a new message arrives. The other person keeps their copy.
app.delete('/api/atchat/with/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query(
      `INSERT INTO at_cleared (user_id, other_id, cleared_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id, other_id) DO UPDATE SET cleared_at = now()`,
      [req.user.id, other]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ── AtChat group chats (multi-person threads) ── */
async function isGroupMember(groupId, userId) {
  const { rows } = await db.query('SELECT 1 FROM at_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return rows.length > 0;
}

// A group's @username follows the same rules as a user's handle.
const GROUP_USERNAME_RE = /^[a-zA-Z0-9._-]+$/;
function cleanGroupUsername(raw) {
  const username = (raw || '').trim().replace(/^@/, '');
  if (!username) return { error: 'Choose a username for the group.' };
  if (username.length > 40) return { error: 'Group username is too long.' };
  if (!GROUP_USERNAME_RE.test(username)) {
    return { error: 'Username can use letters, numbers, dots, dashes and underscores.' };
  }
  return { username };
}

// Create a group: needs a @username (the creator becomes its admin). Display
// name and avatar are optional and can be changed later by the admin.
app.post('/api/atchat/groups', auth.requireAuth, rateLimit(20, 60000, 'group-create'), async (req, res) => {
  const u = cleanGroupUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  const username = u.username;
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Group name is too long.' });
  if (!name) name = username; // fall back to the handle as the display name
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  const members = Array.isArray(req.body.members) ? req.body.members : [];
  const ids = [...new Set(members.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n !== req.user.id))];
  if (!ids.length) return res.status(400).json({ error: 'Add at least one other person.' });
  if (ids.length > 49) return res.status(400).json({ error: 'Groups are limited to 50 people.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    // Keep only real users who have a username.
    const valid = await db.query('SELECT id FROM users WHERE id = ANY($1) AND username IS NOT NULL', [ids]);
    if (!valid.rows.length) return res.status(400).json({ error: 'None of those users could be added.' });
    let g;
    try {
      g = await db.query(
        'INSERT INTO at_groups (name, username, avatar, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, username, avatar, req.user.id]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That group username is already taken.' });
      throw e;
    }
    const gid = g.rows[0].id;
    const all = [req.user.id, ...valid.rows.map((r) => r.id)];
    const valuesSql = all.map((_, i) => `($1, $${i + 2})`).join(', ');
    await db.query(`INSERT INTO at_group_members (group_id, user_id) VALUES ${valuesSql} ON CONFLICT DO NOTHING`, [gid, ...all]);
    res.json({ group: { id: gid, name, username, avatar: avatar || null, members: all.length } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a group's identity (admin only): display name, @username, avatar.
app.patch('/api/atchat/groups/:id', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const u = cleanGroupUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Group name is too long.' });
  if (!name) name = u.username;
  // avatar: absent = leave unchanged; '' / null = remove; data URL = set.
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  try {
    const g = await db.query('SELECT created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    if (g.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the group admin can edit this group.' });
    const fields = ['name = $1', 'username = $2'];
    const vals = [name, u.username];
    if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
    vals.push(gid);
    let upd;
    try {
      upd = await db.query(
        `UPDATE at_groups SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING id, name, username, avatar, created_by`,
        vals
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That group username is already taken.' });
      throw e;
    }
    const r = upd.rows[0];
    res.json({ group: { id: r.id, name: r.name, username: r.username, avatar: r.avatar || null, createdBy: r.created_by } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// List the groups I'm in (latest message + unread each).
app.get('/api/atchat/groups', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.username, g.avatar,
              (SELECT COUNT(*)::int FROM at_group_members m WHERE m.group_id = g.id) AS members,
              lm.body AS last_body, (lm.image IS NOT NULL) AS last_image, lm.media_kind AS last_media_kind, lm.created_at AS last_at,
              lm.sender_name AS last_sender, (lm.sender_id = $1) AS last_mine,
              (SELECT COUNT(*)::int FROM at_group_messages x
                 WHERE x.group_id = g.id AND x.created_at > me.last_read_at AND x.sender_id <> $1) AS unread
       FROM at_group_members me
       JOIN at_groups g ON g.id = me.group_id
       LEFT JOIN LATERAL (
         SELECT m.body, m.image, m.media_kind, m.created_at, m.sender_id, u.name AS sender_name
         FROM at_group_messages m JOIN users u ON u.id = m.sender_id
         WHERE m.group_id = g.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       WHERE me.user_id = $1
       ORDER BY COALESCE(lm.created_at, g.created_at) DESC`,
      [req.user.id]
    );
    res.json({ groups: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read a group thread (members + messages); marks it read for me.
app.get('/api/atchat/groups/:id', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const g = await db.query('SELECT id, name, username, avatar, created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    const members = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar FROM at_group_members m
       JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY m.joined_at`,
      [gid]
    );
    const msgs = await db.query(
      `SELECT m.id, m.body, m.image, m.media, m.media_kind, m.media_name, m.created_at, m.sender_id,
              u.name AS sender_name, u.username AS sender_username, u.avatar AS sender_avatar
       FROM at_group_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = $1 ORDER BY m.created_at ASC`,
      [gid]
    );
    db.query('UPDATE at_group_members SET last_read_at = now() WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]).catch(() => {});
    res.json({
      group: { id: g.rows[0].id, name: g.rows[0].name, username: g.rows[0].username || null, avatar: g.rows[0].avatar || null, createdBy: g.rows[0].created_by },
      members: members.rows.map((m) => ({ id: m.id, name: m.name, username: m.username, avatar: m.avatar || null })),
      messages: msgs.rows.map((m) => ({
        id: m.id, body: m.body, image: m.image || null,
        media: m.media || null, media_kind: m.media_kind || null, media_name: m.media_name || null,
        created_at: m.created_at, mine: m.sender_id === req.user.id,
        sender: { id: m.sender_id, name: m.sender_name, username: m.sender_username, avatar: m.sender_avatar || null },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Send a message to a group.
app.post('/api/atchat/groups/:id/messages', auth.requireAuth, rateLimit(60, 60000, 'group-send'), async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That file could not be attached (unsupported type or too large — 16 MB max).' });
  if (!body && !image && !media.data) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const me = await chatIdentity(req.user.id);
    const ins = await db.query(
      `INSERT INTO at_group_messages (group_id, sender_id, body, image, media, media_kind, media_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, body, image, media, media_kind, media_name, created_at`,
      [gid, req.user.id, body, image, media.data, media.kind, media.name]
    );
    const r = ins.rows[0];
    const base = {
      id: r.id, body: r.body, image: r.image || null,
      media: r.media || null, media_kind: r.media_kind || null, media_name: r.media_name || null,
      created_at: r.created_at,
      sender: { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null },
    };
    // Live-deliver to the other group members.
    const out = { kind: 'group', groupId: gid, message: { ...base, mine: false } };
    for (const id of await groupMemberIds(gid, req.user.id)) rtPush(id, 'msg', out);
    res.json({ message: { ...base, mine: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Add people to a group (any member can add).
app.post('/api/atchat/groups/:id/members', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const ids = [...new Set((Array.isArray(req.body.members) ? req.body.members : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ error: 'No one to add.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const valid = await db.query('SELECT id FROM users WHERE id = ANY($1) AND username IS NOT NULL', [ids]);
    for (const r of valid.rows) {
      await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, r.id]);
    }
    res.json({ ok: true, added: valid.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Leave a group.
app.delete('/api/atchat/groups/:id/members/me', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    await db.query('DELETE FROM at_group_members WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
    // Clean up empty groups.
    await db.query('DELETE FROM at_groups g WHERE g.id = $1 AND NOT EXISTS (SELECT 1 FROM at_group_members m WHERE m.group_id = g.id)', [gid]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   SOCIAL  —  follow + public posts (AtChat)
   Requires a @username. Posts are public on a user's profile.
═══════════════════════════════════════════════ */
const POSTS_SELECT = `
  SELECT p.id, p.body, p.image, p.media, p.media_kind, p.created_at, p.parent_id, p.location,
         u.id AS author_id, u.name AS author_name, u.username AS author_username, u.avatar AS author_avatar,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)::int AS likes,
         (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id)::int AS replies,
         EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1) AS liked,
         (p.user_id = $1) AS mine,
         (SELECT json_agg(json_build_object('id', c.id, 'username', c.username, 'name', c.name))
            FROM post_circles pc JOIN circles c ON c.id = pc.circle_id WHERE pc.post_id = p.id) AS circles,
         (SELECT json_agg(json_build_object('id', f.id, 'username', f.username, 'name', f.name))
            FROM post_feeds pf JOIN feeds f ON f.id = pf.feed_id WHERE pf.post_id = p.id) AS feeds,
         (SELECT json_agg(json_build_object('id', o.id, 'text', o.text,
                            'votes', (SELECT COUNT(*)::int FROM post_poll_votes v WHERE v.option_id = o.id)) ORDER BY o.position)
            FROM post_poll_options o WHERE o.post_id = p.id) AS poll_options,
         (SELECT option_id FROM post_poll_votes v WHERE v.post_id = p.id AND v.user_id = $1) AS my_vote
  FROM posts p JOIN users u ON u.id = p.user_id `;
function mapPost(r) {
  let poll = null;
  if (r.poll_options && r.poll_options.length) {
    const total = r.poll_options.reduce((s, o) => s + o.votes, 0);
    poll = { options: r.poll_options, total, myVote: r.my_vote || null };
  }
  return {
    id: r.id, body: r.body, image: r.image || null,
    media: r.media || null, mediaKind: r.media_kind || null, created_at: r.created_at,
    parentId: r.parent_id || null, location: r.location || null,
    likes: r.likes, replies: r.replies || 0, liked: r.liked, mine: r.mine,
    circles: r.circles || [], feeds: r.feeds || [], poll,
    author: { id: r.author_id, name: r.author_name, username: r.author_username, avatar: r.author_avatar || null },
  };
}
async function requireHandle(req, res) {
  const me = await chatIdentity(req.user.id);
  if (!me || !me.username) { res.status(403).json(NEED_USERNAME); return null; }
  return me;
}

// Public profile by @username: identity, counts, follow state, and their posts.
// Lightweight follow counts for the signed-in user (sidebar profile block).
app.get('/api/social/mystats', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS followers,
              (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.json({ followers: 0, following: 0 }); }
});

// The followers / following list for a user (by @username).
app.get('/api/social/follows/:username', auth.requireAuth, async (req, res) => {
  const username = (req.params.username || '').trim().replace(/^@/, '');
  const type = req.query.type === 'followers' ? 'followers' : 'following';
  try {
    const t = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
    if (!t.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const uid = t.rows[0].id;
    // followers → people who follow uid; following → people uid follows.
    const sql = type === 'followers'
      ? `SELECT u.id, u.name, u.username, u.avatar FROM follows f JOIN users u ON u.id = f.follower_id
         WHERE f.following_id = $1 AND u.username IS NOT NULL ORDER BY lower(u.name) LIMIT 200`
      : `SELECT u.id, u.name, u.username, u.avatar FROM follows f JOIN users u ON u.id = f.following_id
         WHERE f.follower_id = $1 AND u.username IS NOT NULL ORDER BY lower(u.name) LIMIT 200`;
    const { rows } = await db.query(sql, [uid]);
    res.json({ users: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/social/profile/:username', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const handle = (req.params.username || '').replace(/^@/, '');
    const u = await db.query('SELECT id, name, username, avatar, banner FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const t = u.rows[0];
    const [counts, posts] = await Promise.all([
      db.query(
        `SELECT (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS followers,
                (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following,
                (SELECT COUNT(*)::int FROM posts   WHERE user_id      = $1 AND parent_id IS NULL) AS posts,
                EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) AS is_following,
                EXISTS(SELECT 1 FROM contacts WHERE owner_id = $2 AND contact_id = $1) AS is_contact,
                EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $1) AS is_blocked,
                EXISTS(SELECT 1 FROM post_notify WHERE user_id = $2 AND target_id = $1) AS is_notifying`,
        [t.id, req.user.id]
      ),
      db.query(POSTS_SELECT + 'WHERE p.user_id = $2 AND p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() ORDER BY p.created_at DESC LIMIT 50', [req.user.id, t.id]),
    ]);
    res.json({
      user: { id: t.id, name: t.name, username: t.username, avatar: t.avatar || null, banner: t.banner || null },
      counts: { followers: counts.rows[0].followers, following: counts.rows[0].following, posts: counts.rows[0].posts },
      isFollowing: counts.rows[0].is_following,
      isContact: counts.rows[0].is_contact,
      isBlocked: counts.rows[0].is_blocked,
      isNotifying: counts.rows[0].is_notifying,
      isMe: t.id === req.user.id,
      posts: posts.rows.map(mapPost),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Follow / unfollow.
app.post('/api/social/follow/:id', auth.requireAuth, rateLimit(120, 60000, 'follow'), async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const t = await chatIdentity(target);
    if (!t || !t.username) return res.status(404).json({ error: 'User not found.' });
    const f = await db.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING following_id',
      [req.user.id, target]
    );
    if (f.rowCount) notify(target, req.user.id, 'follow', null);
    res.json({ ok: true, following: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/social/follow/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.user.id, target]);
    res.json({ ok: true, following: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// "Who to follow" — people you don't follow yet (most-followed first), for the
// empty feed / onboarding activation.
app.get('/api/social/suggestions', auth.requireAuth, async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar,
              (SELECT COUNT(*)::int FROM follows f WHERE f.following_id = u.id) AS followers
       FROM users u
       WHERE u.username IS NOT NULL AND u.id <> $1
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
       ORDER BY followers DESC, u.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ users: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, followers: u.followers })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load suggestions.' });
  }
});

// Block / unblock. Blocking also drops the follow relationship both ways and
// removes any post-notify subscriptions between the two.
app.post('/api/social/block/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot block yourself.' });
  try {
    await db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    await db.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [req.user.id, target]);
    await db.query('DELETE FROM post_notify WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)', [req.user.id, target]);
    res.json({ ok: true, blocked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/social/block/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, target]);
    res.json({ ok: true, blocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// List the accounts you've blocked (for Privacy settings).
app.get('/api/social/blocked', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar FROM blocks b
       JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY lower(u.name)`,
      [req.user.id]
    );
    res.json({ blocked: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load blocked accounts.' });
  }
});

// Report a user (stored for the admin dashboard).
app.post('/api/social/report/:id', auth.requireAuth, rateLimit(20, 60000, 'report'), async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot report yourself.' });
  const reason = (req.body.reason || '').trim().slice(0, 500) || null;
  try {
    await db.query('INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)', [req.user.id, target, reason]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Post-notification bell: subscribe / unsubscribe to a user's new posts.
app.post('/api/social/notify/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'Invalid.' });
  try {
    await db.query('INSERT INTO post_notify (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    res.json({ ok: true, notifying: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); }
});
app.delete('/api/social/notify/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM post_notify WHERE user_id = $1 AND target_id = $2', [req.user.id, target]);
    res.json({ ok: true, notifying: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); }
});

// Contact privacy: who can call / video / DM you.
app.get('/api/social/privacy', auth.requireAuth, async (req, res) => {
  try {
    const u = await db.query('SELECT pc_everyone, pc_following, pc_followers FROM users WHERE id = $1', [req.user.id]);
    const allow = await db.query(
      `SELECT a.allowed_id AS id, u.name, u.username, u.avatar
       FROM contact_allow a JOIN users u ON u.id = a.allowed_id
       WHERE a.owner_id = $1 ORDER BY lower(u.name)`, [req.user.id]
    );
    const p = u.rows[0] || {};
    res.json({ everyone: p.pc_everyone !== false, following: !!p.pc_following, followers: !!p.pc_followers, allow: allow.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load settings.' }); }
});
app.put('/api/social/privacy', auth.requireAuth, async (req, res) => {
  const everyone = !!req.body.everyone;
  const following = !!req.body.following;
  const followers = !!req.body.followers;
  const usernames = (Array.isArray(req.body.usernames) ? req.body.usernames : [])
    .map((s) => String(s || '').trim().replace(/^@/, '').toLowerCase()).filter(Boolean).slice(0, 300);
  try {
    await db.query('UPDATE users SET pc_everyone = $1, pc_following = $2, pc_followers = $3 WHERE id = $4',
      [everyone, following, followers, req.user.id]);
    let ids = [];
    if (usernames.length) {
      const r = await db.query('SELECT id FROM users WHERE lower(username) = ANY($1) AND id <> $2', [usernames, req.user.id]);
      ids = r.rows.map((x) => x.id);
    }
    await db.query('DELETE FROM contact_allow WHERE owner_id = $1', [req.user.id]);
    for (const id of ids) {
      await db.query('INSERT INTO contact_allow (owner_id, allowed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, id]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save settings.' }); }
});

// Home feed. scope=following → your posts + people you follow; scope=foryou → everyone (recent).
app.get('/api/social/feed', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const following = req.query.scope === 'following';
    const notBlocked = ` AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)`;
    const where = (following
      ? `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() AND (p.user_id = $1 OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1))`
      : `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now()`) + notBlocked;
    const { rows } = await db.query(
      POSTS_SELECT + where + ` ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id]
    );
    res.json({ posts: rows.map(mapPost) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read a single post with its replies (oldest first, X-style thread).
app.get('/api/social/posts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const post = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, id]);
    if (!post.rows[0]) return res.status(404).json({ error: 'Post not found.' });
    const replies = await db.query(
      POSTS_SELECT + 'WHERE p.parent_id = $2 ORDER BY p.created_at ASC LIMIT 200',
      [req.user.id, id]
    );
    res.json({ post: mapPost(post.rows[0]), replies: replies.rows.map(mapPost) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Create a post — or a reply when `parentId` is given.
app.post('/api/social/posts', auth.requireAuth, rateLimit(40, 60000, 'post'), async (req, res) => {
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That video could not be attached (unsupported type or too large — 16 MB max).' });
  if (media.data && media.kind !== 'video') return res.status(400).json({ error: 'Only photos and videos can be posted.' });
  // Poll options (2–4) — top-level posts only.
  const pollOpts = (Array.isArray(req.body.poll) ? req.body.poll : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
  const hasPoll = pollOpts.length >= 2 && (req.body.parentId == null || req.body.parentId === '');
  if (!body && !image && !media.data && !hasPoll) return res.status(400).json({ error: 'Your post is empty.' });
  if (body.length > 2000) return res.status(400).json({ error: 'Post is too long (2000 chars max).' });
  let parentId = null;
  if (req.body.parentId != null && req.body.parentId !== '') {
    parentId = parseInt(req.body.parentId, 10);
    if (!Number.isInteger(parentId)) return res.status(400).json({ error: 'Invalid post.' });
  }
  // Circle targeting (top-level posts only): which circles to share into, and
  // whether the post also appears in the main feed.
  const circleIds = [...new Set((Array.isArray(req.body.circleIds) ? req.body.circleIds : [])
    .map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  // Feed targeting (top-level posts only): a broadcast post into a single feed
  // the requester admins. Feed posts never hit the main feed.
  let feedId = null;
  if (req.body.feedId != null && req.body.feedId !== '') {
    feedId = parseInt(req.body.feedId, 10);
    if (!Number.isInteger(feedId)) return res.status(400).json({ error: 'Invalid feed.' });
  }
  // Default: a normal post goes to the main feed. A circle-only post sets toMain false.
  let toMain = req.body.toMain === undefined ? true : !!req.body.toMain;
  if (!circleIds.length) toMain = true; // a post with no circles must live somewhere
  if (feedId != null) toMain = false; // feed broadcasts stay inside the feed
  try {
    if (!(await requireHandle(req, res))) return;
    let parentOwner = null;
    if (parentId != null) {
      const parent = await db.query('SELECT user_id FROM posts WHERE id = $1', [parentId]);
      if (!parent.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
      parentOwner = parent.rows[0].user_id;
    }
    // Only allow sharing into circles the author actually belongs to.
    let validCircles = [];
    if (circleIds.length && parentId == null) {
      const cm = await db.query(
        'SELECT circle_id FROM circle_members WHERE user_id = $1 AND circle_id = ANY($2)',
        [req.user.id, circleIds]
      );
      validCircles = cm.rows.map((r) => r.circle_id);
      if (!validCircles.length && !toMain) toMain = true; // none valid → keep it in the feed
    }
    // Only the feed's admin may broadcast into it.
    if (feedId != null && parentId == null) {
      const fa = await db.query('SELECT created_by FROM feeds WHERE id = $1', [feedId]);
      if (!fa.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
      if (fa.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the feed admin can post here.' });
    } else {
      feedId = null;
    }
    const location = (req.body.location || '').trim().slice(0, 120) || null;
    // Scheduling (top-level posts only): created_at becomes the publish time.
    let scheduledAt = null;
    if (parentId == null && req.body.scheduledAt) {
      const d = new Date(req.body.scheduledAt);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 30000) scheduledAt = d.toISOString();
    }
    const ins = await db.query(
      `INSERT INTO posts (user_id, body, image, media, media_kind, parent_id, to_main, location, created_at, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()), $9) RETURNING id`,
      [req.user.id, body, image, media.data, media.kind, parentId, toMain, location, scheduledAt]
    );
    const postId = ins.rows[0].id;
    for (const cid of validCircles) {
      await db.query('INSERT INTO post_circles (post_id, circle_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, cid]);
    }
    if (feedId != null) {
      await db.query('INSERT INTO post_feeds (post_id, feed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, feedId]);
    }
    if (hasPoll) {
      for (let i = 0; i < pollOpts.length; i++) {
        await db.query('INSERT INTO post_poll_options (post_id, position, text) VALUES ($1, $2, $3)', [postId, i, pollOpts[i].slice(0, 80)]);
      }
    }
    if (parentId != null && parentOwner != null) notify(parentOwner, req.user.id, 'reply', parentId);
    // Bell subscribers: notify on a new top-level post that's live now.
    if (parentId == null && !scheduledAt) {
      try {
        const subs = await db.query('SELECT user_id FROM post_notify WHERE target_id = $1', [req.user.id]);
        for (const s of subs.rows) notify(s.user_id, req.user.id, 'post', postId);
      } catch (e) { /* best-effort */ }
      // Feed broadcast: notify every member (except the admin).
      if (feedId != null) {
        try {
          const mem = await db.query('SELECT user_id FROM feed_members WHERE feed_id = $1 AND user_id <> $2', [feedId, req.user.id]);
          for (const m of mem.rows) notify(m.user_id, req.user.id, 'post', postId);
        } catch (e) { /* best-effort */ }
      }
    }
    const { rows } = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, postId]);
    res.json({ post: mapPost(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete a post — by its author, or by an admin of a circle it's posted in.
app.delete('/api/social/posts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const r = await db.query('DELETE FROM posts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (r.rowCount) return res.json({ ok: true });
    // Not the author — allow if the requester admins a circle this post is in.
    const mod = await db.query(
      `SELECT 1 FROM post_circles pc JOIN circles c ON c.id = pc.circle_id
       WHERE pc.post_id = $1 AND c.created_by = $2
       UNION ALL
       SELECT 1 FROM post_feeds pf JOIN feeds f ON f.id = pf.feed_id
       WHERE pf.post_id = $1 AND f.created_by = $2 LIMIT 1`,
      [id, req.user.id]
    );
    if (mod.rows.length) {
      await db.query('DELETE FROM posts WHERE id = $1', [id]);
      return res.json({ ok: true });
    }
    res.json({ ok: true }); // nothing deleted (not owner / not admin) — idempotent
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Like / unlike a post.
app.post('/api/social/posts/:id/like', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const r = await db.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id', [id, req.user.id]);
    const c = await db.query('SELECT COUNT(*)::int AS likes FROM post_likes WHERE post_id = $1', [id]);
    if (r.rowCount) { // newly liked — notify the post's author
      const owner = await db.query('SELECT user_id FROM posts WHERE id = $1', [id]);
      if (owner.rows[0]) notify(owner.rows[0].user_id, req.user.id, 'like', id);
    }
    res.json({ ok: true, liked: true, likes: c.rows[0].likes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/social/posts/:id/like', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    const c = await db.query('SELECT COUNT(*)::int AS likes FROM post_likes WHERE post_id = $1', [id]);
    res.json({ ok: true, liked: false, likes: c.rows[0].likes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Vote on a poll (one vote per user, can't be changed).
app.post('/api/social/posts/:id/vote', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  const optionId = parseInt(req.body.optionId, 10);
  if (!Number.isInteger(id) || !Number.isInteger(optionId)) return res.status(400).json({ error: 'Invalid vote.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const o = await db.query('SELECT 1 FROM post_poll_options WHERE id = $1 AND post_id = $2', [optionId, id]);
    if (!o.rows[0]) return res.status(404).json({ error: 'That poll is no longer available.' });
    await db.query('INSERT INTO post_poll_votes (post_id, user_id, option_id) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO NOTHING', [id, req.user.id, optionId]);
    const { rows } = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, id]);
    res.json({ post: mapPost(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   CIRCLES  —  industry / community feeds (circle@username)
   Anyone can create or join; the creator is the admin.
═══════════════════════════════════════════════ */
const CIRCLE_USERNAME_RE = /^[a-zA-Z0-9._-]+$/;
function cleanCircleUsername(raw) {
  const username = (raw || '').trim().replace(/^@/, '');
  if (!username) return { error: 'Choose a username for the circle.' };
  if (username.length > 40) return { error: 'Circle username is too long.' };
  if (!CIRCLE_USERNAME_RE.test(username)) {
    return { error: 'Username can use letters, numbers, dots, dashes and underscores.' };
  }
  return { username };
}
async function isCircleMember(circleId, userId) {
  const { rows } = await db.query('SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, userId]);
  return rows.length > 0;
}

// Create a circle (creator becomes admin + first member).
app.post('/api/circles', auth.requireAuth, rateLimit(20, 60000, 'circle-create'), async (req, res) => {
  const u = cleanCircleUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Circle name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  try {
    if (!(await requireHandle(req, res))) return;
    let c;
    try {
      c = await db.query(
        'INSERT INTO circles (username, name, bio, avatar, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [u.username, name, bio || null, avatar, req.user.id]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That circle username is already taken.' });
      throw e;
    }
    const cid = c.rows[0].id;
    await db.query('INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cid, req.user.id]);
    res.json({ circle: { id: cid, username: u.username, name, bio: bio || null, avatar: avatar || null, members: 1, isMember: true, isAdmin: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Directory: circles I'm in first, then others to discover.
app.get('/api/circles', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      `SELECT c.id, c.username, c.name, c.bio, c.avatar, c.created_by,
              (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
              EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = $1) AS is_member
       FROM circles c
       ORDER BY is_member DESC, members DESC, c.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({
      circles: rows.map((c) => ({
        id: c.id, username: c.username, name: c.name, bio: c.bio || null, avatar: c.avatar || null,
        members: c.members, isMember: c.is_member, isAdmin: c.created_by === req.user.id,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// The circles I belong to (for the post-composer checklist).
app.get('/api/circles/mine', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.username, c.name, c.avatar FROM circle_members m
       JOIN circles c ON c.id = m.circle_id WHERE m.user_id = $1 ORDER BY c.name`,
      [req.user.id]
    );
    res.json({ circles: rows.map((c) => ({ id: c.id, username: c.username, name: c.name, avatar: c.avatar || null })) });
  } catch (err) {
    console.error(err);
    res.json({ circles: [] });
  }
});

// A circle's profile + its feed.
app.get('/api/circles/:id', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const c = await db.query(
      `SELECT c.id, c.username, c.name, c.bio, c.avatar, c.created_by,
              (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
              EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = $1) AS is_member
       FROM circles c WHERE c.id = $2`,
      [req.user.id, cid]
    );
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    const posts = await db.query(
      POSTS_SELECT + `JOIN post_circles pc ON pc.post_id = p.id
       WHERE pc.circle_id = $2 AND p.parent_id IS NULL AND p.created_at <= now() ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, cid]
    );
    const t = c.rows[0];
    res.json({
      circle: {
        id: t.id, username: t.username, name: t.name, bio: t.bio || null, avatar: t.avatar || null,
        members: t.members, isMember: t.is_member, isAdmin: t.created_by === req.user.id,
      },
      posts: posts.rows.map(mapPost),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Join / leave a circle.
app.post('/api/circles/:id/join', auth.requireAuth, rateLimit(60, 60000, 'circle-join'), async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const c = await db.query('SELECT id FROM circles WHERE id = $1', [cid]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    await db.query('INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cid, req.user.id]);
    res.json({ ok: true, isMember: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/circles/:id/join', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  try {
    await db.query('DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2', [cid, req.user.id]);
    res.json({ ok: true, isMember: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a circle (admin only): name, @username, bio, avatar.
app.patch('/api/circles/:id', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  const u = cleanCircleUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Circle name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  try {
    const c = await db.query('SELECT created_by FROM circles WHERE id = $1', [cid]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    if (c.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the circle admin can edit this circle.' });
    const fields = ['name = $1', 'username = $2', 'bio = $3'];
    const vals = [name, u.username, bio || null];
    if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
    vals.push(cid);
    let upd;
    try {
      upd = await db.query(`UPDATE circles SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING id, username, name, bio, avatar, created_by`, vals);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That circle username is already taken.' });
      throw e;
    }
    const r = upd.rows[0];
    res.json({ circle: { id: r.id, username: r.username, name: r.name, bio: r.bio || null, avatar: r.avatar || null, isAdmin: true, isMember: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   FEEDS  —  broadcast channels (feeds@username)
   Only the creator/admin posts; everyone else follows to watch.
   `open` feeds let anyone join instantly; otherwise joins need approval.
═══════════════════════════════════════════════ */
function cleanFeedUsername(raw) {
  const username = (raw || '').trim().replace(/^@/, '');
  if (!username) return { error: 'Choose a username for the feed.' };
  if (username.length > 40) return { error: 'Feed username is too long.' };
  if (!CIRCLE_USERNAME_RE.test(username)) {
    return { error: 'Username can use letters, numbers, dots, dashes and underscores.' };
  }
  return { username };
}

// Create a feed (creator becomes admin + first member).
app.post('/api/feeds', auth.requireAuth, rateLimit(20, 60000, 'feed-create'), async (req, res) => {
  const u = cleanFeedUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Feed name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  const open = req.body.open === undefined ? true : !!req.body.open;
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  try {
    if (!(await requireHandle(req, res))) return;
    let f;
    try {
      f = await db.query(
        'INSERT INTO feeds (username, name, bio, avatar, open, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [u.username, name, bio || null, avatar, open, req.user.id]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That feed username is already taken.' });
      throw e;
    }
    const fid = f.rows[0].id;
    await db.query('INSERT INTO feed_members (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, req.user.id]);
    res.json({ feed: { id: fid, username: u.username, name, bio: bio || null, avatar: avatar || null, open, members: 1, isMember: true, isAdmin: true, requested: false } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Directory: feeds I'm in first, then others to discover.
app.get('/api/feeds', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      `SELECT f.id, f.username, f.name, f.bio, f.avatar, f.open, f.created_by,
              (SELECT COUNT(*)::int FROM feed_members m WHERE m.feed_id = f.id) AS members,
              EXISTS(SELECT 1 FROM feed_members m WHERE m.feed_id = f.id AND m.user_id = $1) AS is_member,
              EXISTS(SELECT 1 FROM feed_requests r WHERE r.feed_id = f.id AND r.user_id = $1) AS requested
       FROM feeds f
       ORDER BY is_member DESC, members DESC, f.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({
      feeds: rows.map((f) => ({
        id: f.id, username: f.username, name: f.name, bio: f.bio || null, avatar: f.avatar || null, open: f.open,
        members: f.members, isMember: f.is_member, isAdmin: f.created_by === req.user.id, requested: f.requested,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// A feed's profile + its broadcast posts (+ pending requests if you're the admin).
app.get('/api/feeds/:id', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const f = await db.query(
      `SELECT f.id, f.username, f.name, f.bio, f.avatar, f.open, f.created_by,
              (SELECT COUNT(*)::int FROM feed_members m WHERE m.feed_id = f.id) AS members,
              EXISTS(SELECT 1 FROM feed_members m WHERE m.feed_id = f.id AND m.user_id = $1) AS is_member,
              EXISTS(SELECT 1 FROM feed_requests r WHERE r.feed_id = f.id AND r.user_id = $1) AS requested
       FROM feeds f WHERE f.id = $2`,
      [req.user.id, fid]
    );
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    const t = f.rows[0];
    const isAdmin = t.created_by === req.user.id;
    const posts = await db.query(
      POSTS_SELECT + `JOIN post_feeds pf ON pf.post_id = p.id
       WHERE pf.feed_id = $2 AND p.parent_id IS NULL AND p.created_at <= now() ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, fid]
    );
    let requests = [];
    if (isAdmin) {
      const rq = await db.query(
        `SELECT u.id, u.name, u.username, u.avatar FROM feed_requests r
         JOIN users u ON u.id = r.user_id WHERE r.feed_id = $1 ORDER BY r.requested_at ASC LIMIT 100`,
        [fid]
      );
      requests = rq.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null }));
    }
    res.json({
      feed: {
        id: t.id, username: t.username, name: t.name, bio: t.bio || null, avatar: t.avatar || null, open: t.open,
        members: t.members, isMember: t.is_member, isAdmin, requested: t.requested,
      },
      posts: posts.rows.map(mapPost),
      requests,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Join (open → instant; otherwise request approval) / leave / cancel request.
app.post('/api/feeds/:id/join', auth.requireAuth, rateLimit(60, 60000, 'feed-join'), async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const f = await db.query('SELECT id, open, created_by FROM feeds WHERE id = $1', [fid]);
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    if (f.rows[0].open || f.rows[0].created_by === req.user.id) {
      await db.query('INSERT INTO feed_members (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, req.user.id]);
      await db.query('DELETE FROM feed_requests WHERE feed_id = $1 AND user_id = $2', [fid, req.user.id]);
      return res.json({ ok: true, isMember: true, requested: false });
    }
    // Request-to-join: record a pending request and ping the admin.
    await db.query('INSERT INTO feed_requests (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, req.user.id]);
    notify(f.rows[0].created_by, req.user.id, 'feed_request', null, fid);
    res.json({ ok: true, isMember: false, requested: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/feeds/:id/join', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  try {
    await db.query('DELETE FROM feed_members WHERE feed_id = $1 AND user_id = $2', [fid, req.user.id]);
    await db.query('DELETE FROM feed_requests WHERE feed_id = $1 AND user_id = $2', [fid, req.user.id]);
    res.json({ ok: true, isMember: false, requested: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Admin: approve / decline a pending join request.
app.post('/api/feeds/:id/requests/:uid', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id), uid = routeId(req.params.uid);
  if (!Number.isInteger(fid) || !Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    const f = await db.query('SELECT created_by FROM feeds WHERE id = $1', [fid]);
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    if (f.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the feed admin can do that.' });
    const approve = req.body.approve !== false;
    const had = await db.query('DELETE FROM feed_requests WHERE feed_id = $1 AND user_id = $2 RETURNING user_id', [fid, uid]);
    if (approve && had.rows.length) {
      await db.query('INSERT INTO feed_members (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, uid]);
      notify(uid, req.user.id, 'feed_approved', null, fid);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a feed (admin only): name, @username, bio, avatar, join mode (open).
app.patch('/api/feeds/:id', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  const u = cleanFeedUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Feed name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  try {
    const f = await db.query('SELECT created_by FROM feeds WHERE id = $1', [fid]);
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    if (f.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the feed admin can edit this feed.' });
    const fields = ['name = $1', 'username = $2', 'bio = $3'];
    const vals = [name, u.username, bio || null];
    if ('open' in req.body) { vals.push(!!req.body.open); fields.push(`open = $${vals.length}`); }
    if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
    vals.push(fid);
    let upd;
    try {
      upd = await db.query(`UPDATE feeds SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING id, username, name, bio, avatar, open, created_by`, vals);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That feed username is already taken.' });
      throw e;
    }
    // Switching to open auto-clears the pending request queue.
    if ('open' in req.body && !!req.body.open) {
      await db.query('INSERT INTO feed_members (feed_id, user_id) SELECT feed_id, user_id FROM feed_requests WHERE feed_id = $1 ON CONFLICT DO NOTHING', [fid]);
      await db.query('DELETE FROM feed_requests WHERE feed_id = $1', [fid]);
    }
    const r = upd.rows[0];
    res.json({ feed: { id: r.id, username: r.username, name: r.name, bio: r.bio || null, avatar: r.avatar || null, open: r.open, isAdmin: true, isMember: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   CONTACTS  —  a personal saved list of people
═══════════════════════════════════════════════ */
app.get('/api/contacts', auth.requireAuth, async (req, res) => {
  try {
    const [list, counts] = await Promise.all([
      db.query(
        `SELECT u.id, u.name, u.username, u.avatar,
                c.email, c.phone, c.socials, c.website, c.address, c.about, c.notes
         FROM contacts c JOIN users u ON u.id = c.contact_id
         WHERE c.owner_id = $1 AND u.username IS NOT NULL
         ORDER BY lower(u.name)`,
        [req.user.id]
      ),
      db.query(
        `SELECT (SELECT COUNT(*)::int FROM contacts WHERE owner_id = $1) AS count,
                (SELECT COUNT(*)::int FROM contacts WHERE contact_id = $1) AS reverse_count`,
        [req.user.id]
      ),
    ]);
    res.json({
      count: counts.rows[0].count,
      reverseCount: counts.rows[0].reverse_count,
      contacts: list.rows.map((u) => ({
        id: u.id, name: u.name, username: u.username, avatar: u.avatar || null,
        email: u.email || '', phone: u.phone || '', socials: u.socials || '',
        website: u.website || '', address: u.address || '', about: u.about || '', notes: u.notes || '',
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// Update a contact's owner-private details (not their profile).
app.patch('/api/contacts/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  const fields = ['email', 'phone', 'socials', 'website', 'address', 'about', 'notes'];
  const vals = [], sets = [];
  fields.forEach((f) => {
    if (f in req.body) { vals.push(String(req.body[f] || '').slice(0, 2000)); sets.push(`${f} = $${vals.length}`); }
  });
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.user.id, target);
  try {
    const r = await db.query(
      `UPDATE contacts SET ${sets.join(', ')} WHERE owner_id = $${vals.length - 1} AND contact_id = $${vals.length}`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// Bulk-delete contacts (select / select-all on the contacts page).
// Declared before /:id so "delete" isn't captured as an :id.
app.post('/api/contacts/delete', auth.requireAuth, async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  try {
    if (req.body.all) await db.query('DELETE FROM contacts WHERE owner_id = $1', [req.user.id]);
    else if (ids.length) await db.query('DELETE FROM contacts WHERE owner_id = $1 AND contact_id = ANY($2)', [req.user.id, ids]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.post('/api/contacts/:id', auth.requireAuth, rateLimit(120, 60000, 'contact'), async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot add yourself.' });
  try {
    const t = await chatIdentity(target);
    if (!t || !t.username) return res.status(404).json({ error: 'User not found.' });
    await db.query('INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    notify(target, req.user.id, 'contact', null);
    res.json({ ok: true, isContact: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/contacts/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2', [req.user.id, target]);
    res.json({ ok: true, isContact: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   NOTIFICATIONS  —  likes / replies / follows / contacts
═══════════════════════════════════════════════ */
app.get('/api/notifications', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT n.id, n.type, n.post_id, n.feed_id, n.read, n.created_at,
              u.id AS actor_id, u.name AS actor_name, u.username AS actor_username, u.avatar AS actor_avatar,
              p.body AS post_body
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       LEFT JOIN posts p ON p.id = n.post_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC LIMIT 60`,
      [req.user.id]
    );
    const unread = rows.filter((r) => !r.read).length;
    res.json({
      unread,
      notifications: rows.map((r) => ({
        id: r.id, type: r.type, postId: r.post_id || null, feedId: r.feed_id || null, read: r.read, created_at: r.created_at,
        postBody: r.post_body || null,
        actor: { id: r.actor_id, name: r.actor_name, username: r.actor_username, avatar: r.actor_avatar || null },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.get('/api/notifications/count', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read = false', [req.user.id]);
    res.json({ unread: rows[0].unread });
  } catch (err) { res.json({ unread: 0 }); }
});
app.post('/api/notifications/read', auth.requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET read = true WHERE user_id = $1 AND read = false', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});

/* ═══════════════════════════════════════════════
   SEARCH  —  people + posts
═══════════════════════════════════════════════ */
app.get('/api/search', auth.requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim().replace(/^@/, '');
  const scope = req.query.scope || '';
  if (!q) return res.json({});
  const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
  const me = req.user.id;
  try {
    if (!(await requireHandle(req, res))) return;
    if (scope === 'posts') {
      const r = await db.query(
        POSTS_SELECT + `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() AND p.body ILIKE $2 ORDER BY p.created_at DESC LIMIT 30`,
        [me, like]
      );
      return res.json({ posts: r.rows.map(mapPost) });
    }
    if (scope === 'circles') {
      const r = await db.query(
        `SELECT c.id, c.username, c.name, c.bio, c.avatar, c.created_by,
                (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
                EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = $1) AS is_member
         FROM circles c WHERE c.name ILIKE $2 OR c.username ILIKE $2 ORDER BY members DESC, c.name LIMIT 30`,
        [me, like]
      );
      return res.json({ circles: r.rows.map((c) => ({ id: c.id, username: c.username, name: c.name, bio: c.bio || null, avatar: c.avatar || null, members: c.members, isMember: c.is_member, isAdmin: c.created_by === me })) });
    }
    if (scope === 'feeds') {
      const r = await db.query(
        `SELECT f.id, f.username, f.name, f.bio, f.avatar, f.open, f.created_by,
                (SELECT COUNT(*)::int FROM feed_members m WHERE m.feed_id = f.id) AS members,
                EXISTS(SELECT 1 FROM feed_members m WHERE m.feed_id = f.id AND m.user_id = $1) AS is_member,
                EXISTS(SELECT 1 FROM feed_requests rq WHERE rq.feed_id = f.id AND rq.user_id = $1) AS requested
         FROM feeds f WHERE f.name ILIKE $2 OR f.username ILIKE $2 ORDER BY members DESC, f.name LIMIT 30`,
        [me, like]
      );
      return res.json({ feeds: r.rows.map((f) => ({ id: f.id, username: f.username, name: f.name, bio: f.bio || null, avatar: f.avatar || null, open: f.open, members: f.members, isMember: f.is_member, isAdmin: f.created_by === me, requested: f.requested })) });
    }
    if (scope === 'chats') {
      const r = await db.query(
        `SELECT m.id, m.body, m.created_at,
                (CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END) AS peer_id,
                u.name AS peer_name, u.username AS peer_username, u.avatar AS peer_avatar
         FROM at_messages m
         JOIN users u ON u.id = (CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END)
         WHERE (m.sender_id = $1 OR m.recipient_id = $1) AND m.body ILIKE $2
         ORDER BY m.created_at DESC LIMIT 30`,
        [me, like]
      );
      return res.json({ messages: r.rows.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, peer: { id: m.peer_id, name: m.peer_name, username: m.peer_username, avatar: m.peer_avatar || null } })) });
    }
    if (scope === 'groups') {
      const r = await db.query(
        `SELECT g.id, g.name, g.username, g.avatar,
                (SELECT COUNT(*)::int FROM at_group_members m WHERE m.group_id = g.id) AS members
         FROM at_groups g JOIN at_group_members me2 ON me2.group_id = g.id AND me2.user_id = $1
         WHERE g.name ILIKE $2 OR g.username ILIKE $2 ORDER BY g.name LIMIT 30`,
        [me, like]
      );
      return res.json({ groups: r.rows.map((g) => ({ id: g.id, name: g.name, username: g.username || null, avatar: g.avatar || null, members: g.members })) });
    }
    // Default: people + posts.
    const [users, posts] = await Promise.all([
      db.query(
        `SELECT id, name, username, avatar FROM users
         WHERE username IS NOT NULL AND (username ILIKE $1 OR name ILIKE $1)
         ORDER BY (lower(username) = lower($2)) DESC, (username ILIKE $1) DESC, lower(username) LIMIT 20`,
        [like, q]
      ),
      db.query(
        POSTS_SELECT + `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() AND p.body ILIKE $2 ORDER BY p.created_at DESC LIMIT 20`,
        [me, like]
      ),
    ]);
    res.json({
      users: users.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null })),
      posts: posts.rows.map(mapPost),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   PLAN  —  authoritative, server-side
═══════════════════════════════════════════════ */
app.put('/api/plan', auth.requireAuth, async (req, res) => {
  const plan = req.body.plan === 'pro' ? 'pro' : 'free';
  try {
    // Atomic transition: a row is returned only when the plan actually changes,
    // so concurrent upgrades (e.g. webhook + this call) can't double-send the email.
    const { rows } = await db.query(
      'UPDATE users SET plan = $1 WHERE id = $2 AND plan IS DISTINCT FROM $1 RETURNING name, email',
      [plan, req.user.id]
    );
    res.json({ plan });

    // Newly upgraded to Pro → confirm by email (best-effort, only on transition).
    if (plan === 'pro' && rows[0]) {
      try {
        await sendProWelcomeEmail(rows[0]);
      } catch (e) {
        console.error('Pro welcome email failed:', e.message);
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   BILLING  —  Stripe Checkout (webhook is mounted near the top)
═══════════════════════════════════════════════ */
app.post('/api/billing/checkout', auth.requireAuth, async (req, res) => {
  if (!billing.isConfigured()) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, email, stripe_customer_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await billing.createCheckoutSession(user, {
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ADMIN  —  /api/admin/* (requires is_admin)
═══════════════════════════════════════════════ */
app.get('/api/admin/users', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.plan, u.is_admin, u.email_verified,
             u.username, u.avatar, u.created_at, u.last_login_at,
             COUNT(c.id)::int AS chat_count,
             MAX(c.updated_at) AS last_chat_at,
             (SELECT COUNT(*)::int FROM admin_messages am
                WHERE am.user_id = u.id AND am.sender = 'user' AND am.read_by_admin = false) AS unread_msgs
      FROM users u
      LEFT JOIN chats c ON c.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read one user's chats (full conversations) for the admin dashboard.
app.get('/api/admin/users/:id/chats', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const u = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `SELECT id, title, messages, created_at, updated_at
       FROM chats WHERE user_id = $1 ORDER BY updated_at DESC`,
      [id]
    );
    res.json({ user: u.rows[0], chats: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// AtChat ACTIVITY for one user — counts + their PUBLIC posts only.
// Deliberately never exposes private DM or group message contents.
app.get('/api/admin/users/:id/atchat', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const u = await db.query('SELECT id, name, username, avatar FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const s = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS followers,
        (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following,
        (SELECT COUNT(*)::int FROM posts   WHERE user_id      = $1) AS posts,
        (SELECT COUNT(DISTINCT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)::int
           FROM at_messages WHERE sender_id = $1 OR recipient_id = $1) AS dm_people,
        (SELECT COUNT(*)::int FROM at_messages WHERE sender_id = $1) AS dm_sent,
        (SELECT COUNT(*)::int FROM at_group_members WHERE user_id = $1) AS groups,
        (SELECT COUNT(*)::int FROM at_group_messages WHERE sender_id = $1) AS group_sent`,
      [id]
    );
    const posts = await db.query(
      `SELECT p.id, p.body, p.image, p.created_at,
              (SELECT COUNT(*)::int FROM post_likes pl WHERE pl.post_id = p.id) AS likes
       FROM posts p WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 30`,
      [id]
    );
    res.json({
      user: { id: u.rows[0].id, name: u.rows[0].name, username: u.rows[0].username, avatar: u.rows[0].avatar || null },
      stats: s.rows[0],
      posts: posts.rows.map((p) => ({ id: p.id, body: p.body, image: p.image || null, created_at: p.created_at, likes: p.likes })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read the admin ↔ user message thread (viewing clears the unread badge).
app.get('/api/admin/users/:id/messages', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const u = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `SELECT id, sender, body, image, created_at FROM admin_messages
       WHERE user_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    // The admin is actively viewing, so mark the user's replies as read.
    db.query(
      `UPDATE admin_messages SET read_by_admin = true
       WHERE user_id = $1 AND sender = 'user' AND read_by_admin = false`,
      [id]
    ).catch(() => {});
    res.json({ user: u.rows[0], messages: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Admin sends a message to a user; also emails them a notification (best-effort).
app.post('/api/admin/users/:id/messages', auth.requireAdmin, rateLimit(60, 60000, 'admin-msg'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  if (!body && !image) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const u = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `INSERT INTO admin_messages (user_id, sender, body, image, read_by_user, read_by_admin)
       VALUES ($1, 'admin', $2, $3, false, true)
       RETURNING id, sender, body, image, created_at`,
      [id, body, image]
    );
    try {
      await sendAdminMessageEmail(u.rows[0], body || '📷 Photo');
    } catch (e) {
      console.error('Admin message email failed:', e.message);
    }
    res.json({ message: { ...rows[0], image: rows[0].image || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.patch('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const fields = [];
  const values = [];
  if (req.body.plan === 'pro' || req.body.plan === 'free') {
    values.push(req.body.plan);
    fields.push(`plan = $${values.length}`);
  }
  if (typeof req.body.is_admin === 'boolean') {
    // Guard: an admin can't strip their own admin rights (avoid lockout).
    if (req.user.id === id && req.body.is_admin === false) {
      return res.status(400).json({ error: 'You cannot remove your own admin access.' });
    }
    values.push(req.body.is_admin);
    fields.push(`is_admin = $${values.length}`);
  }
  if (typeof req.body.email_verified === 'boolean') {
    values.push(req.body.email_verified);
    fields.push(`email_verified = $${values.length}`);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, email, plan, is_admin, email_verified, username`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    // Return only the changed columns (no avatar/banner keys) so the client
    // merge can't blank out fields it didn't touch.
    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  if (req.user.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account here.' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ─── Admin: platform overview metrics ─── */
app.get('/api/admin/stats', auth.requireAdmin, async (_req, res) => {
  const c = (sql) => db.query(sql).then(r => parseInt(r.rows[0].c, 10) || 0).catch(() => 0);
  try {
    const [users, pro, admins, verified, withUsername, newToday, new7d,
           posts, replies, circles, groups, dms, calls, locks] = await Promise.all([
      c(`SELECT COUNT(*) c FROM users`),
      c(`SELECT COUNT(*) c FROM users WHERE plan = 'pro'`),
      c(`SELECT COUNT(*) c FROM users WHERE is_admin`),
      c(`SELECT COUNT(*) c FROM users WHERE email_verified`),
      c(`SELECT COUNT(*) c FROM users WHERE username IS NOT NULL`),
      c(`SELECT COUNT(*) c FROM users WHERE created_at > now() - interval '1 day'`),
      c(`SELECT COUNT(*) c FROM users WHERE created_at > now() - interval '7 days'`),
      c(`SELECT COUNT(*) c FROM posts WHERE parent_id IS NULL`),
      c(`SELECT COUNT(*) c FROM posts WHERE parent_id IS NOT NULL`),
      c(`SELECT COUNT(*) c FROM circles`),
      c(`SELECT COUNT(*) c FROM at_groups`),
      c(`SELECT COUNT(*) c FROM at_messages`),
      c(`SELECT COUNT(*) c FROM calls`),
      c(`SELECT COUNT(*) c FROM reserved_usernames`),
    ]);
    res.json({ stats: { users, pro, free: users - pro, admins, verified, withUsername,
      newToday, new7d, posts, replies, circles, groups, dms, calls, locks } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// Admin diagnostic: which TURN provider is live for calls, and (for Cloudflare)
// whether credentials actually mint successfully right now.
app.get('/api/admin/turn', auth.requireAdmin, async (_req, res) => {
  if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) {
    try {
      const s = await cloudflareTurnServer();
      return res.json({ provider: 'cloudflare', ok: !!(s && s.urls), urls: s ? s.urls : null });
    } catch (e) {
      return res.json({ provider: 'cloudflare', ok: false, error: e.message });
    }
  }
  if (process.env.TURN_URL) {
    return res.json({ provider: 'static', ok: true, urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean) });
  }
  res.json({ provider: 'fallback', ok: true, urls: ['turn:openrelay.metered.ca:443'] });
});

/* ─── Admin: username locks (reserved usernames) ─── */
app.get('/api/admin/username-locks', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.username, r.note, r.created_at,
              EXISTS(SELECT 1 FROM users u WHERE lower(u.username) = r.username) AS taken
       FROM reserved_usernames r ORDER BY r.created_at DESC`
    );
    res.json({ locks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load username locks.' });
  }
});
app.post('/api/admin/username-locks', auth.requireAdmin, async (req, res) => {
  const username = (req.body.username || '').trim().replace(/^@/, '').toLowerCase();
  const note = ((req.body.note || '').trim().slice(0, 200)) || null;
  if (!username) return res.status(400).json({ error: 'Enter a username to lock.' });
  if (username.length > 40) return res.status(400).json({ error: 'Username is too long.' });
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
  }
  try {
    await db.query(
      `INSERT INTO reserved_usernames (username, note, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET note = EXCLUDED.note`,
      [username, note, req.user.id]
    );
    const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = $1', [username]);
    res.json({ ok: true, lock: { username, note, created_at: new Date().toISOString(), taken: taken.rowCount > 0 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not lock that username.' });
  }
});
app.delete('/api/admin/username-locks/:username', auth.requireAdmin, async (req, res) => {
  const username = (req.params.username || '').trim().replace(/^@/, '').toLowerCase();
  try {
    await db.query('DELETE FROM reserved_usernames WHERE username = $1', [username]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not unlock that username.' });
  }
});

/* ─── Admin: user reports ─── */
app.get('/api/admin/reports', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.reason, r.created_at,
              rep.name AS reporter_name, rep.username AS reporter_username,
              tgt.id AS reported_id, tgt.name AS reported_name, tgt.username AS reported_username
       FROM reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       JOIN users tgt ON tgt.id = r.reported_id
       ORDER BY r.created_at DESC LIMIT 200`
    );
    res.json({ reports: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load reports.' }); }
});
app.delete('/api/admin/reports/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM reports WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not dismiss.' }); }
});

/* ─── Admin: content moderation (recent posts) ─── */
app.get('/api/admin/posts', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.body, p.image, p.created_at, p.parent_id,
              u.name AS author_name, u.username AS author_username,
              (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)::int AS likes
       FROM posts p JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 60`
    );
    res.json({ posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load posts.' });
  }
});
app.delete('/api/admin/posts/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete that post.' });
  }
});

/* ─── Admin: support requests inbox ─── */
app.get('/api/admin/support', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.email, s.message, s.created_at, s.user_id, u.name AS user_name, u.username AS user_username
       FROM support_requests s LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC LIMIT 200`
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load support requests.' });
  }
});
app.delete('/api/admin/support/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM support_requests WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not dismiss that request.' });
  }
});

/* ─── Admin: broadcast an announcement to every user (lands in their inbox) ─── */
app.post('/api/admin/broadcast', auth.requireAdmin, rateLimit(10, 60000, 'admin-broadcast'), async (req, res) => {
  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write a message to broadcast.' });
  if (body.length > 4000) return res.status(400).json({ error: 'That message is too long.' });
  try {
    const { rowCount } = await db.query(
      `INSERT INTO admin_messages (user_id, sender, body, read_by_user, read_by_admin)
       SELECT id, 'admin', $1, false, true FROM users`,
      [body]
    );
    res.json({ ok: true, sent: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send the broadcast.' });
  }
});

/* ═══════════════════════════════════════════════
   CHAT  —  the actual Claude call
   Plan is taken from the authenticated user (authoritative);
   guests (no token) fall back to the client-sent plan, local-only.
═══════════════════════════════════════════════ */
app.post('/api/chat', auth.optionalAuth, async (req, res) => {
  const { messages, plan: clientPlan } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }
  const validShape = messages.every(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && m.content != null
  );
  if (!validShape) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  let plan = clientPlan;
  if (req.user) {
    try {
      const { rows } = await db.query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
      plan = rows[0]?.plan || 'free';
    } catch {
      /* fall back to client plan if the lookup fails */
    }
  }

  try {
    const maxTokens = plan === 'pro' ? 4096 : 1500;
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:
        'You are Atwe AI, an intelligent assistant for modern businesses. Give clear, accurate, well-structured answers. Be professional, concise, and genuinely helpful — thorough when it matters, brief when it does not. Use markdown (bold, lists, headings, code) only when it improves clarity. Keep a clean, classy, understated tone; do not use emojis unless the user uses them first.',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
    res.json({ content: text, usage: msg.usage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ATWE AI — in-app support assistant + "explain this" helper
═══════════════════════════════════════════════ */
const SUPPORT_SYSTEM =
  `You are Atwe AI Support, the in-app help assistant for Atwe — an AI assistant app for business that also includes AtChat, a social space. ` +
  `Help users ONLY with questions about the app: how features work, accounts/profiles, plans, and troubleshooting. ` +
  `Be warm, concise and clear; prefer short paragraphs or numbered steps.\n\n` +
  `What Atwe offers:\n` +
  `- Atwe AI: chat with an intelligent assistant; supports text, voice (mic), images, and PDFs. Group chats into Projects. History is saved when signed in.\n` +
  `- Plans: Free (Atwe Standard) and Pro ($9.99/month — longer, more in-depth answers, PDF understanding, priority speed). Manage your plan from the profile menu (bottom-left).\n` +
  `- Account: sign up with email; set a display name, @username and profile photo in Edit profile; toggle dark/light mode in Settings.\n` +
  `- AtChat (social): a Home feed (For you / Following), direct Messages, Groups, and your Profile. You can post (text/photo), like, follow/unfollow, DM people, and create group chats. A @username is required to use AtChat.\n\n` +
  `If you cannot fully resolve the issue, reassure the user and tell them to tap "Message the team" to leave their email and details so the Atwe team can follow up. ` +
  `Do not invent features that don't exist. If asked something unrelated to the app, gently steer back to app support. ` +
  `You are Atwe AI — never mention "Claude" or "Anthropic".`;

app.post('/api/support/ask', auth.optionalAuth, rateLimit(20, 60000), async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Invalid messages' });
  const ok = messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (!ok) return res.status(400).json({ error: 'Invalid messages' });
  const convo = messages.slice(-20).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: SUPPORT_SYSTEM,
      messages: convo,
    });
    res.json({ content: msg.content.find((b) => b.type === 'text')?.text ?? '' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "Atwe AI is unavailable right now. Please try again, or tap “Message the team”." });
  }
});

// Explain / clarify an AtChat post or message.
app.post('/api/explain', auth.requireAuth, rateLimit(40, 60000, 'explain'), async (req, res) => {
  const text = (req.body.text || '').toString().trim().slice(0, 4000);
  const kind = req.body.kind === 'post' ? 'post' : 'message';
  if (!text) return res.status(400).json({ error: 'Nothing to explain.' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 320,
      system:
        `You are Atwe AI. In 1–3 short, friendly sentences, explain or clarify the meaning, tone and intent of the following AtChat ${kind}. ` +
        `If it asks a question or makes a request, say what's being asked. Be concise and genuinely helpful. ` +
        `You are Atwe AI — never mention "Claude" or "Anthropic".`,
      messages: [{ role: 'user', content: text }],
    });
    res.json({ content: msg.content.find((b) => b.type === 'text')?.text ?? '' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: 'Atwe AI is unavailable right now. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ERROR HANDLER  —  consistent JSON for body-parser & unexpected errors
═══════════════════════════════════════════════ */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

/* ═══════════════════════════════════════════════
   BOOT  —  init DB then listen
═══════════════════════════════════════════════ */
db.init()
  .catch((err) => console.error('Database init failed:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀  Atwe server → http://localhost:${PORT}\n`);
    });
  });
