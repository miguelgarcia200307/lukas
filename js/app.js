// Bootstrap, router con hash y guardas de sesión
import { sb } from './supabase.js';
import { APP_NAME } from './config.js';
import { state, subscribe } from './state.js';
import { $, $$ } from './utils/dom.js';
import { haptic } from './utils/haptics.js';
import { loadProfile } from './api/profile.js';
import { refresh, persistCatalog, restoreCatalog, clearCatalog } from './api/catalog.js';
import { refreshUnread } from './api/notifications.js';
import { syncCreate } from './api/transactions.js';
import { flush, updateCount } from './offline-queue.js';
import { closeAllSheets } from './ui/sheet.js';
import { toast } from './ui/toast.js';
import { initInstall } from './install.js';
import { syncPushSubscription } from './push.js';
import { unlockVoice } from './voice/speech.js';

const ROUTES = [
  { path: 'login', load: () => import('./views/login.js'), public: true, chrome: false, depth: 0 },
  { path: 'bienvenida', load: () => import('./views/onboarding.js'), chrome: false, depth: 0 },
  { path: 'inicio', load: () => import('./views/home.js'), tab: 'inicio', depth: 0 },
  { path: 'movimientos', load: () => import('./views/movements.js'), tab: 'movimientos', depth: 0 },
  { path: 'reportes', load: () => import('./views/reports.js'), tab: 'reportes', depth: 0 },
  { path: 'mas', load: () => import('./views/more.js'), tab: 'mas', depth: 0 },
  { path: 'tarjetas', load: () => import('./views/cards.js'), tab: 'mas', depth: 1 },
  { path: 'tarjetas/:id', load: () => import('./views/card-detail.js'), tab: 'mas', depth: 2 },
  { path: 'cuentas', load: () => import('./views/accounts.js'), tab: 'mas', depth: 1 },
  { path: 'creditos', load: () => import('./views/debts.js'), tab: 'mas', depth: 1 },
  { path: 'suscripciones', load: () => import('./views/subscriptions.js'), tab: 'mas', depth: 1 },
  { path: 'presupuestos', load: () => import('./views/budgets.js'), tab: 'mas', depth: 1 },
  { path: 'metas', load: () => import('./views/goals.js'), tab: 'mas', depth: 1 },
  { path: 'categorias', load: () => import('./views/categories.js'), tab: 'mas', depth: 1 },
  { path: 'notificaciones', load: () => import('./views/notifications.js'), tab: 'inicio', depth: 1 },
  { path: 'ajustes', load: () => import('./views/settings.js'), tab: 'mas', depth: 1 },
];

const TAB_ORDER = ['inicio', 'movimientos', 'reportes', 'mas'];

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = h.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  for (const r of ROUTES) {
    const rs = r.path.split('/');
    if (rs.length !== segs.length) continue;
    const params = {};
    if (rs.every((s, i) => (s.startsWith(':') ? ((params[s.slice(1)] = decodeURIComponent(segs[i])), true) : s === segs[i]))) {
      return { route: r, params, query };
    }
  }
  return null;
}

function navigate(path, { replace = false } = {}) {
  const target = `#/${path.replace(/^#?\/?/, '')}`;
  if (replace) history.replaceState(history.state, '', target);
  else if (location.hash !== target) { location.hash = target; return; }
  route();
}

let current = null; // { route, cleanup, screen }
let routing = 0;

async function route() {
  const token = ++routing;
  let match = parseHash();
  if (!match) { navigate(state.session ? 'inicio' : 'login', { replace: true }); return; }
  if (!match.route.public && !state.session) { navigate('login', { replace: true }); return; }
  if (match.route.path === 'login' && state.session) { navigate('inicio', { replace: true }); return; }

  closeAllSheets();
  const mod = await match.route.load();
  if (token !== routing) return;

  const prev = current?.route;
  let dir = 'fade';
  if (prev) {
    if (match.route.depth > prev.depth) dir = 'push';
    else if (match.route.depth < prev.depth && prev.tab === match.route.tab) dir = 'pop';
  }

  const screen = document.createElement('section');
  screen.className = `screen ${match.route.chrome === false ? 'no-tabbar' : ''}`;
  screen.dataset.route = match.route.path;
  const ctx = { params: match.params, query: match.query, navigate };

  const swap = () => {
    try { current?.cleanup?.(); } catch (e) { console.error(e); }
    $('#view').replaceChildren(screen);
    let cleanup = null;
    try {
      const r = mod.mount(screen, ctx);
      if (r instanceof Promise) r.then((c) => { if (current?.screen === screen) current.cleanup = c; }).catch((e) => console.error(e));
      else cleanup = r;
    } catch (e) { console.error(e); }
    current = { route: match.route, cleanup, screen };
    updateChrome(match.route);
    document.title = mod.title ? `${mod.title} · ${APP_NAME}` : APP_NAME;
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && prev && !reduce) {
    const root = document.documentElement;
    root.classList.add(`vt-${dir}`);
    const t = document.startViewTransition(swap);
    t.finished.finally(() => root.classList.remove(`vt-${dir}`));
  } else {
    if (prev && !reduce) screen.classList.add(`enter-${dir}`);
    swap();
  }
}

