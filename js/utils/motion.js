// Sistema de movimiento: resortes físicos (amortiguación, rigidez, masa) convertidos a easings linear() de CSS,
// duraciones y easing por defecto. Se publican como variables CSS (--spring-snappy, …) para usarlos también en estilos.
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => !!mq?.matches;

export const DURATION = { micro: 120, short: 220, medium: 360, long: 700 };
export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const SPRINGS = {
  snappy: { damping: 18, stiffness: 260, mass: 0.9 },
  gentle: { damping: 20, stiffness: 140, mass: 1 },
  bouncy: { damping: 10, stiffness: 180, mass: 1 },
};

const linearOk = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)');

/** Respuesta al escalón de un resorte (0 → 1), muestreada como easing linear() y su duración hasta asentarse. */
function solve({ damping, stiffness, mass }) {
  const dt = 1 / 600;
  let x = 0, v = 0, t = 0;
  const xs = [];
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    xs.push(x);
    if (t > 0.1 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
  }
  const n = 48;
  const pts = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : xs[Math.floor((i / n) * (xs.length - 1))]).toFixed(4));
  return { easing: linearOk ? `linear(${pts.join(', ')})` : EASE, duration: Math.round(t * 1000) };
}

/** spring.snappy (press), spring.gentle (entradas y layout), spring.bouncy (reacciones de Lukas): { easing, duration } */
export const spring = Object.fromEntries(Object.entries(SPRINGS).map(([k, p]) => [k, solve(p)]));

if (typeof document !== 'undefined') {
  const root = document.documentElement.style;
  for (const [k, s] of Object.entries(spring)) {
    root.setProperty(`--spring-${k}`, s.easing);
    root.setProperty(`--spring-${k}-d`, `${s.duration}ms`);
  }
}

/** Element.animate con salida silenciosa si WAAPI no existe. Con movimiento reducido: fade de 150 ms o nada. */
export function animate(el, keyframes, opts = {}) {
  if (!el?.animate) return null;
  if (reducedMotion()) {
    if (!opts.fadeWhenReduced) return null;
    return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 0, fill: 'backwards' });
  }
  const { fadeWhenReduced, ...o } = opts;
  return el.animate(keyframes, { easing: EASE, ...o });
}
