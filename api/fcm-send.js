// Envoie un push FCM à tous les devices Android d'un utilisateur (callee_id).
// Le payload est en mode "data-only" (pas de "notification" key) pour que l'app
// Capacitor reçoive un BackgroundMessageHandler et déclenche IncomingCallKit.showIncomingCall
// avec FullScreenIntent (effet WhatsApp).
//
// POST { callee_id, caller_id, caller_name, caller_avatar?, call_id, call_type } -> { sent, total }

const { GoogleAuth } = require('google-auth-library');

let _cachedAuth = null;

async function getAccessToken() {
  if (!_cachedAuth) {
    const credsRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credsRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON missing');
    let credentials;
    try { credentials = JSON.parse(credsRaw); }
    catch(e) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
    _cachedAuth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging']
    });
  }
  const client = await _cachedAuth.getClient();
  const r = await client.getAccessToken();
  return r.token;
}

function getProjectId() {
  try {
    const c = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    return c.project_id;
  } catch(e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const projectId = getProjectId();
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });
  if (!projectId) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON missing or invalid' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  body = body || {};

  const calleeId = body.callee_id;
  const callerName = (body.caller_name || 'Appelant').toString().slice(0, 80);
  const callerId = body.caller_id || '';
  const callerAvatar = body.caller_avatar || '';
  const callId = body.call_id || '';
  const callType = body.call_type === 'video' ? 'video' : 'audio';

  if (!calleeId || !callId) return res.status(400).json({ error: 'callee_id and call_id required' });

  const subsRes = await fetch(SUPA_URL + '/rest/v1/konekta_fcm_tokens?user_id=eq.' + encodeURIComponent(calleeId) + '&select=fcm_token', {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
  });
  if (!subsRes.ok) return res.status(500).json({ error: 'Supabase fetch failed' });
  const subs = await subsRes.json();
  if (!Array.isArray(subs) || subs.length === 0) return res.status(200).json({ sent: 0, reason: 'no fcm tokens' });

  let accessToken;
  try { accessToken = await getAccessToken(); }
  catch(e) { return res.status(500).json({ error: 'Firebase auth failed', message: e.message }); }

  // Payload data-only : Capacitor IncomingCallKit le lit côté natif Android,
  // affiche la notif fullscreen + active l'écran. Pas de "notification" key
  // car ça bypasserait notre handler natif et ne déclencherait pas FSI.
  const dataPayload = {
    type: 'incoming_call',
    call_id: String(callId),
    caller_id: String(callerId || ''),
    caller_name: callerName,
    caller_avatar: String(callerAvatar || ''),
    call_type: callType,
    ts: String(Date.now())
  };

  const fcmUrl = 'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send';

  const results = await Promise.allSettled(subs.map(s => {
    const message = {
      token: s.fcm_token,
      data: dataPayload,
      android: {
        priority: 'HIGH',
        ttl: '30s'
      }
    };
    return fetch(fcmUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }).then(async r => {
      const text = await r.text();
      return { ok: r.ok, status: r.status, body: text, token: s.fcm_token };
    });
  }));

  // Nettoie les tokens invalides (UNREGISTERED / INVALID_ARGUMENT)
  const dead = [];
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (!v.ok && (v.body.includes('UNREGISTERED') || v.body.includes('INVALID_ARGUMENT'))) {
        dead.push(v.token);
      }
    }
  });
  if (dead.length) {
    await Promise.allSettled(dead.map(t =>
      fetch(SUPA_URL + '/rest/v1/konekta_fcm_tokens?fcm_token=eq.' + encodeURIComponent(t), {
        method: 'DELETE',
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
      })
    ));
  }

  const sent = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  res.status(200).json({ sent, total: subs.length, removed_dead: dead.length });
};
