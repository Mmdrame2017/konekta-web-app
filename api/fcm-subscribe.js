// Enregistre un FCM token pour l'utilisateur courant.
// Appelé par l'app Capacitor au démarrage et à chaque renouvellement du token Firebase.
// POST { user_id, fcm_token, device_info? } -> { ok: true }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  body = body || {};

  const userId = body.user_id;
  const fcmToken = body.fcm_token;
  const deviceInfo = (body.device_info || (req.headers['user-agent'] || '').slice(0, 200));

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  if (req.method === 'DELETE') {
    if (!fcmToken) return res.status(400).json({ error: 'fcm_token required' });
    const r = await fetch(SUPA_URL + '/rest/v1/konekta_fcm_tokens?user_id=eq.' + encodeURIComponent(userId) + '&fcm_token=eq.' + encodeURIComponent(fcmToken), {
      method: 'DELETE',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
    });
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!fcmToken) return res.status(400).json({ error: 'fcm_token required' });

  const row = { user_id: userId, fcm_token: fcmToken, device_info: deviceInfo };

  // Upsert sur fcm_token (unique). Si le token a changé d'utilisateur, on remplace.
  const r = await fetch(SUPA_URL + '/rest/v1/konekta_fcm_tokens?on_conflict=fcm_token', {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!r.ok) {
    const txt = await r.text();
    return res.status(500).json({ error: 'Supabase upsert failed', detail: txt.slice(0, 500) });
  }

  res.status(200).json({ ok: true });
};