function updateChrome(r) {
  const tabbar = $('.tabbar');
  tabbar.classList.toggle('hidden', r.chrome === false);
  $$('.tab[data-tab]').forEach((t) => {
    const active = t.dataset.tab === r.tab;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
}

// ── Navegación inferior ─────────────────────────
function initTabbar() {
  $('.tabbar').addEventListener('click', async (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    haptic.tap();
    if (tab.dataset.tab) {
      const target = tab.dataset.tab;
      if (current?.route.path === target) {
        current.screen.querySelector('.scroller')?.scrollTo({ top: 0, behavior: 'smooth' });
      } else navigate(target);
      return;
    }
    if (tab.dataset.voice !== undefined) {
      unlockVoice(); // dentro del toque (antes del import asíncrono): iOS deja hablar a Lukas
      const { openVoice } = await import('./voice/voice-sheet.js');
      openVoice({ autoStart: true });
    }
  });
  // Botón atrás genérico en vistas internas
  document.addEventListener('click', (e) => {
    const back = e.target.closest('[data-back]');
    if (!back) return;
    haptic.tap();
    const r = current?.route;
    if (history.length > 1 && r && r.depth > 0) history.back();
    else navigate(r?.depth === 2 ? r.path.split('/')[0] : 'mas');
  });
}

// ── Conexión y cola offline ─────────────────────
function initNetwork() {
  const pill = $('#net-pill');
  const paint = () => {
    const offline = !state.online;
    const syncing = state.online && state.pendingSync > 0;
    pill.classList.toggle('show', offline || syncing);
    pill.querySelector('.np-text').textContent = offline ? 'Sin conexión' : `Sincronizando ${state.pendingSync}…`;
    pill.querySelector('.np-icon').hidden = !offline;
    pill.querySelector('.pulse-dot').hidden = offline;
  };
  subscribe('online', paint);
  subscribe('pendingSync', paint);
  const sync = async () => {
    if (!state.session) return;
    const n = await flush({ create_transactions: syncCreate });
    if (n) toast(n === 1 ? 'Se sincronizó 1 movimiento' : `Se sincronizaron ${n} movimientos`);
  };
  window.addEventListener('online', () => { state.online = true; sync(); refreshAll(); });
  window.addEventListener('offline', () => { state.online = false; });
  updateCount().then(paint);
  return sync;
}

async function refreshAll() {
  if (!state.session || !navigator.onLine) return;
  await Promise.allSettled([loadProfile(), refresh(), refreshUnread()]);
  persistCatalog();
}

// ── Service worker + aviso de nueva versión ─────
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    if (!reg) return;
    const promptUpdate = (worker) => {
      toast('Hay una nueva versión', {
        type: 'info', duration: 15000,
        action: { label: 'Actualizar', fn: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('[sw]', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'NAVIGATE' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#');
    if (e.data?.type === 'PUSH') refreshUnread();
    if (e.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') syncPushSubscription();
  });
}

function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 500);
}

// ── Arranque ───────────────────────────────────
async function boot() {
  const t0 = performance.now();
  initServiceWorker();
  initTabbar();
  initInstall();
  const sync = initNetwork();

  const { data } = await sb.auth.getSession();
  state.session = data.session;

  if (state.session) {
    restoreCatalog();
    if (navigator.onLine) {
      try {
        await Promise.all([loadProfile(), refresh()]);
        persistCatalog();
        refreshUnread();
        sync();
        syncPushSubscription();
      } catch (e) {
        console.error(e);
        if (!state.profile) toast('No pudimos cargar tus datos. Revisa tu conexión.', { type: 'err' });
      }
    }
    if (state.profile && !state.profile.onboarded && !location.hash.includes('bienvenida')) {
      history.replaceState(null, '', '#/bienvenida');
    }
  }

  sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'SIGNED_OUT') {
      clearCatalog();
      ['categories', 'accounts', 'cards', 'debts', 'subscriptions', 'goals', 'budgets'].forEach((k) => { state[k] = []; });
      state.profile = null;
      navigate('login', { replace: true });
    }
  });

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session) { refreshUnread(); sync(); }
  });

  // Splash mínimo para que la animación del logo se vea completa
  const elapsed = performance.now() - t0;
  await new Promise((r) => setTimeout(r, Math.max(0, 1100 - elapsed)));
  await route();
  hideSplash();
}

/** Llamado por la vista de login tras autenticarse */
export async function afterLogin(session) {
  state.session = session;
  await Promise.all([loadProfile(), refresh()]);
  persistCatalog();
  refreshUnread();
  syncPushSubscription();
  navigate(state.profile?.onboarded ? 'inicio' : 'bienvenida', { replace: true });
}


boot().catch((e) => {
  console.error('[boot]', e);
  hideSplash();
  navigate('login', { replace: true });
});
