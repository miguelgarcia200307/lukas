// Gestos: swipe en filas (editar/eliminar) y pull-to-refresh propio
import { haptic } from '../utils/haptics.js';
import { icon } from '../utils/icons.js';

const ACTION_W = 152;

/**
 * Activa swipe en los .swipe dentro de root. Cada .swipe tiene data-id y un .swipe-content.
 * handlers: { edit(id, row), delete(id, row) }
 */
export function enableSwipe(root, handlers) {
  let open = null;
  let g = null;

  const setX = (content, x, animate = true) => {
    content.classList.toggle('dragging', !animate);
    content.style.transform = x ? `translateX(${x}px)` : '';
  };
  const closeOpen = () => { if (open) { setX(open, 0); open = null; } };

  const down = (e) => {
    const content = e.target.closest('.swipe-content');
    if (!content || !root.contains(content) || e.button > 0) return;
    if (open && open !== content) closeOpen();
    g = { content, x0: e.clientX, y0: e.clientY, base: open === content ? -ACTION_W : 0, dx: 0, active: false, id: e.pointerId };
  };
  const move = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
      if (Math.abs(dx) < 10) return;
      g.active = true;
      try { g.content.setPointerCapture(e.pointerId); } catch { /* nada */ }
    }
    g.dx = dx;
    let x = g.base + dx;
    if (x > 0) x = x / 5;
    if (x < -ACTION_W) x = -ACTION_W + (x + ACTION_W) / 3;
    setX(g.content, x, false);
  };
  const up = () => {
    if (!g) return;
    const { content, base, dx, active } = g;
    g = null;
    if (!active) return;
    const x = base + dx;
    if (x < -ACTION_W * 0.4) { setX(content, -ACTION_W); open = content; haptic.select(); }
    else { setX(content, 0); if (open === content) open = null; }
    // evita el click que sigue al arrastre
    content.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
  };

  const click = (e) => {
    const btn = e.target.closest('[data-swipe]');
    if (btn && root.contains(btn)) {
      const row = btn.closest('.swipe');
      closeOpen();
      haptic.tap();
      handlers[btn.dataset.swipe]?.(row.dataset.id, row);
      return;
    }
    if (open && !e.target.closest('.swipe-actions')) {
      e.stopPropagation();
      e.preventDefault();
      closeOpen();
    }
  };

  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('click', click, true);
  return () => {
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', up);
    root.removeEventListener('click', click, true);
  };
}

/** Pull-to-refresh en un contenedor con scroll. Inserta el indicador al inicio. */
export function pullToRefresh(scroller, onRefresh) {
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.innerHTML = `<div class="ptr-ind">${icon('refresh', { size: 18, stroke: 2.2 })}</div>`;
  scroller.prepend(ptr);
  const ind = ptr.firstElementChild;
  const svg = ind.querySelector('svg');
  const THRESHOLD = 72;
  let y0 = null, dy = 0, busy = false, fired = false;

  const paint = (d) => {
    const p = Math.min(1, d / THRESHOLD);
    ind.style.opacity = String(p);
    ind.style.transform = `translateY(${Math.min(d, THRESHOLD * 1.3) * 0.7 - 40}px) scale(${0.6 + p * 0.4})`;
    svg.style.transform = `rotate(${d * 3}deg)`;
  };
  const reset = () => {
    ind.style.transition = 'transform 320ms var(--spring), opacity 240ms';
    paint(0);
    setTimeout(() => { ind.style.transition = ''; }, 340);
  };

  const start = (e) => { if (!busy && scroller.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; fired = false; } };
  const moveH = (e) => {
    if (y0 == null) return;
    dy = (e.touches[0].clientY - y0) * 0.55;
    if (dy <= 0) { paint(0); return; }
    if (scroller.scrollTop > 0) { y0 = null; paint(0); return; }
    paint(dy);
    if (dy > THRESHOLD && !fired) { fired = true; haptic.select(); }
  };
  const end = async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy > THRESHOLD && !busy) {
      busy = true;
      ptr.classList.add('refreshing');
      ind.style.transition = 'transform 240ms var(--spring)';
      ind.style.transform = 'translateY(10px) scale(1)';
      try { await onRefresh(); } finally {
        busy = false;
        ptr.classList.remove('refreshing');
        reset();
      }
    } else reset();
  };
  scroller.addEventListener('touchstart', start, { passive: true });
  scroller.addEventListener('touchmove', moveH, { passive: true });
  scroller.addEventListener('touchend', end);
  return () => {
    scroller.removeEventListener('touchstart', start);
    scroller.removeEventListener('touchmove', moveH);
    scroller.removeEventListener('touchend', end);
    ptr.remove();
  };
}
