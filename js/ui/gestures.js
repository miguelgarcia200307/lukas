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

/**
 * Presionar, mantener y arrastrar (como en iOS/Android): sirve para menú contextual y para reordenar.
 * - Toque corto: no hace nada aquí (lo maneja el click normal).
 * - Mantener `delay` ms sin moverse: onLift(node) (háptico medio, la tarjeta "se levanta").
 *   · Soltar sin mover → onMenu(node).  · Mover → onDragStart(node, y) / onDragMove(node, dy, y) / onDragEnd(node).
 * - Si el dedo se mueve antes de `delay`, es un scroll: se cancela y el navegador hace lo suyo.
 * Con el dedo usa eventos táctiles (para poder frenar el scroll una vez levantada); con mouse, pointer events.
 * Mientras se sostiene, el nodo recibe .pressing; levantado, .lifted. El click que sigue se descarta.
 */
export function enablePressDrag(root, selector, h = {}, { delay = 400, slop = 8, ignore = '' } = {}) {
  let g = null;
  let swallowUntil = 0;
  const pick = (target) => {
    const node = target.closest?.(selector);
    if (!node || !root.contains(node) || (ignore && target.closest(ignore))) return null;
    return node;
  };
  const reset = () => {
    if (!g) return;
    clearTimeout(g.hint); clearTimeout(g.timer);
    g.node.classList.remove('pressing', 'lifted');
    g = null;
  };
  const begin = (node, x, y) => {
    reset();
    g = { node, x0: x, y0: y, lifted: false, dragging: false };
    g.hint = setTimeout(() => g?.node.classList.add('pressing'), 90);
    g.timer = setTimeout(() => {
      if (!g) return;
      g.lifted = true;
      g.node.classList.remove('pressing');
      g.node.classList.add('lifted');
      haptic.start();
      h.onLift?.(g.node);
    }, delay);
  };
  const move = (x, y, e) => {
    if (!g) return;
    const dx = x - g.x0, dy = y - g.y0;
    if (!g.lifted) { if (Math.hypot(dx, dy) > slop) reset(); return; }
    if (e?.cancelable) e.preventDefault();
    if (!g.dragging && Math.hypot(dx, dy) > slop && h.onDragStart) { g.dragging = true; h.onDragStart(g.node, y); }
    if (g.dragging) h.onDragMove?.(g.node, dy, y);
  };
  const end = () => {
    if (!g) return;
    const { node, lifted, dragging } = g;
    reset();
    if (!lifted) return;
    swallowUntil = performance.now() + 600;
    if (dragging) h.onDragEnd?.(node);
    else h.onMenu?.(node);
  };

  const ts = (e) => {
    if (e.touches.length !== 1) { reset(); return; }
    const n = pick(e.target);
    if (n) begin(n, e.touches[0].clientX, e.touches[0].clientY);
  };
  const tm = (e) => {
    if (!g) return;
    if (e.touches.length !== 1) { reset(); return; }
    move(e.touches[0].clientX, e.touches[0].clientY, e);
    if (g?.lifted) e.stopPropagation(); // que el pull-to-refresh no lo tome
  };
  const te = () => end();
  const pd = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const n = pick(e.target);
    if (n) begin(n, e.clientX, e.clientY);
  };
  const pm = (e) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY, e); };
  const pu = (e) => { if (e.pointerType === 'mouse') end(); };
  const click = (e) => {
    if (performance.now() < swallowUntil && pick(e.target)) { e.stopPropagation(); e.preventDefault(); swallowUntil = 0; }
  };
  const ctx = (e) => {
    const n = pick(e.target);
    if (!n) return;
    e.preventDefault();
    if (g?.lifted || performance.now() < swallowUntil) return; // ya lo manejó la pulsación larga
    reset();
    haptic.start();
    h.onMenu?.(n);
  };
  root.addEventListener('touchstart', ts, { passive: true });
  root.addEventListener('touchmove', tm, { passive: false });
  root.addEventListener('touchend', te);
  root.addEventListener('touchcancel', reset);
  root.addEventListener('pointerdown', pd);
  window.addEventListener('pointermove', pm);
  window.addEventListener('pointerup', pu);
  root.addEventListener('click', click, true);
  root.addEventListener('contextmenu', ctx);
  return () => {
    reset();
    root.removeEventListener('touchstart', ts);
    root.removeEventListener('touchmove', tm);
    root.removeEventListener('touchend', te);
    root.removeEventListener('touchcancel', reset);
    root.removeEventListener('pointerdown', pd);
    window.removeEventListener('pointermove', pm);
    window.removeEventListener('pointerup', pu);
    root.removeEventListener('click', click, true);
    root.removeEventListener('contextmenu', ctx);
  };
}

