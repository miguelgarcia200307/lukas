import { el, html } from '../utils/dom.js';
import { haptic } from '../utils/haptics.js';

/** Diálogo de confirmación → Promise<boolean> */
export function confirmDialog({ title, message = '', confirm = 'Aceptar', cancel = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = el(html`<div class="dialog-wrap" role="alertdialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-backdrop open"></div>
      <div class="dialog">
        <h3>${title}</h3>
        ${message ? html`<p>${message}</p>` : ''}
        <div class="actions">
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirm}</button>
          <button class="btn btn-ghost" data-cancel>${cancel}</button>
        </div>
      </div>
    </div>`);
    if (danger) haptic.warning();
    document.body.append(wrap);
    const done = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    wrap.querySelector('[data-ok]').addEventListener('click', () => done(true));
    wrap.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    wrap.querySelector('.sheet-backdrop').addEventListener('click', () => done(false));
    wrap.querySelector('[data-ok]').focus();
  });
}
