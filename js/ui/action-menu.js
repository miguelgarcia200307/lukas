// Menú de acciones estilo nativo (hoja inferior compacta): cabecera opcional, grupo de opciones y "Cancelar" aparte.
// Se cierra arrastrando, tocando fuera, con Escape o con "atrás" de Android (todo eso lo da openSheet).
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { openSheet } from './sheet.js';

/**
 * actionMenu({ header, quick, actions: [{ id, label, icon, danger }] }) → Promise<id | null>
 * quick: fila opcional de acciones rápidas en mosaico arriba (como el menú contextual de iOS) [{ id, label, icon, primary }]
 * header: html`` opcional (p. ej. el resumen de la meta). onOpen(sheet) para animar lo que traiga la cabecera.
 * Resuelve null si se cierra sin elegir.
 */
export function actionMenu({ header = '', label = 'Opciones', actions = [], quick = [], onOpen = null }) {
  return new Promise((resolve) => {
    let picked = null;
    const s = openSheet({
      className: 'action-sheet',
      body: html`<div class="am" role="menu" aria-label="${label}">
        ${header ? html`<div class="am-head">${header}</div>` : ''}
        ${quick.length ? html`<div class="am-quick">${quick.map((a) => html`<button class="am-q${a.primary ? ' primary' : ''}" role="menuitem" data-act="${a.id}">${icon(a.icon, { size: 20 })}<span>${a.label}</span></button>`)}</div>` : ''}
        <div class="am-group">${actions.map((a) => html`<button class="am-item${a.danger ? ' danger' : ''}" role="menuitem" data-act="${a.id}">
          ${a.icon ? html`<span class="am-ic">${icon(a.icon, { size: 20 })}</span>` : ''}<span class="grow">${a.label}</span></button>`)}</div>
        <button class="am-cancel" data-sheet-close>Cancelar</button>
      </div>`,
      onClose: () => resolve(picked),
    });
    s.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      picked = b.dataset.act;
      haptic.tap();
      s.close();
    });
    onOpen?.(s);
  });
}
