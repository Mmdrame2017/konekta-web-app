// Génère un JWT signé pour rejoindre 8x8.vc JaaS via lib-jitsi-meet (low-level API).
// L'iframe API contournait ça via un cookie magique, mais lib-jitsi-meet exige un vrai
// JWT signé RS256 avec la private key Konekta JaaS.
//
// POST { room?, name? } -> { token, expires_in }
// Le token a une validité de 2h, scopé à room='*' (toutes les salles du tenant).

const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.JAAS_API_KEY;            // kid dans le header JWT
  let privateKey = process.env.JAAS_PRIVATE_KEY;       // PEM RS256
  if (!apiKey || !privateKey) {
    return res.status(500).json({ error: 'JAAS_API_KEY or JAAS_PRIVATE_KEY missing' });
  }

  // Normaliser les newlines de la private key (Vercel stocke souvent les \n littéraux)
  if (privateKey.indexOf('\\n') !== -1) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const room = (body.room || '*').toString().slice(0, 200);
  const name = (body.name || 'Konekta User').toString().slice(0, 80);
  const userId = (body.user_id || '').toString().slice(0, 100);
  const avatar = (body.avatar || '').toString().slice(0, 500);

  // Le sub = AppId (sans le préfixe "vpaas-magic-cookie-")
  // L'API key complète est de la forme "vpaas-magic-cookie-XXX/keyId" ou parfois juste l'AppId.
  // On extrait l'AppId depuis le kid si possible.
  const appIdMatch = apiKey.match(/^(vpaas-magic-cookie-[a-zA-Z0-9]+)/);
  const sub = appIdMatch ? appIdMatch[1] : apiKey;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: sub,
    room: room,
    iat: now,
    nbf: now - 10,
    exp: now + 7200,    // 2h
    context: {
      user: {
        id: userId || ('konekta-' + Math.random().toString(36).slice(2, 10)),
        name: name,
        avatar: avatar,
        moderator: 'true'
      },
      features: {
        livestreaming: 'false',
        recording: 'false',
        transcription: 'false',
        'outbound-call': 'false'
      }
    }
  };

  try {
    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      header: { kid: apiKey, typ: 'JWT' }
    });
    res.status(200).json({ token, expires_in: 7200, sub });
  } catch (e) {
    res.status(500).json({ error: 'JWT signing failed', message: (e && e.message) || String(e) });
  }
};
