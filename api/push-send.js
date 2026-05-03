const webpush = require('web-push');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const PUB = process.env.VAPID_PUBLIC_KEY;
  const PRIV = process.env.VAPID_PRIVATE_KEY;
  const SUBJ = process.env.VAPID_SUBJECT || 'mailto:admin@konekta.app';
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!PUB || !PRIV) return res.status(500).json({ error: 'VAPID env vars missing' });
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });

  webpush.setVapidDetails(SUBJ, PUB, PRIV);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  body = body || {};

  const calleeId = body.callee_id;
  const callerName = (body.caller_name || 'Appelant').toString().slice(0, 80);
  const callerId = body.caller_id || null;
  const callerAvatar = body.caller_avatar || null;  // URL ou data: pour l'icône notif
  const callId = body.call_id || null;
  const callType = body.call_type === 'video' ? 'video' : 'audio';

  if (!calleeId || !callId) return res.status(400).json({ error: 'callee_id and call_id required' });

  // Récupérer toutes les subscriptions du destinataire
  const subsRes = await fetch(SUPA_URL + '/rest/v1/konekta_push_subscriptions?user_id=eq.' + encodeURIComponent(calleeId) + '&select=endpoint,p256dh,auth', {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
  });
  if (!subsRes.ok) return res.status(500).json({ error: 'Supabase fetch failed' });
  const subs = await subsRes.json();
  if (!Array.isArray(subs) || subs.length === 0) return res.status(200).json({ sent: 0, reason: 'no subscriptions' });

  const payload = JSON.stringify({
    type: 'incoming_call',
    call_id: callId,
    caller_id: callerId,
    caller_name: callerName,
    caller_avatar: callerAvatar,
    call_type: callType,
    ts: Date.now()
  });

  const ttl = 30; // 30 secondes — au-delà l'appel n'est plus pertinent
  const opts = { TTL: ttl, urgency: 'high', topic: 'knk-call' };

  const results = await Promise.allSettled(subs.map(s =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, opts)
  ));

  // Nettoie les abonnements morts (404/410)
  const dead = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected' && r.reason && (r.reason.statusCode === 404 || r.reason.statusCode === 410)) {
      dead.push(subs[i].endpoint);
    }
  });
  if (dead.length) {
    await Promise.allSettled(dead.map(ep =>
      fetch(SUPA_URL + '/rest/v1/konekta_push_subscriptions?user_id=eq.' + encodeURIComponent(calleeId) + '&endpoint=eq.' + encodeURIComponent(ep), {
        method: 'DELETE',
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
      })
    ));
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  res.status(200).json({ sent, total: subs.length, removed_dead: dead.length });
};
