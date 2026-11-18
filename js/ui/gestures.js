// Gestos: swipe en filas (editar/eliminar), mantener presionado y pull-to-refresh propio
import { haptic } from '../utils/haptics.js';

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
    // progreso 0–1 en la fila: permite que las acciones aparezcan con el dedo (lo usan las tarjetas de metas)
    const row = content.parentElement;
    row?.style.setProperty('--swipe-p', String(Math.min(1, Math.abs(x) / ACTION_W).toFixed(3)));
    row?.classList.toggle('swipe-drag', !animate);
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
    // evita el click que sigue al arrastre (solo el de este gesto: en táctil a veces no llega y no debe
    // quedarse esperando para comerse el siguiente toque real)
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    content.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => content.removeEventListener('click', swallow, { capture: true }), 350);
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

/**
 * Mantener presionado (como el menú contextual nativo): tras `delay` ms sin mover el dedo llama onPress(el).
 * Mientras se sostiene, el elemento recibe .pressing (para encogerlo un poco). El toque que sigue se descarta,
 * y el menú contextual del sistema (clic derecho / pulsación larga de Android) abre lo mismo.
 * ignore: selector dentro del elemento donde no aplica (botones propios, acciones del swipe…).
 */
export function enableLongPress(root, selector, onPress, { delay = 480, ignore = '' } = {}) {
  let p = null, fired = false;
  const target = (e) => {
    const t = e.target.closest?.(selector);
    if (!t || !root.contains(t) || (ignore && e.target.closest(ignore))) return null;
    return t;
  };
  const cancel = () => {
    if (!p) return;
    clearTimeout(p.hint); clearTimeout(p.timer);
    p.el.classList.remove('pressing');
    p = null;
  };
  const fire = (node) => {
    cancel();
    fired = true;
    setTimeout(() => { fired = false; }, 800); // solo descarta el toque de este mismo gesto
    haptic.select();
    onPress(node);
  };
  const down = (e) => {
    fired = false;
    if (e.button > 0) return;
    const node = target(e);
    if (!node) return;
    cancel();
    p = { el: node, x: e.clientX, y: e.clientY, id: e.pointerId };
    // pequeña espera antes de encoger: un toque o un scroll rápido no deben verse como "presionar"
    p.hint = setTimeout(() => p?.el.classList.add('pressing'), 120);
    p.timer = setTimeout(() => fire(node), delay);
  };
  const move = (e) => { if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancel(); };
  const click = (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } };
  const menu = (e) => {
    const node = target(e);
    if (!node) return;
    e.preventDefault();
    if (!fired) fire(node);
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('click', click, true);
  root.addEventListener('contextmenu', menu);
  return () => {
    cancel();
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', cancel);
    root.removeEventListener('pointercancel', cancel);
    root.removeEventListener('click', click, true);
    root.removeEventListener('contextmenu', menu);
  };
}

/**
 * Pull-to-refresh con el personaje: mientras arrastras se estira siguiendo el dedo y abre más los ojos;
 * al soltar → procesando → listo (o error si la recarga falla). Inserta el indicador al inicio del contenedor.
 */
export function pullToRefresh(scroller, onRefresh) {
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.innerHTML = '<div class="ptr-ind"><lukas-orb size="40" state="rest"></lukas-orb></div>';
  scroller.prepend(ptr);
  const ind = ptr.firstElementChild;
  const orb = ind.firstElementChild;
  const THRESHOLD = 72, MAX = 118, HOLD = 76;
  let y0 = null, dy = 0, busy = false, fired = false;

  // El contenido baja con el dedo y el personaje queda centrado en el espacio que se abre
  const offset = (d) => MAX * (1 - Math.exp(-d / MAX)); // goma: cuesta más mientras más tiras
  const place = (gap, p) => {
    scroller.classList.add('ptr-active');
    scroller.style.setProperty('--ptr-y', `${gap.toFixed(1)}px`);
    ind.style.opacity = String(Math.min(1, p * 1.6));
    ind.style.transform = `translateY(${(gap / 2 - 20).toFixed(1)}px) scale(${(0.7 + Math.min(1, p) * 0.3).toFixed(3)})`;
  };
  const paint = (d) => {
    const p = Math.min(1, d / THRESHOLD);
    place(offset(d), p);
    orb.setPull?.(Math.min(1.2, d / THRESHOLD));
  };
  const animateTo = (gap, p, ms = 380) => {
    scroller.classList.add('ptr-anim');
    place(gap, p);
    return new Promise((r) => setTimeout(() => { scroller.classList.remove('ptr-anim'); r(); }, ms));
  };
  const reset = async () => {
    orb.setPull?.(0);
    await animateTo(0, 0);
    if (y0 == null && !busy) scroller.classList.remove('ptr-active');
  };

  const start = (e) => { if (!busy && scroller.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; fired = false; } };
  const moveH = (e) => {
    if (y0 == null) return;
    dy = (e.touches[0].clientY - y0) * 0.55;
    if (dy <= 0) { paint(0); return; }
    if (scroller.scrollTop > 0) { y0 = null; reset(); return; }
    paint(dy);
    if (dy > THRESHOLD && !fired) { fired = true; haptic.select(); }
  };
  const end = async () => {
    if (y0 == null) return;
    y0 = null;
    if (dy > THRESHOLD && !busy) {
      busy = true;
      ptr.classList.add('refreshing');
      orb.setPull?.(0);
      orb.think?.();
      animateTo(HOLD, 1, 300);
      const t0 = performance.now();
      let ok = true;
      try { await onRefresh(); } catch (e) { ok = false; console.error(e); }
      const left = 600 - (performance.now() - t0); // procesando dura mínimo 600 ms
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (ok) orb.succeed?.(); else orb.fail?.();
      await new Promise((r) => setTimeout(r, ok ? 1250 : 1400));
      busy = false;
      ptr.classList.remove('refreshing');
      orb.cancel?.();
      reset();
    } else reset();
  };
  scroller.addEventListener('touchstart', start, { passive: true });
  scroller.addEventListener('touchmove', moveH, { passive: true });
  scroller.addEventListener('touchend', end);
  return () => {
    scroller.removeEventListener('touchstart', start);
    scroller.removeEventListener('touchmove', moveH);
    scroller.removeEventListener('touchend', end);
    scroller.style.removeProperty('--ptr-y');
    ptr.remove();
  };
}
