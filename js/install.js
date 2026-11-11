// Instalación PWA: prompt propio en Android/Chrome e instrucciones ilustradas en iOS Safari
import { APP_NAME } from './config.js';
import { html, raw } from './utils/dom.js';
import { icon } from './utils/icons.js';
import { openSheet } from './ui/sheet.js';
import { toast } from './ui/toast.js';

const DISMISS_KEY = 'lukas-install-dismissed';
let deferred = null;

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    toast(`${APP_NAME} quedó instalada`);
  });
}

function recentlyDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - t < 7 * 24 * 3600 * 1000;
  } catch { return false; }
}
function rememberDismiss() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* nada */ }
}

/** Muestra el sheet de instalación si aplica. force=true lo muestra aunque se haya cerrado hace poco (Ajustes). */
export function maybePromptInstall({ force = false } = {}) {
  if (isStandalone()) { if (force) toast(`${APP_NAME} ya está instalada en este dispositivo`, { type: 'info' }); return false; }
  if (!force && recentlyDismissed()) return false;
  if (deferred) return showAndroid();
  if (isIOS()) return showIOS();
  if (force) toast('Abre esta página en Chrome (Android) o Safari (iPhone) para instalarla', { type: 'info' });
  return false;
}

function showAndroid() {
  let installed = false;
  const s = openSheet({
    detent: 'medium',
    className: 'install-sheet',
    body: html`<div class="install-hero">
        <img src="./assets/icons/icon-192.png" alt="" width="84" height="84" class="install-icon">
        <h2>Instalar ${APP_NAME} en este dispositivo</h2>
        <p class="muted">Ábrela desde tu pantalla de inicio como una app: más rápida, a pantalla completa y con notificaciones.</p>
      </div>`,
    footer: html`<button class="btn btn-ghost" data-later>Ahora no</button><button class="btn btn-primary grow" data-install>${icon('download')}<span>Instalar</span></button>`,
    onClose: () => { if (!installed) rememberDismiss(); },
  });
  s.foot.querySelector('[data-later]').addEventListener('click', () => s.close());
  s.foot.querySelector('[data-install]').addEventListener('click', async () => {
    if (!deferred) return s.close();
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    installed = outcome === 'accepted';
    s.close();
  });
  return true;
}

function showIOS() {
  const s = openSheet({
    detent: 'large',
    className: 'install-sheet',
    body: html`<div class="install-hero">
        <img src="./assets/icons/icon-192.png" alt="" width="84" height="84" class="install-icon">
        <h2>Instala ${APP_NAME} en tu iPhone</h2>
        <p class="muted">En dos toques la tendrás en tu pantalla de inicio, a pantalla completa y con notificaciones.</p>
      </div>
      <ol class="ios-steps">
        <li style="--i:0"><span class="step-n">1</span><div>Toca <b>Compartir</b> en la barra de Safari</div>
          <span class="ios-glyph share-glyph">${icon('share', { size: 22 })}</span></li>
        <li style="--i:1"><span class="step-n">2</span><div>Desliza y elige <b>Agregar a pantalla de inicio</b></div>
          <span class="ios-glyph">${icon('plus-square', { size: 22 })}</span></li>
        <li style="--i:2"><span class="step-n">3</span><div>Toca <b>Agregar</b> y abre ${APP_NAME} desde tu inicio</div>
          <img src="./assets/icons/icon-192.png" alt="" width="30" height="30" class="ios-mini"></li>
      </ol>
      <div class="ios-pointer" aria-hidden="true">${raw('<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M6 14l6 6 6-6"/></svg>')}</div>`,
    footer: html`<button class="btn btn-secondary btn-block" data-sheet-close>Entendido</button>`,
    onClose: rememberDismiss,
  });
  return !!s;
}
