const CACHE_NAME = 'konekta-v2';
const ASSETS = ['/', '/index.html', '/logo.png', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Bypass cache pour les API et le SW lui-même
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') {
        const clone = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// --- Push entrant : appel Konekta ---
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = {}; }

  if (data.type !== 'incoming_call') {
    // Push générique
    event.waitUntil(self.registration.showNotification(data.title || 'Konekta', {
      body: data.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      tag: data.tag || 'konekta',
      silent: false
    }));
    return;
  }

  const callerName = data.caller_name || 'Appelant';
  const callType = data.call_type === 'video' ? 'vidéo' : 'vocal';
  const title = '📞 Appel ' + callType + ' entrant';
  const body = callerName + ' vous appelle…';

  const opts = {
    body: body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: 'konekta-call-' + (data.call_id || 'x'),
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [600, 300, 600, 300, 600, 300, 600],
    timestamp: data.ts || Date.now(),
    data: {
      type: 'incoming_call',
      call_id: data.call_id,
      caller_id: data.caller_id,
      caller_name: callerName,
      call_type: data.call_type
    },
    actions: [
      { action: 'answer', title: '✅ Accepter' },
      { action: 'reject', title: '✖ Refuser' }
    ]
  };

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Détection focus stricte : visibilityState='visible' ET focused=true
    // (sur Android, visibilityState peut rester 'visible' alors que l'app est minimisée)
    const focused = clientsList.find(c => c.focused === true && c.visibilityState === 'visible');
    // Le client focused (s'il existe) affichera l'overlay immédiatement
    if (focused) {
      focused.postMessage({ source: 'sw-push', payload: data });
    }
    // On affiche TOUJOURS la notif système. C'est le seul moyen fiable
    // de garantir que l'utilisateur voit l'appel quand l'app est en arrière-plan
    // ou quand l'écran est verrouillé.
    await self.registration.showNotification(title, opts);
  })());
});

self.addEventListener('notificationclick', event => {
  const notif = event.notification;
  const action = event.action; // 'answer' | 'reject' | ''
  const data = notif.data || {};
  notif.close();

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = clientsList.find(c => c.url.includes(self.location.origin));

    if (data.type === 'incoming_call') {
      const msg = {
        source: 'sw-notification-click',
        action: action || 'open',
        call_id: data.call_id,
        caller_id: data.caller_id,
        caller_name: data.caller_name,
        call_type: data.call_type
      };
      if (client) {
        await client.focus();
        client.postMessage(msg);
      } else {
        const target = action === 'reject' ? '/?call_action=reject&call_id=' + encodeURIComponent(data.call_id || '')
                                            : '/?call_action=answer&call_id=' + encodeURIComponent(data.call_id || '');
        await self.clients.openWindow(target);
      }
      return;
    }

    if (client) { await client.focus(); }
    else { await self.clients.openWindow('/'); }
  })());
});

self.addEventListener('notificationclose', event => {
  // No-op : la sonnerie côté client gère son propre cycle de vie
});
