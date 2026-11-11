// Geometría pura de la cara de Lukas, compartida por el personaje (lukas-orb.js, SVG) y la cara del orbe de voz
// (voice/orb-face.js, canvas). Sin DOM ni objetos nuevos: las funciones llenan arreglos que reciben.
// Unidades del personaje: cuerpo de radio 33, ojos en x ±9.5 / y −5 respecto al centro, boca (moneda) en y +11.

// ── Curvas ────────────────────────────────────────────────
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const spring = (x) => (x <= 0 ? 0 : 1 - Math.exp(-6.5 * x) * Math.cos(8 * x));
export const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

/** Suavizado universal dt-correcto: v += (objetivo − v)·k·min(1, dt·60). `f` = min(1, dt·60). */
export const approach = (v, target, k, f) => v + (target - v) * Math.min(1, k * f);

// ── Ojos ──────────────────────────────────────────────────
// Formas de ojo como 3 puntos relativos (P0, control, P2). Las expresiones interpolan estos puntos.
export const EYE_HAPPY = [-4.6, 2, 0, -5.5, 4.6, 2];
export const EYE_TIRED = [-4, 1, 0, 3, 4, 1];
export const EYE_CLOSED = [-4.2, 0.6, 0, 4.2, 4.2, 0.6]; // párpados cerrados en calma ("‿")

/**
 * Ojo abierto (barra vertical) interpolado con feliz "^", cansado y cerrado "‿".
 * Llena `out` (6 valores: P0, control y P2 relativos al centro del ojo) para un path cuadrático.
 */
export function eyePoints(out, h = 12, open = 1, grow = 1, happy = 0, tired = 0, closed = 0) {
  let s = happy + tired + closed;
  if (s > 1) { happy /= s; tired /= s; closed /= s; s = 1; }
  const wo = 1 - s;
  const c = (h / 2) * (1 - grow); // crece desde abajo (homenaje a las barras del logo anterior)
  const hh = Math.max(0.02, h * grow * open) / 2;
  const o1 = c - hh, o3 = c, o5 = c + hh;
  out[0] = wo * 0 + happy * EYE_HAPPY[0] + tired * EYE_TIRED[0] + closed * EYE_CLOSED[0];
  out[1] = wo * o1 + happy * EYE_HAPPY[1] + tired * EYE_TIRED[1] + closed * EYE_CLOSED[1];
  out[2] = wo * 0 + happy * EYE_HAPPY[2] + tired * EYE_TIRED[2] + closed * EYE_CLOSED[2];
  out[3] = wo * o3 + happy * EYE_HAPPY[3] + tired * EYE_TIRED[3] + closed * EYE_CLOSED[3];
  out[4] = wo * 0 + happy * EYE_HAPPY[4] + tired * EYE_TIRED[4] + closed * EYE_CLOSED[4];
  out[5] = wo * o5 + happy * EYE_HAPPY[5] + tired * EYE_TIRED[5] + closed * EYE_CLOSED[5];
  return out;
}

// ── Boca (la moneda) ──────────────────────────────────────
/** Path cuadrático de la boca: con hw ≈ 0 es un punto perfecto del diámetro del trazo. Llena `out` (6 valores absolutos). */
export function mouthPoints(out, x, y, hw = 0, c = 0) {
  hw = Math.max(0.01, hw);
  out[0] = x - hw; out[1] = y;
  out[2] = x; out[3] = y + c;
  out[4] = x + hw; out[5] = y;
  return out;
}
