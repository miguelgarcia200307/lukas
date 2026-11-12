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
import { setSaveNotifier } from './ui/submit.js';
import { initInstall } from './install.js';
import { syncPushSubscription } from './push.js';
import { unlockVoice } from './voice/speech.js';
import { markVoiceUsed } from './ui/home-fx.js';
import { initUpdates } from './update.js';
import { AUTH, guardRoute, getLeaveGuard, setLeaveGuard } from './route-guard.js';
import { initLookSync } from './lukas/sync.js';
import { initVoiceLook } from './lukas/voice-look.js';
import './ui/lukas-orb.js'; // registra <lukas-orb> y <lukas-lockup>
import { takeOff, land, inFlight, firstLoadToday, startPhrases } from './ui/orb-loader.js';

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
  { path: 'lukas', load: () => import('./views/lukas-studio.js'), tab: 'mas', chrome: false, depth: 1 },
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
  const match = parseHash();
  // Mientras la sesión carga no se decide nada: el arranque llama a route() cuando ya se conoce el estado real
  const guard = guardRoute(match?.route ?? null, state.authStatus);
  if (guard.wait) return;
  if (guard.redirect) { navigate(guard.redirect, { replace: true }); return; }
  // La vista actual puede pedir confirmación antes de salir (cambios sin guardar)
  const leave = getLeaveGuard();
  if (leave && current && match.route !== current.route && !match.route.public) {
    let ok = true;
    try { ok = await leave(); } catch (e) { console.error(e); }
    if (!ok) { if (location.hash !== current.hash) history.pushState(history.state, '', current.hash); return; }
    setLeaveGuard(null);
  }
  const token = ++routing;

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
    current = { route: match.route, cleanup, screen, hash: location.hash };
    updateChrome(match.route);
    document.title = mod.title ? `${mod.title} · ${APP_NAME}` : APP_NAME;
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Con el personaje en vuelo (arranque o login → header) no se usa View Transition: el vuelo ES la transición
  const flight = inFlight();
  if (document.startViewTransition && prev && !reduce && !flight) {
    const root = document.documentElement;
    root.classList.add(`vt-${dir}`);
    const t = document.startViewTransition(swap);
    t.finished.finally(() => root.classList.remove(`vt-${dir}`));
  } else {
    if (prev && !reduce) screen.classList.add(`enter-${dir}`);
    swap();
    if (flight) land(screen.querySelector('[data-orb-slot] lukas-orb'));
  }
}

function updateChrome(r) {
  const tabbar = $('.tabbar');
  tabbar.classList.toggle('hidden', r.chrome === false);
  const hadActive = $$('.tab.active').length > 0;
  $$('.tab[data-tab]').forEach((t) => {
    const active = t.dataset.tab === r.tab;
    // Al cambiar de pestaña, el ícono activo da un pequeño rebote
    if (active && hadActive && !t.classList.contains('active')) {
      t.classList.remove('bounce');
      void t.offsetWidth;
      t.classList.add('bounce');
    }
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
}

// ── Navegación inferior ─────────────────────────
// iOS Safari no aplica :active (estado presionado) a menos que el documento escuche touchstart
document.addEventListener('touchstart', () => {}, { passive: true });

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
      markVoiceUsed();
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

// Sincronizaciones en segundo plano: el personaje del header procesa mientras state.syncing > 0
async function track(promise) {
  state.syncing = (state.syncing ?? 0) + 1;
  try { return await promise; } finally { state.syncing = Math.max(0, (state.syncing ?? 1) - 1); }
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
    const n = await track(flush({ create_transactions: syncCreate }));
    if (n) toast(n === 1 ? 'Se sincronizó 1 movimiento' : `Se sincronizaron ${n} movimientos`);
  };
  window.addEventListener('online', () => { state.online = true; sync(); refreshAll(); });
  window.addEventListener('offline', () => { state.online = false; });
  updateCount().then(paint);
  return sync;
}

async function refreshAll() {
  if (!state.session || !navigator.onLine) return;
  await track(Promise.allSettled([loadProfile(), refresh(), refreshUnread()]));
  persistCatalog();
}

// ── Service worker + actualización obligatoria (modal en update.js) ─────
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  initUpdates();
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'NAVIGATE' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#');
    if (e.data?.type === 'PUSH') refreshUnread();
    if (e.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') syncPushSubscription();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sequenceEnd = (orb, name) => new Promise((r) => {
  const h = (e) => { if (e.detail.state === name) { orb.removeEventListener('sequenceend', h); r(); } };
  orb.addEventListener('sequenceend', h);
});
/** Precarga el resumen de Inicio para que el arranque y el login no muestren un segundo loader. */
async function prefetchHome() {
  const path = parseHash()?.route.path;
  if (path && path !== 'inicio' && path !== 'login') return;
  if (!state.profile?.onboarded) return;
  const home = await import('./views/home.js');
  await home.prefetch();
}

