// Actualizaciones obligatorias. El service worker nuevo queda "en espera" y la app muestra un modal que no se puede
// cerrar: la única salida es "Actualizar ahora". Las novedades salen de version.json (siempre de la red).
// Se busca actualización al abrir, al volver a la app y cada hora. Si el usuario está registrando algo (una hoja
// abierta), el modal espera a que la cierre para no perder lo que estaba haciendo.
import { el, html, raw } from './utils/dom.js';
import { ORB_SPINNER } from './ui/orb-loader.js';
import { icon } from './utils/icons.js';
import { haptic } from './utils/haptics.js';
import { toast } from './ui/toast.js';
import { APP_VERSION } from './config.js';
import { shouldReloadOnControllerChange } from './route-guard.js';

const DONE_KEY = 'lukas-updated-to';
let reg = null;
let offered = false;
let updating = false;

/** Registra el service worker y vigila las versiones nuevas */
export function initUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let controlled = !!navigator.serviceWorker.controller; // ¿había una versión controlando la página?
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((r) => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) offer(r.waiting);
    if (r.installing) watch(r.installing);
    r.addEventListener('updatefound', () => watch(r.installing));
    setInterval(() => r.update().catch(() => {}), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
  }).catch((e) => console.warn('[sw]', e));
  // Primera instalación: clients.claim() dispara controllerchange y NO se recarga (era la doble carga al entrar).
  // Se recarga solo si se reemplaza una versión que ya controlaba la página o si el usuario tocó "Actualizar".
  let reloaded = false;
  const onControllerChange = () => {
    const reload = shouldReloadOnControllerChange({ wasControlled: controlled, userRequested: updating });
    controlled = true;
    if (!reload || reloaded) return;
    reloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  announceDone();
}

function watch(worker) {
  worker?.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
  });
}

/** "Buscar actualización" (Ajustes): true si hay una versión nueva (y entonces ya se muestra el modal) */
export async function checkForUpdate() {
  const r = reg ?? (await navigator.serviceWorker?.getRegistration());
  if (!r) return false;
  await r.update();
  const w = r.waiting ?? r.installing;
  if (!w) return false;
  if (r.waiting) offer(r.waiting); else watch(w);
  return true;
}

async function versionInfo() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* sin red: el modal igual se muestra */ }
  return {};
}

async function offer(worker) {
  if (offered) return;
  offered = true;
  const info = await versionInfo();
  // No interrumpir un registro en curso: se muestra apenas se cierre la hoja abierta
  const show = () => (document.querySelector('.sheet') ? setTimeout(show, 800) : showModal(worker, info));
  show();
}

function showModal(worker, info) {
  const version = info.version || 'nueva';
  const notes = Array.isArray(info.notes) ? info.notes.slice(0, 5) : [];
  const wrap = el(html`<div class="update-wrap" role="alertdialog" aria-modal="true" aria-labelledby="upd-title" aria-describedby="upd-desc">
    <div class="update-backdrop"></div>
    <div class="update-card">
      <div class="update-badge" aria-hidden="true">${icon('sparkles', { size: 32, stroke: 2 })}</div>
      <div class="update-version">Versión ${version}</div>
      <h2 id="upd-title">¡Hay una nueva versión de Lukas!</h2>
      <p id="upd-desc">Seguimos mejorando la app para ti. Actualiza para seguir usándola.</p>
      ${notes.length ? html`<div class="update-notes">
        <div class="un-title">Novedades</div>
        <ul>${notes.map((n) => html`<li>${icon('check', { size: 16, stroke: 2.6 })}<span>${n}</span></li>`)}</ul>
      </div>` : ''}
      <button type="button" class="btn btn-accent btn-block update-go" data-update-now>
        <span class="btn-label">${icon('refresh', { size: 20, stroke: 2.2 })}Actualizar ahora</span>${raw(ORB_SPINNER)}</button>
      <p class="update-foot">${icon('lock', { size: 13 })}Toma un segundo · tus datos están a salvo</p>
    </div>
  </div>`);

  // Bloquea la app: nada detrás responde (inert), no hay botón de cerrar, ni Escape, ni toque afuera
  const others = [...document.body.children].filter((n) => n !== wrap && !n.matches('#toast-root, script'));
  others.forEach((n) => { n.inert = true; });
  document.body.append(wrap);
  document.documentElement.classList.add('update-lock');
  const btn = wrap.querySelector('[data-update-now]');
  const keepFocus = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'Tab') { e.preventDefault(); btn.focus(); }
  };
  document.addEventListener('keydown', keepFocus, true);
  haptic.warning?.();
  setTimeout(() => btn.focus(), 50);

  btn.addEventListener('click', () => {
    if (updating) return;
    updating = true;
    haptic.success?.();
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
    try { sessionStorage.setItem(DONE_KEY, version); } catch { /* nada */ }
    const w = reg?.waiting ?? worker;
    if (w && w.state !== 'redundant') w.postMessage({ type: 'SKIP_WAITING' });
    // Si el navegador no avisa del cambio a tiempo, se recarga igual
    setTimeout(() => location.reload(), w ? 4000 : 0);
  });
}

/** Tras recargar por una actualización: confirmación breve */
function announceDone() {
  let v = null;
  try { v = sessionStorage.getItem(DONE_KEY); sessionStorage.removeItem(DONE_KEY); } catch { /* nada */ }
  if (v) setTimeout(() => toast(`¡Listo! Ya tienes la versión ${APP_VERSION}`), 900);
}
