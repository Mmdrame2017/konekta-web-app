// Proxy Vercel → OpenAI Whisper API
// Fallback STT pour mobile quand Deepgram WebSocket échoue
// Usage: POST /api/whisper-transcribe?lang=fr  (Content-Type: audio/webm, body = audio blob)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

  // Récupération du blob audio depuis le body (Vercel passe req.body en Buffer si bodyParser désactivé)
  const audioBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  if (!audioBuffer || audioBuffer.length < 1000) {
    return res.status(400).json({ error: 'Audio buffer too small or empty' });
  }

  const lang = (req.query && req.query.lang) || '';
  const ct = req.headers['content-type'] || 'audio/webm';
  const ext = ct.includes('webm') ? 'webm' : ct.includes('mp4') ? 'mp4' : ct.includes('ogg') ? 'ogg' : 'webm';

  try {
    const fd = new FormData();
    fd.append('file', new Blob([audioBuffer], { type: ct }), 'audio.' + ext);
    fd.append('model', 'whisper-1');
    fd.append('response_format', 'json');
    if (lang) fd.append('language', lang);

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: fd
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: 'OpenAI Whisper failed', status: r.status, detail: errText.slice(0, 500) });
    }

    const data = await r.json();
    res.status(200).json({ text: data.text || '', engine: 'whisper-1' });
  } catch (e) {
    res.status(500).json({ error: 'Transcription error', message: (e && e.message) || String(e) });
  }
};

// Vercel : désactive le bodyParser pour recevoir le binaire brut
module.exports.config = { api: { bodyParser: false } };