function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 500);
}

// ── Arranque ───────────────────────────────────
// Intro del personaje → procesando mientras cargan los datos → listo (solo la primera carga del día)
// → viaja a su lugar en el header (o al lockup del login) mientras aparece el contenido.
async function boot() {
  setSaveNotifier(toast); // los errores de cualquier guardado se muestran con el toast de la app
  const t0 = performance.now();
  const orb = document.getElementById('splash-orb');
  const introDone = orb ? Promise.race([sequenceEnd(orb, 'intro'), sleep(2600)]) : Promise.resolve();
  initServiceWorker();
  initTabbar();
  initInstall();
  const sync = initNetwork();
  initLookSync(); // apariencia de Lukas por cuenta (sigue a state.session)
  initVoiceLook(); // y el mismo estilo en la hoja de voz

  let loadFailed = false;
  const loadData = async () => {
    // La sesión se resuelve una sola vez, aquí; el resto de la app consume state.session / state.authStatus
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    if (!state.session) return;
    restoreCatalog();
    if (navigator.onLine) {
      try {
        await Promise.all([loadProfile(), refresh()]);
        persistCatalog();
        refreshUnread();
        sync();
        syncPushSubscription();
        await prefetchHome().catch((e) => console.error(e));
      } catch (e) {
        console.error(e);
        loadFailed = true;
        if (!state.profile) toast('No pudimos cargar tus datos. Revisa tu conexión.', { type: 'err' });
      }
    }
    if (state.profile && !state.profile.onboarded && !location.hash.includes('bienvenida')) {
      history.replaceState(null, '', '#/bienvenida');
    }
  };
  let loaded = false;
  const ready = loadData().finally(() => { loaded = true; });

  await introDone;
  if (!loaded && orb) {
    orb.think();
    let stop = null;
    const slow = setTimeout(() => { stop = startPhrases(document.querySelector('#splash .lukas-phrase')); }, Math.max(0, 4000 - (performance.now() - t0)));
    await ready.catch(() => {});
    clearTimeout(slow); stop?.();
  }
  await ready;
  if (orb && state.session && !loadFailed && firstLoadToday()) {
    orb.succeed();
    await sleep(1350);
  }
  orb?.cancel();

  sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    state.authStatus = session ? AUTH.AUTHENTICATED : AUTH.UNAUTHENTICATED;
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

  state.authStatus = state.session ? AUTH.AUTHENTICATED : AUTH.UNAUTHENTICATED;
  if (orb) takeOff(orb);
  await route();
  hideSplash();
}

/** Llamado por la vista de login tras autenticarse */
export async function afterLogin(session, { onReady } = {}) {
  state.session = session;
  state.authStatus = AUTH.AUTHENTICATED;
  await Promise.all([loadProfile(), refresh()]);
  persistCatalog();
  refreshUnread();
  syncPushSubscription();
  if (state.profile?.onboarded) await import('./views/home.js').then((m) => m.prefetch()).catch((e) => console.error(e));
  await onReady?.(); // el login celebra y saca al personaje a volar antes de cambiar de pantalla
  navigate(state.profile?.onboarded ? 'inicio' : 'bienvenida', { replace: true });
}


boot().catch((e) => {
  console.error('[boot]', e);
  state.authStatus = state.session ? AUTH.AUTHENTICATED : AUTH.UNAUTHENTICATED;
  if (inFlight()) land(null);
  hideSplash();
  navigate('login', { replace: true });
});