/**
 * Deslizar una fila a ambos lados (vista lista de tarjetas).
 * Cada fila (selector) tiene un .cl-main que se mueve, .cl-acts.left (aparece al deslizar a la derecha) y
 * .cl-acts.right (al deslizar a la izquierda). full(row) se llama con un swipe a la izquierda completo
 * (más del 55 % del ancho). Háptico ligero al cruzar cada umbral. Devuelve la función para quitarlo (con .close()).
 */
export function enableRowSwipe(root, selector, { leftW = 156, rightW = 156, full } = {}) {
  let g = null, open = null;
  const mainOf = (row) => row.querySelector('.cl-main');
  const set = (row, x, animate = true) => {
    row.classList.toggle('swiping', !animate);
    mainOf(row).style.transform = x ? `translate3d(${x}px,0,0)` : '';
    row.querySelector('.cl-acts.left')?.style.setProperty('--ap', x > 0 ? '1' : '0');
    row.querySelector('.cl-acts.right')?.style.setProperty('--ap', x < 0 ? '1' : '0');
    row.classList.toggle('full', x < -row.offsetWidth * 0.55);
  };
  const close = () => { if (open) { set(open.row, 0); open = null; } };
  const down = (e) => {
    if (e.button > 0) return;
    const row = e.target.closest(selector);
    if (!row || !root.contains(row) || e.target.closest('.cl-acts')) return;
    if (open && open.row !== row) close();
    g = { row, x0: e.clientX, y0: e.clientY, base: open?.row === row ? open.x : 0, dx: 0, active: false, id: e.pointerId, crossed: false, full: false };
  };
  const move = (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (g.row.classList.contains('lifted')) { g = null; return; } // está en modo reordenar o menú
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
      if (Math.abs(dx) < 10) return;
      g.active = true;
      try { g.row.setPointerCapture(e.pointerId); } catch { /* nada */ }
    }
    g.dx = dx;
    const w = g.row.offsetWidth;
    let x = g.base + dx;
    if (x > leftW) x = leftW + (x - leftW) / 3;
    if (x < -w) x = -w;
    set(g.row, x, false);
    const crossed = x > leftW * 0.5 || x < -rightW * 0.5;
    const isFull = !!full && x < -w * 0.55;
    if (crossed !== g.crossed || isFull !== g.full) { haptic.select(); g.crossed = crossed; g.full = isFull; }
  };
  const up = () => {
    if (!g) return;
    const { row, base, dx, active } = g;
    g = null;
    if (!active) return;
    const x = base + dx;
    const w = row.offsetWidth;
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    row.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => row.removeEventListener('click', swallow, { capture: true }), 350);
    if (full && x < -w * 0.55) { set(row, 0); open = null; full(row); return; }
    if (x > leftW * 0.4) { set(row, leftW); open = { row, x: leftW }; }
    else if (x < -rightW * 0.4) { set(row, -rightW); open = { row, x: -rightW }; }
    else { set(row, 0); if (open?.row === row) open = null; }
  };
  const click = (e) => {
    if (open && !e.target.closest('.cl-acts')) { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.target.closest('.cl-acts button')) setTimeout(close, 0);
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('click', click, true);
  const off = () => {
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', up);
    root.removeEventListener('click', click, true);
  };
  off.close = close;
  return off;
}
