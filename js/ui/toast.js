import { el, html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';

const root = () => document.getElementById('toast-root');

/**
 * toast('Guardado', { type: 'ok'|'err'|'info', action: { label: 'Deshacer', fn }, duration })
 */
export function toast(message, { type = 'ok', action = null, duration } = {}) {
  const ms = duration ?? (action ? 5000 : type === 'err' ? 4500 : 2800);
  const ic = type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info';
  const node = el(html`<div class="toast" role="${type === 'err' ? 'alert' : 'status'}">
    <span class="t-icon ${type}">${icon(ic, { size: 22, stroke: 2.2 })}</span>
    <span class="t-msg">${message}</span>
    ${action ? html`<button class="t-action">${action.label}</button>` : ''}
  </div>`);
  root().append(node);
  if (type === 'err') haptic.error();

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 300);
  };
  timer = setTimeout(dismiss, ms);
  node.querySelector('.t-action')?.addEventListener('click', async () => {
    dismiss();
    haptic.tap();
    try { await action.fn(); } catch (e) { toast(e.message ?? 'No se pudo deshacer', { type: 'err' }); }
  });
  // deslizar hacia abajo para descartar
  let y0 = null;
  node.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  node.addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 > 20) dismiss(); y0 = null; });
  return { dismiss };
}
