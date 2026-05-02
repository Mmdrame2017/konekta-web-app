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
  const subscription = body.subscription;
  const userAgent = body.user_agent || (req.headers['user-agent'] || '').slice(0, 200);

  if (!userId) return res.status(400).json({ error: 'user_id required' });

  if (req.method === 'DELETE') {
    const endpoint = body.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    const r = await fetch(SUPA_URL + '/rest/v1/konekta_push_subscriptions?user_id=eq.' + encodeURIComponent(userId) + '&endpoint=eq.' + encodeURIComponent(endpoint), {
      method: 'DELETE',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
    });
    return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription payload' });
  }

  const row = {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent
  };

  // Upsert sur (user_id, endpoint) — la contrainte unique est définie en SQL
  const r = await fetch(SUPA_URL + '/rest/v1/konekta_push_subscriptions?on_conflict=user_id,endpoint', {
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
    return res.status(500).json({ error: 'Supabase upsert failed', detail: txt });
  }

  res.status(200).json({ ok: true });
};
