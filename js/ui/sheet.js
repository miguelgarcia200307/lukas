// Bottom sheet nativo: arrastre para cerrar (pointer events), detents medio/completo, fondo con blur,
// botón "atrás" de Android cierra el sheet, Escape cierra, foco atrapado.
import { el, html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';

const stack = [];
let ignorePop = 0;

window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; return; }
  const top = stack[stack.length - 1];
  if (top) top.close({ fromPop: true });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

export function closeAllSheets() {
  [...stack].reverse().forEach((s) => s.close());
}

/**
 * openSheet({ title, body, footer, className, detent: 'large'|'medium', onClose, headerRight, dismissible })
 * body/footer: string | html`` | Node
 */
export function openSheet(opts = {}) {
  const { title = '', body = '', footer = null, className = '', detent = 'large', onClose, headerRight = '', dismissible = true } = opts;
  const id = Math.random().toString(36).slice(2);
  const backdrop = el('<div class="sheet-backdrop"></div>');
  const sheet = el(html`<section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${title || 'Panel'}" tabindex="-1">
    <div class="sheet-grabber" aria-hidden="true"></div>
    ${title ? html`<header class="sheet-head"><h2>${title}</h2>${headerRight}${dismissible ? html`<button class="icon-btn filled" data-sheet-close aria-label="Cerrar">${icon('x')}</button>` : ''}</header>` : ''}
    <div class="sheet-body"></div>
    ${footer != null ? html`<footer class="sheet-foot"></footer>` : ''}
  </section>`);
  const bodyEl = sheet.querySelector('.sheet-body');
  const footEl = sheet.querySelector('.sheet-foot');
  const put = (target, content) => {
    if (content == null) return;
    if (content instanceof Node) target.replaceChildren(content);
    else target.innerHTML = String(content);
  };
  put(bodyEl, body);
  if (footEl) put(footEl, footer);

  document.body.append(backdrop, sheet);
  const prevFocus = document.activeElement;
  let height = sheet.offsetHeight;
  const mediumY = () => Math.round(height * 0.42);
  let baseY = detent === 'medium' ? mediumY() : 0;
  let closed = false;

  const setY = (y, animate = true) => {
    sheet.classList.toggle('dragging', !animate);
    sheet.style.transform = `translateY(${y}px)`;
    const p = 1 - Math.min(1, Math.max(0, y / height));
    backdrop.style.opacity = String(Math.max(0, p));
  };

  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.classList.add('open');
    setY(baseY);
    sheet.focus({ preventScroll: true });
  }));

  history.pushState({ lukasSheet: id }, '');

  function close({ fromPop = false, silent = false } = {}) {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    if (!fromPop && history.state?.lukasSheet === id) { ignorePop++; history.back(); }
    sheet.classList.remove('dragging');
    sheet.style.transform = 'translateY(105%)';
    backdrop.style.opacity = '0';
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 420);
    if (prevFocus?.focus) prevFocus.focus({ preventScroll: true });
    if (!silent) onClose?.();
  }

  // ── Arrastre desde el grabber/cabecera ──
  let drag = null;
  const startDrag = (y) => { drag = { y0: y, t0: performance.now(), last: y, lastT: performance.now(), v: 0 }; height = sheet.offsetHeight; };
  const moveDrag = (y) => {
    if (!drag) return;
    const now = performance.now();
    drag.v = (y - drag.last) / Math.max(1, now - drag.lastT);
    drag.last = y; drag.lastT = now;
    let dy = y - drag.y0 + baseY;
    if (dy < 0) dy = dy / 4; // resistencia hacia arriba
    setY(dy, false);
  };
  const endDrag = (y) => {
    if (!drag) return;
    const dy = y - drag.y0 + baseY;
    const v = drag.v;
    drag = null;
    if (dismissible && (dy > height * 0.55 || (v > 0.6 && dy > 40))) { haptic.tap(); close(); return; }
    if (dy > mediumY() * 0.5 && (detent === 'medium' || dy > mediumY())) baseY = mediumY();
    else baseY = 0;
    if (v < -0.5) baseY = 0;
    setY(baseY);
  };

  const handle = sheet.querySelectorAll('.sheet-grabber, .sheet-head');
  handle.forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, a, select')) return;
      h.setPointerCapture(e.pointerId);
      startDrag(e.clientY);
    });
    h.addEventListener('pointermove', (e) => moveDrag(e.clientY));
    h.addEventListener('pointerup', (e) => endDrag(e.clientY));
    h.addEventListener('pointercancel', (e) => endDrag(e.clientY));
  });

  // Arrastre desde el contenido cuando está arriba del todo
  let touchY = null;
  bodyEl.addEventListener('touchstart', (e) => { touchY = bodyEl.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  bodyEl.addEventListener('touchmove', (e) => {
    if (touchY == null) return;
    const y = e.touches[0].clientY;
    if (!drag && y - touchY > 8 && bodyEl.scrollTop <= 0) startDrag(touchY);
    if (drag) { e.preventDefault(); moveDrag(y); }
  }, { passive: false });
  bodyEl.addEventListener('touchend', (e) => {
    if (drag) endDrag(e.changedTouches[0].clientY);
    touchY = null;
  });

  backdrop.addEventListener('click', () => dismissible && close());
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-sheet-close]')) close(); });

  // Foco atrapado
  sheet.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex="0"]')]
      .filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const api = {
    el: sheet,
    body: bodyEl,
    foot: footEl,
    close,
    get closed() { return closed; },
    setBody: (c) => put(bodyEl, c),
    setFooter: (c) => footEl && put(footEl, c),
    expand: () => { baseY = 0; setY(0); },
  };
  stack.push(api);
  return api;
}
