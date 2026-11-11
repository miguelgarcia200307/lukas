// Capa visual del Inicio: anillo del presupuesto, cifra animada, bordes que se desvanecen en los carruseles,
// encabezado que se compacta al hacer scroll y la coreografía de entrada. Solo presentación: no toca datos ni voz.
import { html } from '../utils/dom.js';
import { money } from '../utils/format.js';
import { spring, DURATION, EASE, reducedMotion, animate } from '../utils/motion.js';

// ── Anillo del presupuesto ──
const SIZE = 236, STROKE = 10, RAD = (SIZE - STROKE) / 2, CIRC = 2 * Math.PI * RAD, MID = SIZE / 2;
let gradId = 0;

/** Tono del día según lo gastado sobre el tope: ok (< 60 %), warn (60–90 %), danger (> 90 %). */
export const budgetTone = (pct) => (pct > 0.9 ? 'danger' : pct >= 0.6 ? 'warn' : 'ok');

export function budgetRing() {
  const id = `br-grad-${++gradId}`;
  return html`<div class="budget-ring" aria-hidden="true">
    <svg viewBox="0 0 ${SIZE} ${SIZE}" focusable="false">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="br-s1"/><stop offset="1" class="br-s2"/></linearGradient></defs>
      <circle class="br-track" cx="${MID}" cy="${MID}" r="${RAD}" fill="none" stroke-width="${STROKE}"/>
      <circle class="br-arc" cx="${MID}" cy="${MID}" r="${RAD}" fill="none" stroke="url(#${id})" stroke-width="${STROKE}"
        stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" transform="rotate(-90 ${MID} ${MID})"/>
      <g class="br-knob"><circle cx="${MID}" cy="${STROKE / 2}" r="${STROKE * 0.3}"/></g>
    </svg>
  </div>`;
}

/** Llena el anillo de `from` a `to` (0…1). Primera vez: 700 ms con 150 ms de espera; cambios: resorte suave. */
export function playRing(host, { from = 0, to = 0, fromTone, tone, first = false }) {
  const ring = host.querySelector('.budget-ring');
  if (!ring) return;
  const arc = ring.querySelector('.br-arc'), knob = ring.querySelector('.br-knob');
  const a = Math.max(0, Math.min(1, from)), b = Math.max(0, Math.min(1, to));
  ring.dataset.tone = fromTone ?? tone;
  arc.style.strokeDashoffset = String(CIRC * (1 - b));
  knob.style.transform = `rotate(${b * 360}deg)`;
  knob.style.opacity = b > 0.004 ? '1' : '0';
  requestAnimationFrame(() => requestAnimationFrame(() => { ring.dataset.tone = tone; }));
  if (reducedMotion() || a === b) return;
  const opts = first ? { duration: DURATION.long, delay: 150, easing: EASE } : { duration: spring.gentle.duration, easing: spring.gentle.easing };
  arc.animate([{ strokeDashoffset: CIRC * (1 - a) }, { strokeDashoffset: CIRC * (1 - b) }], { ...opts, fill: 'backwards' });
  knob.animate([{ transform: `rotate(${a * 360}deg)`, opacity: a > 0.004 ? 1 : 0 }, { transform: `rotate(${b * 360}deg)`, opacity: b > 0.004 ? 1 : 0 }], { ...opts, fill: 'backwards' });
}

// ── Cifra animada (mismo formateador de moneda de la app) ──
export function countTo(node, from, to, { duration = DURATION.long, delay = 0 } = {}) {
  if (!node) return;
  if (reducedMotion() || from === to) { node.textContent = money(to); return; }
  node.textContent = money(from);
  const start = performance.now() + delay;
  const tick = (now) => {
    if (!node.isConnected) return;
    const p = Math.max(0, Math.min(1, (now - start) / duration));
    node.textContent = money(from + (to - from) * (1 - Math.pow(1 - p, 4)));
    if (p < 1) requestAnimationFrame(tick);
    else if (from !== 0) animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: DURATION.medium });
  };
  requestAnimationFrame(tick);
}

