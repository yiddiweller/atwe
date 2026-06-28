// stt.js — optional speech-to-text for voice-note transcription.
//
// Graceful-degradation pattern (like mailer/billing/push/shiptax): with no
// configuration, isConfigured() is false and the transcribe route returns a clear
// 503 — voice notes still send/play, just without a transcript. Provider-agnostic:
// posts the audio as multipart/form-data to an OpenAI-Whisper-compatible endpoint
// (file + model) and reads { text } (also tolerates a { results:[{text}] } shape).
// Set STT_API_URL + STT_API_KEY (+ optional STT_MODEL / STT_LANGUAGE) to enable.
// The Anthropic text API can't transcribe audio, so this is a separate provider.

const STT_TIMEOUT_MS = 30000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // typical provider cap

function isConfigured() { return !!(process.env.STT_API_URL && process.env.STT_API_KEY); }

// Transcribe an audio data URL → { text }. Throws on misconfig / bad input / failure.
async function transcribe(dataUrl) {
  if (!isConfigured()) { const e = new Error('Transcription is not set up.'); e.code = 'STT_OFF'; throw e; }
  const marker = ';base64,';
  const idx = (dataUrl || '').indexOf(marker);
  if (!dataUrl || !dataUrl.startsWith('data:') || idx === -1) throw new Error('No audio to transcribe.');
  const mime = dataUrl.slice(5, idx).split(';')[0].trim().toLowerCase();
  const buf = Buffer.from(dataUrl.slice(idx + marker.length), 'base64');
  if (!buf.length) throw new Error('Empty audio.');
  if (buf.length > MAX_AUDIO_BYTES) throw new Error('Audio is too long to transcribe.');
  const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a'
    : (mime.includes('mpeg') || mime.includes('mp3')) ? 'mp3'
    : mime.includes('wav') ? 'wav'
    : mime.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData(); // Node 18+ globals: FormData/Blob/fetch
  fd.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'audio.' + ext);
  fd.append('model', process.env.STT_MODEL || 'whisper-1');
  if (process.env.STT_LANGUAGE) fd.append('language', process.env.STT_LANGUAGE);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(process.env.STT_API_URL, { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + process.env.STT_API_KEY }, body: fd });
  } finally { clearTimeout(to); }
  if (!r.ok) throw new Error('Transcription failed (' + r.status + ').');
  const j = await r.json().catch(() => null);
  const text = j && (j.text != null ? j.text : (j.results && j.results[0] && j.results[0].text));
  if (text == null) throw new Error('Transcription returned no text.');
  return { text: String(text).trim().slice(0, 5000) };
}

module.exports = { isConfigured, transcribe };
