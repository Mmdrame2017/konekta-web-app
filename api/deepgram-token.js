// Génère un token Deepgram temporaire (1h) pour usage côté frontend.
// La master key (DEEPGRAM_API_KEY) reste côté serveur et n'est jamais exposée au client.
// Usage: POST /api/deepgram-token  → { token: "...", expires_in: 3600 }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dgKey = process.env.DEEPGRAM_API_KEY;
  if (!dgKey) return res.status(500).json({ error: 'DEEPGRAM_API_KEY missing' });

  try {
    // Récupère le project_id (le 1er project du compte)
    let projectId = process.env.DEEPGRAM_PROJECT_ID;
    if (!projectId) {
      const projRes = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: 'Token ' + dgKey }
      });
      if (!projRes.ok) {
        const t = await projRes.text();
        return res.status(502).json({ error: 'Deepgram /projects failed', status: projRes.status, detail: t.slice(0, 300) });
      }
      const projData = await projRes.json();
      const projects = projData.projects || [];
      if (projects.length === 0) return res.status(500).json({ error: 'No Deepgram project found on this account' });
      projectId = projects[0].project_id;
    }

    // Crée une clé temporaire avec scope minimal (usage:write = transcrire) et TTL 1h
    const r = await fetch('https://api.deepgram.com/v1/projects/' + projectId + '/keys', {
      method: 'POST',
      headers: { Authorization: 'Token ' + dgKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment: 'konekta-temp-' + Date.now(),
        scopes: ['usage:write'],
        time_to_live_in_seconds: 3600
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'Deepgram key creation failed', status: r.status, detail: t.slice(0, 300) });
    }

    const data = await r.json();
    if (!data.key) return res.status(500).json({ error: 'Deepgram returned no key', data });

    res.status(200).json({ token: data.key, expires_in: 3600 });
  } catch (e) {
    res.status(500).json({ error: 'Token generation error', message: (e && e.message) || String(e) });
  }
};