// ── Bordes que se desvanecen en scrolls horizontales (.edge-fade): el izquierdo aparece solo tras desplazar ──
export function paintEdges(el) {
  const max = el.scrollWidth - el.clientWidth;
  el.classList.toggle('fade-start', el.scrollLeft > 2);
  el.classList.toggle('fade-end', el.scrollLeft < max - 2);
}
export function edgeFades(root) {
  const f = (e) => { if (e.target.classList?.contains('edge-fade')) paintEdges(e.target); };
  root.addEventListener('scroll', f, { capture: true, passive: true });
  return () => root.removeEventListener('scroll', f, { capture: true });
}

// ── Encabezado grande → barra compacta con desenfoque (como un large title de iOS), interpolado entre 0 y 80 px ──
export function collapsingHeader(screen, scroller) {
  let raf = 0;
  const apply = () => {
    raf = 0;
    const y = Math.max(0, Math.min(80, scroller.scrollTop));
    screen.style.setProperty('--hy', y.toFixed(1));
    screen.classList.toggle('bar-on', y > 48);
  };
  const f = () => { if (!raf) raf = requestAnimationFrame(apply); };
  scroller.addEventListener('scroll', f, { passive: true });
  apply();
  return () => { scroller.removeEventListener('scroll', f); cancelAnimationFrame(raf); };
}

// ── Primera vez en la sesión ──
export function onceThisSession(key) {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch { return false; }
}

// ── Invitación a usar la voz: el pulso del micrófono se calma después del primer uso ──
const VOICE_KEY = 'lukas.voiceUsed';
export function voiceUsed() {
  try { return localStorage.getItem(VOICE_KEY) === '1'; } catch { return false; }
}
export function markVoiceUsed() {
  try { localStorage.setItem(VOICE_KEY, '1'); } catch { /* sin almacenamiento: el pulso sigue siendo solo visual */ }
  document.querySelectorAll('.orb-badge.invite').forEach((b) => b.classList.remove('invite'));
}

// ── Coreografía de entrada ──
export function introHeader(head) {
  if (!head) return;
  const items = head.querySelectorAll(':scope > .grow, :scope > .icon-btn');
  items.forEach((el) => animate(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
    { duration: DURATION.medium, fill: 'backwards', fadeWhenReduced: true }));
}

/** Contenido del Inicio: titular, Lukas (rebote), sugerencias, campo, Próximos y movimientos. Total < 1 s. */
export function introBody(body) {
  if (reducedMotion()) {
    body.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    return;
  }
  const fade = (el, delay, from = 'translateY(8px)', o = {}) => el && animate(el, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
    { duration: DURATION.medium, delay, fill: 'backwards', ...o });
  const $ = (s) => body.querySelector(s);
  fade($('.hero-line'), 0, 'translateY(6px)');
  const orb = $('.orb-body');
  if (orb) animate(orb, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
    { duration: spring.bouncy.duration, easing: spring.bouncy.easing, delay: 70, fill: 'backwards' });
  fade($('.hero-left'), 180);
  fade($('.hero-hint'), 200);
  fade($('.hero-sub'), 220);
  body.querySelectorAll('.hero-suggest .chip').forEach((c, i) => fade(c, 230 + i * 40, 'translateX(12px)'));
  fade($('.home-compose'), 300);
  [...body.querySelectorAll(':scope > :not(.hero)')].forEach((sec, i) => {
    const delay = 340 + i * 90;
    if (sec.querySelector('.upcoming')) {
      fade(sec.querySelector('.section-head'), delay);
      sec.querySelectorAll('.up-card, .up-empty').forEach((c, j) => fade(c, delay + 40 + j * 60, 'translateY(16px)',
        { duration: spring.gentle.duration, easing: spring.gentle.easing }));
    } else fade(sec, delay);
  });
}

/** Lukas reacciona a un movimiento nuevo: salta 10 px con resorte. */
export function hop(orbBody) {
  animate(orbBody, [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)', offset: 0.3 }, { transform: 'translateY(0)' }],
    { duration: spring.bouncy.duration, easing: EASE });
}

/** Campana: dos vaivenes de ±12° si hay notificaciones sin leer. */
export function ringBell(btn) {
  const svg = btn?.querySelector('svg');
  animate(svg, [0, -12, 12, -12, 12, 0].map((d) => ({ transform: `rotate(${d}deg)` })), { duration: 700, delay: 500 });
}
