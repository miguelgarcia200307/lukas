// Lukas · service worker
// Precache del app shell con caché versionada, stale-while-revalidate para estáticos y CDNs,
// nunca cachea Supabase / Auth / Edge Functions / Groq. Push + notificationclick.
const VERSION = 'lukas-v1.4.2'; // mantener igual a APP_VERSION en js/config.js
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/badge-96.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/logo.svg',
  './assets/icons/favicon-32.png',
  './css/animations.css',
  './css/base.css',
  './css/components.css',
  './css/tokens.css',
  './css/views.css',
  './js/api/accounts.js',
  './js/api/ai.js',
  './js/api/base.js',
  './js/api/budgets.js',
  './js/api/cards.js',
  './js/api/catalog.js',
  './js/api/categories.js',
  './js/api/debts.js',
  './js/api/goals.js',
  './js/api/notifications.js',
  './js/api/profile.js',
  './js/api/reports.js',
  './js/api/subscriptions.js',
  './js/api/transactions.js',
  './js/app.js',
  './js/config.js',
  './js/install.js',
  './js/offline-queue.js',
  './js/permissions.js',
  './js/push.js',
  './js/state.js',
  './js/supabase.js',
  './js/ui/charts.js',
  './js/ui/common.js',
  './js/ui/empty.js',
  './js/ui/form.js',
  './js/ui/gestures.js',
  './js/ui/logo.js',
  './js/ui/modal.js',
  './js/ui/number-input.js',
  './js/ui/pickers.js',
  './js/ui/sheet.js',
  './js/ui/skeleton.js',
  './js/ui/toast.js',
  './js/utils/dates.js',
  './js/utils/dom.js',
  './js/utils/export.js',
  './js/utils/format.js',
  './js/utils/haptics.js',
  './js/utils/icons.js',
  './js/views/accounts.js',
  './js/views/budgets.js',
  './js/views/card-detail.js',
  './js/views/cards.js',
  './js/views/categories.js',
  './js/views/debts.js',
  './js/views/goals.js',
  './js/views/home.js',
  './js/views/login.js',
  './js/views/more.js',
  './js/views/movements.js',
  './js/views/notifications.js',
  './js/views/onboarding.js',
  './js/views/reports.js',
  './js/views/settings.js',
  './js/views/subscriptions.js',
  './js/views/transaction-form.js',
  './js/voice/orb.js',
  './js/voice/proposals.js',
  './js/voice/recorder.js',
  './js/voice/speech.js',
  './js/voice/talk.js',
  './js/voice/voice-sheet.js',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NEVER_CACHE = [/\.supabase\.co$/, /\.supabase\.in$/, /^api\.groq\.com$/];

self.addEventListener('install', (event) => {
  // La versión nueva se activa sola (sin depender de que el usuario toque "Actualizar") y descarga el shell
  // saltándose la caché HTTP (GitHub Pages manda max-age=600): si no, podía guardar archivos viejos como nuevos.
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  // Solo las cachés de ESTA versión (nunca un archivo de una versión anterior)
  const cached = (await (await caches.open(STATIC_CACHE)).match(request)) ?? (await cache.match(request)) ?? null;
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  const network = fetch(sameOrigin ? new Request(request, { cache: 'no-cache' }) : request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached ?? (await network) ?? new Response('', { status: 504, statusText: 'Offline' });
}

async function navigation(request) {
  try {
    const res = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put('./index.html', res.clone());
    return res;
  } catch {
    return (await caches.match('./index.html')) ?? (await caches.match('./')) ?? (await caches.match('./offline.html'));
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (NEVER_CACHE.some((re) => re.test(url.hostname))) return; // datos y auth siempre en vivo
  if (request.mode === 'navigate') { event.respondWith(navigation(request)); return; }
  if (url.origin === self.location.origin || CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ── Push ─────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { title: 'Lukas', body: event.data?.text() }; }
  const title = data.title || 'Lukas';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/badge-96.png',
      tag: data.tag || data.type || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '#/inicio' },
      lang: 'es-CO',
    });
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'PUSH', data }));
    if (self.navigator?.setAppBadge) self.navigator.setAppBadge().catch(() => {});
  })());
});

// La suscripción cambió o expiró: se renueva con las mismas opciones y se avisa a la app para guardarla
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const options = event.oldSubscription?.options;
      if (options?.applicationServerKey) await self.registration.pushManager.subscribe(options);
    } catch (err) {
      console.warn('[sw] no se pudo renovar la suscripción', err);
    }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/inicio', self.registration.scope).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      await client.focus();
      client.postMessage({ type: 'NAVIGATE', url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
