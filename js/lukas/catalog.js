// Catálogo de accesorios de Lukas: datos + SVG internos y fijos (nunca markup del usuario ni de la base de datos).
// Unidades del personaje: cuerpo de radio 33 centrado en (60, 60), ojos en (50.5, 55) y (69.5, 55), boca en (60, 71).
// Cada pieza es una función (h) => SVG que recibe colores como variables CSS (--acc-1, --acc-2 y sus tonos) y la
// geometría de la silueta (P, along) para que todo se apoye en el contorno real, nunca en coordenadas sueltas.
// Carga diferida: solo se importa si la cuenta tiene accesorios o al abrir el editor.
import { SLOTS, isClassic } from './store.js';

export { SLOTS };
const TAU = Math.PI * 2;
const R0 = 33, CX = 60, CY = 60;
const f = (v) => Math.round(v * 10) / 10;
const pt = (p) => `${f(p[0])} ${f(p[1])}`;
const rad = (d) => (d * Math.PI) / 180;
const sig = (t) => 1 + 0.035 * Math.sin(2 * t + 0.6) + 0.025 * Math.sin(3 * t + 2.1); // misma firma de lukas-orb.js

// ── Geometría de la silueta ───────────────────────────────
/** Punto de la silueta en `deg` (0 = derecha, −90 = arriba) con desplazamiento radial `off` (número o función). */
export function P(deg, off = 0) {
  const t = rad(deg);
  const r = R0 * sig(((t % TAU) + TAU) % TAU) + (typeof off === 'function' ? off(deg) : off);
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}
/** Recorre la silueta de d1 a d2 (grados) como " L x y …". */
export function along(d1, d2, off = 0, step = 4) {
  const n = Math.max(1, Math.ceil(Math.abs(d2 - d1) / step));
  let s = '';
  for (let i = 0; i <= n; i++) s += ` L${pt(P(d1 + ((d2 - d1) * i) / n, off))}`;
  return s;
}
/** Anclajes en el sistema de coordenadas de Lukas. */
export const A = {
  coronilla: P(-90), frente: [60, 38], ojos: [60, 55], entreOjos: [60, 55], ojoIzq: [50.5, 55], ojoDer: [69.5, 55],
  boca: [60, 71], menton: P(90), base: [60, 96], cuello: [60, 84], izq: P(180), der: P(0), espalda: [60, 60],
};

// Espejo horizontal (x → 120 − x) de un path de un solo trazo con comandos absolutos M/L/C/Q/Z, recorrido al revés para
// conservar el sentido (con nonzero, la mitad y su espejo se suman en vez de cancelarse).
function mirrorPath(d, axis = 60) {
  const tok = d.match(/[MLCQZ]|-?\d*\.?\d+/g);
  const segs = [];
  let i = 0, cmd = '', start = null, cur = null;
  const num = () => +tok[i++];
  while (i < tok.length) {
    if (/[MLCQZ]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'Z') break;
    if (cmd === 'M') { start = cur = [num(), num()]; cmd = 'L'; continue; }
    if (cmd === 'L') { const e = [num(), num()]; segs.push({ t: 'L', s: cur, e }); cur = e; }
    else if (cmd === 'C') { const a = [num(), num()], b = [num(), num()], e = [num(), num()]; segs.push({ t: 'C', s: cur, a, b, e }); cur = e; }
    else if (cmd === 'Q') { const a = [num(), num()], e = [num(), num()]; segs.push({ t: 'Q', s: cur, a, e }); cur = e; }
  }
  const m = (p) => `${f(2 * axis - p[0])} ${f(p[1])}`;
  let out = `M${m(cur ?? start)}`;
  for (let k = segs.length - 1; k >= 0; k--) {
    const g = segs[k];
    if (g.t === 'L') out += `L${m(g.s)}`;
    else if (g.t === 'C') out += `C${m(g.b)} ${m(g.a)} ${m(g.s)}`;
    else out += `Q${m(g.a)} ${m(g.s)}`;
  }
  return out + (/Z\s*$/.test(d) ? 'Z' : '');
}
/** Figura simétrica: la mitad izquierda (del centro arriba al centro abajo) + su espejo. */
const sym = (left) => `${left} ${mirrorPath(left)}`;
/** Una figura y su gemela del otro lado (subtrazos separados). */
const twin = (d, axis = 60) => `${d} ${mirrorPath(d, axis)}`;
const circ = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
const ell = (cx, cy, rx, ry) => `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
/** Domo sobre la cabeza: sigue la silueta de d1 a d2 y cierra con el borde frontal curvo (control en y = ctrlY). */
const dome = (off, ctrlY, d1 = -160, d2 = -20) => `M${pt(P(d1, off))}${along(d1, d2, off)} Q60 ${ctrlY} ${pt(P(d1, off))}Z`;
/** Banda curva entre dos bordes frontales (para sombras de contacto y puños). */
const band = (d1, d2, off, c1, c2) => `M${pt(P(d1, off))} Q60 ${c1} ${pt(P(d2, off))} Q60 ${c2} ${pt(P(d1, off))}Z`;
/** Estrella de 4 puntas (brillitos). */
const spark = (x, y, r) => `M${f(x)} ${f(y - r)}Q${f(x + r * 0.18)} ${f(y - r * 0.18)} ${f(x + r)} ${f(y)}Q${f(x + r * 0.18)} ${f(y + r * 0.18)} ${f(x)} ${f(y + r)}Q${f(x - r * 0.18)} ${f(y + r * 0.18)} ${f(x - r)} ${f(y)}Q${f(x - r * 0.18)} ${f(y - r * 0.18)} ${f(x)} ${f(y - r)}Z`;
const star5 = (cx, cy, ro, ri, rot = -90) => {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? ri : ro, a = rad(rot + k * 36);
    d += `${k ? 'L' : 'M'}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }
  return d + 'Z';
};
const heart = (cx, cy, s) => `M${f(cx)} ${f(cy + 9 * s)}C${f(cx - 6.5 * s)} ${f(cy + 5 * s)} ${f(cx - 10 * s)} ${f(cy + 1 * s)} ${f(cx - 10 * s)} ${f(cy - 3.5 * s)}C${f(cx - 10 * s)} ${f(cy - 7 * s)} ${f(cx - 7.5 * s)} ${f(cy - 9 * s)} ${f(cx - 4.8 * s)} ${f(cy - 9 * s)}C${f(cx - 2.5 * s)} ${f(cy - 9 * s)} ${f(cx - 0.9 * s)} ${f(cy - 7.7 * s)} ${f(cx)} ${f(cy - 6 * s)}C${f(cx + 0.9 * s)} ${f(cy - 7.7 * s)} ${f(cx + 2.5 * s)} ${f(cy - 9 * s)} ${f(cx + 4.8 * s)} ${f(cy - 9 * s)}C${f(cx + 7.5 * s)} ${f(cy - 9 * s)} ${f(cx + 10 * s)} ${f(cy - 7 * s)} ${f(cx + 10 * s)} ${f(cy - 3.5 * s)}C${f(cx + 10 * s)} ${f(cy + 1 * s)} ${f(cx + 6.5 * s)} ${f(cy + 5 * s)} ${f(cx)} ${f(cy + 9 * s)}Z`;
// Pseudoaleatorio determinista (texturas iguales en cada render)
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ── Pinceles ──────────────────────────────────────────────
const hl = (x, y, rx, ry, rot = -35, o = 0.38) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff" opacity="${o}" transform="rotate(${rot} ${x} ${y})"/>`;
// Sombra de contacto: índigo profundo con borde suave (degradado) en la zona de apoyo
let shId = 0;
const sh = (d, o = 0.26, dir = 'down') => {
  const id = `lksh${++shId}`;
  const g = dir === 'radial'
    ? `<radialGradient id="${id}"><stop offset="0" stop-color="#1B1250" stop-opacity="${o}"/><stop offset="1" stop-color="#1B1250" stop-opacity="0"/></radialGradient>`
    : dir === 'flat' ? ''
      : `<linearGradient id="${id}" x1="0" y1="${dir === 'up' ? 1 : 0}" x2="0" y2="${dir === 'up' ? 0 : 1}"><stop offset="0" stop-color="#1B1250" stop-opacity="${o}"/><stop offset="1" stop-color="#1B1250" stop-opacity="0"/></linearGradient>`;
  return `${g}<path d="${d}" fill="${dir === 'flat' ? '#1B1250' : `url(#${id})`}"${dir === 'flat' ? ` opacity="${o}"` : ''}/>`;
};
const line = (d, color, w, o = 1, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"${extra}/>`;
const fill = (d, paint, extra = '') => `<path d="${d}" fill="${paint}"${extra}/>`;

// ── Paleta curada (sin morados ni índigos que se confundan con el cuerpo) ──
export const PALETTE = [
  { hex: '#C8F35A', nombre: 'Lima' }, { hex: '#FFD23F', nombre: 'Amarillo' }, { hex: '#F5A524', nombre: 'Naranja' },
  { hex: '#F0997B', nombre: 'Coral' }, { hex: '#E5484D', nombre: 'Rojo' }, { hex: '#FF7EB6', nombre: 'Rosa' },
  { hex: '#3FC59B', nombre: 'Menta' }, { hex: '#2F8F5B', nombre: 'Verde' }, { hex: '#2BB3C0', nombre: 'Turquesa' },
  { hex: '#4AA8FF', nombre: 'Cielo' }, { hex: '#8A5A3B', nombre: 'Café' }, { hex: '#34343A', nombre: 'Carbón' },
];
const PAL = new Set(PALETTE.map((p) => p.hex));
const GOLD = '#F2BE3C', CREAM = '#FAF5E8', INK = '#24242A', PINK = '#FF8FB8';

/** Tonos derivados del color elegido: luz arriba a la izquierda (claro) y sombra abajo a la derecha (oscuro). */
export function shades(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const hsl = (hh, ss, ll) => {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q;
    const c = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return `#${[c(hh + 1 / 3), c(hh), c(hh - 1 / 3)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  return {
    base: hex,
    light: hsl(h - 0.015, Math.min(1, s * 1.02), Math.min(0.94, l + (1 - l) * 0.42)),
    dark: hsl(h + 0.02, Math.min(1, s * 1.05), Math.max(0.07, l * 0.62)),
  };
}

// ── Pelo ──────────────────────────────────────────────────
const scalp = (ctrlY = 30, d1 = -160, d2 = -20, off = 0.6) => dome(off, ctrlY, d1, d2);
const tufts = (h) => fill(twin('M28.4 45.5C26.6 50 27.4 55.5 30.6 58.6C30.4 54.6 31.6 51.6 34.8 49.2C33.2 47.4 31 46 28.4 45.5Z'), h.f1);
const strands = (h, ds) => (h.mini ? '' : ds.map((d) => line(d, h.c1d, 1.1, 0.45)).join(''));

const HAIR = [
  {
    id: 'copete', nombre: 'Copete', art: 'el', icono: '💇', anclaje: 'frente', coloreable: true, colorPorDefecto: '#8A5A3B',
    animacion: 'rebote', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => (h.v === 'bajo' ? tufts(h) : `${fill(scalp(29), h.f1)}<g data-a="rebote" data-o="60 30">${fill('M38 39C34 26 44 12 58 10C70 8 82 12 83 21C83 26 77 28 74 24C72 20 66 19 62 22C56 26 48 33 38 39Z', h.f1)}${h.mini ? '' : line('M47 23C51 16 58 13 66 13', h.c1l, 2.2, 0.75)}</g>${strands(h, ['M40 37C46 31 52 28 58 26'])}`),
    },
    versionMini: true,
  },
  {
    id: 'afro', nombre: 'Rizos afro', art: 'los', icono: '🌀', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#34343A',
    animacion: 'rebote', varianteCon: { cabeza: 'bajo' },
    piezas: {
      atras: (h) => (h.v === 'bajo'
        ? fill(`${circ(25, 50, 9)}${circ(95, 50, 9)}`, h.f1)
        : `<g data-a="rebote" data-o="60 30">${fill([circ(60, 23, 21), circ(38, 29, 16), circ(82, 29, 16), circ(27, 43, 12), circ(93, 43, 12), circ(46, 14, 13), circ(74, 14, 13), circ(60, 11, 13)].join(''), h.f1)}${h.mini ? '' : hl(42, 12, 7, 3.4, -30, 0.22)}</g>`),
      adelante: (h) => (h.v === 'bajo' ? '' : `${fill(scalp(28), h.f1)}${fill([-152, -132, -112, -90, -68, -48, -28].map((a, k) => circ(...P(a, -4), k % 2 ? 6.2 : 6.8)).join(''), h.f1)}${h.mini ? '' : [-142, -100, -58].map((a) => hl(...P(a, -6).map((v) => f(v)), 2, 1.1, -30, 0.25)).join('')}`),
    },
    versionMini: true,
  },
  {
    id: 'mohicana', nombre: 'Cresta mohicana', art: 'la', icono: '🦔', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#E5484D',
    animacion: 'rebote',
    piezas: {
      adelante: (h) => (h.v === 'bajo' ? '' : `<g data-a="rebote" data-o="60 30">${fill('M47 34Q44 24 40 15Q47 18 51 22Q50 13 51 5Q56 11 58 19Q59 9 62 1Q65 10 64 19Q67 11 72 6Q71 14 69 22Q74 18 81 16Q76 25 73 34Z', h.f1, ` stroke="${h.c1}" stroke-width="2" stroke-linejoin="round"`)}${h.mini ? '' : line('M55 26Q57 16 61 8', h.c1l, 1.6, 0.7)}</g>`),
    },
    versionMini: true,
  },
  {
    id: 'flequillo', nombre: 'Flequillo de lado', art: 'el', icono: '💁', anclaje: 'frente', coloreable: true, colorPorDefecto: '#F5A524',
    animacion: 'rebote', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => (h.v === 'bajo'
        ? fill('M29.5 45C28.4 49 28.6 53 29.6 56C32.6 52 36.4 49 41 47C37.6 46.4 33.4 45.6 29.5 45Z', h.f1)
        : `${fill(scalp(30), h.f1)}<g data-a="rebote" data-o="80 32">${fill('M88 34C74 25 50 25 36 35C31 39 28.6 45 29 52C32 47 36 44.5 40 43C38.6 46.5 38.6 49.5 39.4 51.5C43.5 45 51 39.5 60 37C70 34.6 79 35 88 38Z', h.f1)}${h.mini ? '' : line('M80 31C66 28 50 31 40 39', h.c1l, 1.8, 0.6)}</g>`),
    },
    versionMini: true,
  },
  {
    id: 'mono', nombre: 'Moño alto', art: 'el', icono: '🍡', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#8A5A3B',
    animacion: 'rebote', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => (h.v === 'bajo' ? tufts(h) : `${fill(scalp(30), h.f1)}<g data-a="rebote" data-o="60 23">${fill(circ(60, 12.5, 9.6), h.f1)}${h.mini ? '' : line('M55 9.5C58 7 63 7.5 65 11C66 14 63.5 16.5 60.5 15.6', h.c1d, 1.3, 0.55)}${fill('M51.6 20.4Q60 17.6 68.4 20.4L67.6 24Q60 21.8 52.4 24Z', h.f2)}${h.mini ? '' : hl(55.5, 9, 3, 1.6)}</g>${strands(h, ['M44 34C50 29 56 27 60 26', 'M76 34C70 29 64 27 60 26'])}`),
    },
    color2: '#FF7EB6',
    versionMini: true,
  },
  {
    id: 'despeinado', nombre: 'Recién levantado', art: 'el', icono: '🛌', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#F5A524',
    animacion: 'resorte', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => (h.v === 'bajo'
        ? fill(twin('M28 46Q21 47 19 43Q24 50 28.6 54.5Q27.6 50 30.8 47.4Z'), h.f1)
        : `${fill(`${scalp(31)}M38 33Q30 22 33 14Q38 22 44 27Q42 15 48 8Q50 18 54 24Q57 15 62 12Q62 19 63 25Q70 16 79 16Q73 22 72 28Q80 26 87 31Q80 34 76 36Z`, h.f1)}<g data-a="resorte" data-o="62 25">${fill('M58.5 25Q59 13 68 5Q66 15 65.5 25Z', h.f1)}</g>`),
    },
    versionMini: true,
  },
  {
    id: 'tupe', nombre: 'Tupé rockero', art: 'el', icono: '🎸', anclaje: 'frente', coloreable: true, colorPorDefecto: '#34343A',
    animacion: 'rebote', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => {
        const burns = fill(twin('M28.6 44C27.8 50 28.4 56 30 61C31.6 61.2 33.2 60.4 34.2 58.6C33.2 53.4 32.8 48.4 33.4 43.2Z'), h.f1);
        if (h.v === 'bajo') return burns;
        return `${fill(scalp(32), h.f1)}${burns}<g data-a="rebote" data-o="60 32">${fill('M33 40C26 24 38 6 60 5C80 4 95 16 88 33C84 26 74 21 62 22C50 23 40 30 33 40Z', h.f1)}${h.mini ? '' : `${line('M40 26C46 15 58 10 72 11', h.c1l, 2.2, 0.7)}${line('M44 32C50 24 60 20 72 20', h.c1d, 1.2, 0.5)}`}</g>`;
      },
    },
    versionMini: true,
  },
  {
    id: 'punk', nombre: 'Puntas punk', art: 'las', icono: '⚡', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#FF7EB6',
    animacion: 'resorte', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => {
        const spikes = (angles, len) => angles.map((a) => `M${pt(P(a - 7, -1))}L${pt(P(a, len))}L${pt(P(a + 7, -1))}Z`).join('');
        if (h.v === 'bajo') return fill(spikes([-172, -160, -20, -8], 7), h.f1, ` stroke="${h.c1}" stroke-width="2" stroke-linejoin="round"`);
        return `${fill(scalp(31), h.f1)}${fill(spikes([-160, -142, -124, -106, -90, -74, -56, -38, -20], 12), h.f1, ` stroke="${h.c1}" stroke-width="2.4" stroke-linejoin="round"`)}${h.mini ? '' : `<g data-a="resorte" data-o="${pt(P(-90, 0))}">${fill(`M${pt(P(-96, 6))}L${pt(P(-90, 17))}L${pt(P(-84, 6))}Z`, h.f1, ` stroke="${h.c1}" stroke-width="2.2" stroke-linejoin="round"`)}</g>`}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'coletas', nombre: 'Coletas', art: 'las', icono: '🎀', anclaje: 'izq', coloreable: true, colorPorDefecto: '#F5A524',
    animacion: 'resorte', varianteCon: { cabeza: 'bajo' }, color2: '#3FC59B',
    piezas: {
      atras: (h) => `<g data-a="resorte" data-o="30 40">${fill('M31 38C18 33 9 44 11 57C12.4 65 17 70.6 21.4 72.6C20.6 64.4 21.8 56.4 26.8 50.4C30 46.4 32.6 42 31 38Z', h.f1)}</g><g data-a="resorte" data-o="90 40" data-p="1.7">${fill(mirrorPath('M31 38C18 33 9 44 11 57C12.4 65 17 70.6 21.4 72.6C20.6 64.4 21.8 56.4 26.8 50.4C30 46.4 32.6 42 31 38Z'), h.f1)}</g>`,
      adelante: (h) => `${h.v === 'bajo' ? '' : fill(scalp(30), h.f1)}${fill(`${circ(30.6, 40.6, 3.4)}${circ(89.4, 40.6, 3.4)}`, h.f2)}`,
    },
    versionMini: true,
  },
  {
    id: 'raya', nombre: 'Raya al lado', art: 'la', icono: '🪮', anclaje: 'frente', coloreable: true, colorPorDefecto: '#34343A',
    animacion: 'rebote', varianteCon: { cabeza: 'bajo' },
    piezas: {
      adelante: (h) => (h.v === 'bajo' ? tufts(h) : `${fill(scalp(32), h.f1)}<g data-a="rebote" data-o="66 30">${fill('M44 30C52 23 71 21 85 29C87 32.6 88.4 36 89 40C81 34 67 31.6 53 34.6C49 35.4 45.4 36.6 42 38.6Z', h.f1)}</g>${h.mini ? '' : `${line('M44.6 28.6C43.4 32 42.4 35 41.6 38.6', h.c1d, 1.4, 0.7)}${line('M54 27.4C64 24.6 74 26 82 30.6', h.c1l, 1.8, 0.6)}`}`),
    },
    versionMini: true,
  },
];

// ── Cabeza ────────────────────────────────────────────────
const capOff = (a) => 2 + 3.6 * Math.pow(Math.max(0, -Math.sin(rad(a))), 3);
const capDome = (ctrlY = 32) => `M${pt(P(-160, capOff))}${along(-160, -20, capOff)} Q60 ${ctrlY} ${pt(P(-160, capOff))}Z`;
const brimShadow = (y1 = 38, y2 = 47) => sh(band(-158, -22, 0, y1, y2 + 2), 0.3);
const COVERS = ['cabello'];

const HEAD = [
  {
    id: 'gorra', nombre: 'Gorra', art: 'la', icono: '🧢', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#E5484D', color2: '#FAF5E8',
    ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(39, 48),
      adelante: (h) => `${fill(capDome(32), h.f1)}${h.mini ? '' : `${line('M60 23Q49 28 43 40', h.c1d, 1, 0.4)}${line('M60 23Q71 28 77 40', h.c1d, 1, 0.4)}${hl(45, 30, 6.5, 3.2)}`}${fill(circ(60, 21.8, 2.3), h.c1d)}${fill('M33 40C43 46 77 46 87 40C76 42.4 44 42.4 33 40Z', h.c1d)}${h.mini ? '' : fill('M54 31.6Q60 29.6 66 31.6L65.4 35.4Q60 33.8 54.6 35.4Z', h.f2)}`,
    },
    versionMini: true,
  },
  {
    id: 'gorra-reves', nombre: 'Gorra al revés', art: 'la', icono: '🔄', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#2BB3C0', color2: '#FAF5E8',
    ocultaSlots: COVERS,
    piezas: {
      atras: (h) => fill('M46 21C37 15.6 25 15 17 19.6C14.6 21 15 24.4 18 24.6C26 24.4 35 26 42 30Z', h.c1d),
      sombra: () => brimShadow(38, 46),
      adelante: (h) => `${fill(capDome(32), h.f1)}${h.mini ? '' : `${line('M60 23Q49 28 43 40', h.c1d, 1, 0.4)}${line('M60 23Q71 28 77 40', h.c1d, 1, 0.4)}${hl(44, 30, 6, 3)}`}${fill(circ(60, 21.8, 2.3), h.c1d)}${fill('M51.6 40.4Q60 30.6 68.4 40.4Q60 38.8 51.6 40.4Z', h.c1d)}${h.mini ? '' : line('M53.6 35.8L66.4 35.8', h.c2, 1.8)}`,
    },
    versionMini: true,
  },
  {
    id: 'helice', nombre: 'Gorra con hélice', art: 'la', icono: '🚁', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#FFD23F', color2: '#E5484D',
    animacion: 'helice', ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(39, 47),
      adelante: (h) => `${fill(capDome(32), h.f1)}${fill(twin('M60 22.4Q45 25 39.6 40.8Q46.4 40.4 51.6 39.8Q53.6 29.6 60 22.4Z'), h.f2)}${fill('M35 40.4C44 45.4 76 45.4 85 40.4C75 42.6 45 42.6 35 40.4Z', h.c1d)}${fill('M58.8 14L61.2 14L61.6 22.6L58.4 22.6Z', INK)}<g data-a="helice" data-o="60 13.5">${fill(ell(51.6, 13.5, 8.4, 2.5), h.f2)}${fill(ell(68.4, 13.5, 8.4, 2.5), h.f1)}</g>${fill(circ(60, 13.5, 2), INK)}${h.mini ? '' : hl(45, 31, 5.5, 2.8)}`,
    },
    versionMini: true,
  },
  {
    id: 'vueltiao', nombre: 'Sombrero vueltiao', art: 'el', icono: '🇨🇴', anclaje: 'coronilla', coloreable: false, colorPorDefecto: '#F2E6C9', color2: '#2A2420',
    ocultaSlots: COVERS,
    piezas: {
      atras: (h) => `${fill(ell(60, 33, 47, 9), h.f1)}${h.mini ? '' : `<ellipse cx="60" cy="33" rx="40" ry="7.4" fill="none" stroke="${h.c2}" stroke-width="1.4"/><ellipse cx="60" cy="33" rx="33" ry="6" fill="none" stroke="${h.c2}" stroke-width="1.2"/>`}`,
      sombra: () => brimShadow(40, 49),
      adelante: (h) => `${fill('M38.4 34C37.4 22 41 11.6 50 9.4C56 8.2 64 8.2 70 9.4C79 11.6 82.6 22 81.6 34Z', h.f1)}${fill('M39.2 26.6Q60 23.6 80.8 26.6L81.4 31.4Q60 28.4 38.6 31.4Z', h.c2)}${h.mini ? '' : `${fill('M41.6 16.8Q60 13.4 78.4 16.8L79.4 20.4Q60 17 40.6 20.4Z', h.c2)}${line('M40.4 23.4L43.4 21.6L46.4 23.4L49.4 21.6L52.4 23.4L55.4 21.6L58.4 23.4L61.4 21.6L64.4 23.4L67.4 21.6L70.4 23.4L73.4 21.6L76.4 23.4L79.4 21.6', h.c2, 1.1)}${hl(47, 15, 4.5, 2.2, -20, 0.45)}`}${fill('M13 33A47 9 0 0 0 107 33A47 5.2 0 0 1 13 33Z', h.f1)}${h.mini ? '' : `${line('M19.6 36.2A41 6.8 0 0 0 100.4 36.2', h.c2, 1.3)}${line('M27 38.4A34 5.4 0 0 0 93 38.4', h.c2, 1.1)}`}`,
    },
    versionMini: true,
  },
  {
    id: 'vaquero', nombre: 'Sombrero vaquero', art: 'el', icono: '🤠', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#8A5A3B', color2: '#34343A',
    ocultaSlots: COVERS,
    piezas: {
      atras: (h) => fill('M14 25C20 33 40 31 60 31C80 31 100 33 106 25C100 29 86 28.4 60 28.4C34 28.4 20 29 14 25Z', h.c1d),
      sombra: () => brimShadow(40, 48),
      adelante: (h) => `${fill('M40 34C38 24 40 14 46 10.6C51 12.6 55.4 14.6 60 12.8C64.6 14.6 69 12.6 74 10.6C80 14 82 24 80 34Z', h.f1)}${h.mini ? '' : line('M60 13.6Q58.6 20 60 25', h.c1d, 1.2, 0.6)}${fill('M40.6 27.4Q60 25.4 79.4 27.4L79.8 32.6Q60 30.6 40.2 32.6Z', h.f2)}${fill('M16 27C24 40 44 41 60 41C76 41 96 40 104 27C96 34 80 36.4 60 36.4C40 36.4 24 34 16 27Z', h.f1)}${h.mini ? '' : hl(47, 18, 3.8, 2, -25)}`,
    },
    versionMini: true,
  },
  {
    id: 'copa', nombre: 'Sombrero de copa', art: 'el', icono: '🎩', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#34343A', color2: '#E5484D',
    ocultaSlots: COVERS,
    piezas: {
      atras: (h) => fill(ell(60, 33, 30, 5.6), h.c1d),
      sombra: () => brimShadow(39, 46),
      adelante: (h) => `${fill('M43 33L44 6C44 3.4 46 2 49 2L71 2C74 2 76 3.4 76 6L77 33Z', h.f1)}${fill('M43.3 25L76.7 25L77 31.4L43 31.4Z', h.f2)}${fill(ell(60, 2.8, 15.6, 2.6), h.c1l, ' opacity=".35"')}${fill('M30 33A30 5.6 0 0 0 90 33A30 2.8 0 0 1 30 33Z', h.f1)}${h.mini ? '' : hl(49.5, 10, 2.2, 6, 0, 0.3)}`,
    },
    versionMini: true,
  },
  {
    id: 'boina', nombre: 'Boina', art: 'la', icono: '🎨', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#E5484D',
    ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(37, 44),
      adelante: (h) => `${fill('M28 36C21 30 28 17.6 46 14.6C62 12 84 14 92.6 22C96.6 27 93 33 86 35.2C70 33 46 34 28 36Z', h.f1)}${fill('M57.6 15.4Q58.6 9 63.4 8Q62.2 12 62.4 15Z', h.c1d)}${line('M30 37.2Q60 30.4 90 36.4', h.c1d, 3)}${h.mini ? '' : hl(44, 19.6, 7, 2.6, -12)}`,
    },
    versionMini: true,
  },
  {
    id: 'lana', nombre: 'Gorro de lana', art: 'el', icono: '🧶', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#2BB3C0', color2: '#FAF5E8',
    animacion: 'resorte', ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(39, 48),
      adelante: (h) => {
        const off = (a) => 2.6 + 2.4 * Math.pow(Math.max(0, -Math.sin(rad(a))), 2);
        const body = `M${pt(P(-162, off))}${along(-162, -18, off)} Q60 33 ${pt(P(-162, off))}Z`;
        const cuff = `M${pt(P(-162, 3))} Q60 33 ${pt(P(-18, 3))} L${pt(P(-24, 3.4))} Q60 25 ${pt(P(-156, 3.4))}Z`;
        const ribs = h.mini ? '' : [36, 42, 48, 54, 60, 66, 72, 78, 84].map((x) => line(`M${x} ${f(31.4 + Math.abs(x - 60) * 0.12)}L${x} ${f(37.6 + Math.abs(x - 60) * 0.1)}`, h.c1d, 1, 0.45)).join('');
        const knit = h.mini ? '' : [[46, 26], [60, 22], [74, 26]].map(([x, y]) => line(`M${x - 3} ${y - 2}L${x} ${y + 1}L${x + 3} ${y - 2}`, h.c1d, 1, 0.35)).join('');
        return `${fill(body, h.f1)}${knit}${fill(cuff, h.c1d)}${fill(cuff, h.f1, ' opacity=".55"')}${ribs}<g data-a="resorte" data-o="60 23">${fill([circ(60, 16, 6.6), circ(55, 18.6, 4), circ(65, 18.6, 4), circ(57, 12, 4), circ(63, 12, 4)].join(''), h.f2)}${h.mini ? '' : hl(56.6, 13.4, 2.6, 1.6)}</g>`;
      },
    },
    versionMini: true,
  },
  {
    id: 'pescador', nombre: 'Sombrero de pescador', art: 'el', icono: '🎣', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#2F8F5B',
    ocultaSlots: COVERS,
    piezas: {
      atras: (h) => fill('M27 36C33 28.4 87 28.4 93 36Z', h.c1d),
      sombra: () => brimShadow(41, 49),
      adelante: (h) => `${fill('M40 34C40 24 44 15 52 13C57 12 63 12 68 13C76 15 80 24 80 34Z', h.f1)}${fill('M26 37C30 33 90 33 94 37C96 41 92 44 86 44C72 41.4 48 41.4 34 44C28 44 24 41 26 37Z', h.f1)}${h.mini ? '' : `${line('M31 39.4C44 36.4 76 36.4 89 39.4', h.c1d, 0.9, 0.55, ' stroke-dasharray="1.6 1.6"')}${line('M41.4 28.6Q60 25.6 78.6 28.6', h.c1d, 0.9, 0.55, ' stroke-dasharray="1.6 1.6"')}${hl(48, 18, 4, 2, -20)}`}`,
    },
    versionMini: true,
  },
  {
    id: 'casco', nombre: 'Casco de construcción', art: 'el', icono: '👷', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#FFD23F',
    ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(40, 48),
      adelante: (h) => `${fill('M30 36C29 20 43 9 60 9C77 9 91 20 90 36Z', h.f1)}${fill('M55.6 9.6Q60 6.6 64.4 9.6L64.4 35L55.6 35Z', h.c1l, ' opacity=".7"')}${fill('M24 37C24 34 96 34 96 37C96 40 90 41.6 60 41.6C30 41.6 24 40 24 37Z', h.f1)}${fill('M24 37C24 34 96 34 96 37C96 38 95 38.6 93 39C80 37.4 40 37.4 27 39C25 38.6 24 38 24 37Z', h.c1d, ' opacity=".55"')}${h.mini ? '' : hl(41, 19, 5, 2.6, -40)}`,
    },
    versionMini: true,
  },
  {
    id: 'corona', nombre: 'Corona', art: 'la', icono: '👑', anclaje: 'coronilla', coloreable: false, colorPorDefecto: GOLD, color2: '#E5484D',
    animacion: 'brillitos',
    piezas: {
      sombra: () => sh(band(-124, -56, 0, 32, 36), 0.22),
      adelante: (h) => {
        const L = P(-122, 1), R = P(-58, 1);
        const d = `M${pt(L)}L39.6 14L49 21.6L53.6 9.6L60 18.6L66.4 10L71.4 22.6L80.4 16L${pt(R)}${along(-58, -122, 1)}Z`;
        const tips = h.mini ? '' : fill([circ(39.6, 13.6, 2), circ(53.6, 9.2, 2), circ(66.4, 9.6, 2), circ(80.4, 15.6, 2)].join(''), h.f1);
        const gems = `${fill(circ(60, 25.2, 2.3), h.c2)}${h.mini ? '' : fill(`${circ(49.6, 26.6, 1.6)}${circ(70.6, 27.4, 1.6)}`, '#2BB3C0')}`;
        const twinkles = h.mini ? '' : [[34, 10, 0], [86, 9, 1.3], [61, 3, 2.4]].map(([x, y, p]) => `<g data-a="brillitos" data-o="${x} ${y}" data-p="${p}">${fill(spark(x, y, 3), '#fff')}</g>`).join('');
        return `${fill(d, h.f1, ` stroke="${h.c1}" stroke-width="1.6" stroke-linejoin="round"`)}${tips}${gems}${h.mini ? '' : hl(46, 22, 2.4, 1.2, -30, 0.5)}${twinkles}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'fiesta', nombre: 'Gorro de fiesta', art: 'el', icono: '🎉', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#2BB3C0', color2: '#FFD23F',
    animacion: 'resorte',
    piezas: {
      sombra: () => sh(band(-116, -64, 0, 32, 35.4), 0.22),
      adelante: (h) => {
        const L = P(-114, 0.6), R = P(-66, 0.6);
        return `${fill(`M${pt(L)}Q60 9 63 3.2Q66 9 ${pt(R)}${along(-66, -114, 0.6)}Z`, h.f1)}${h.mini ? '' : fill([circ(57, 23, 2), circ(66.6, 22.4, 1.7), circ(62, 14, 1.5), circ(52, 27.6, 1.4), circ(70.6, 28.6, 1.4)].join(''), h.f2)}<g data-a="resorte" data-o="63 5">${fill([circ(63, 2, 3.4), circ(60.4, 0, 2), circ(65.6, 0, 2)].join(''), h.f2)}</g>`;
      },
    },
    versionMini: true,
  },
  {
    id: 'chef', nombre: 'Gorro de chef', art: 'el', icono: '👨‍🍳', anclaje: 'coronilla', coloreable: false, colorPorDefecto: '#FAF8F2',
    ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(38, 45),
      adelante: (h) => `${fill([circ(44, 19, 9), circ(56, 12, 10), circ(68, 13, 9.6), circ(77, 20.6, 8), circ(60, 20, 9)].join(''), h.f1)}${fill('M38 26.6Q60 22.6 82 26.6L82 34.4Q60 38.4 38 34.4Z', h.f1)}${h.mini ? '' : `${[46, 53, 60, 67, 74].map((x) => line(`M${x} 26.8L${x} 34.6`, h.c1d, 1, 0.4)).join('')}${hl(49, 10, 4, 2.2)}`}`,
    },
    versionMini: true,
  },
  {
    id: 'mago', nombre: 'Gorro de mago', art: 'el', icono: '🪄', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#4AA8FF', color2: '#FFD23F',
    animacion: 'brillitos', ocultaSlots: COVERS,
    piezas: {
      atras: (h) => fill(ell(60, 33, 36, 6.6), h.c1d),
      sombra: () => brimShadow(40, 47),
      adelante: (h) => `${fill('M40 33C44 22 48 10 52 0C55 -6 62 -9 70 -6C65 -5 61 -2 59 3C62 12 72 24 80 33Z', h.f1)}${fill('M24 33A36 6.6 0 0 0 96 33A36 3.4 0 0 1 24 33Z', h.f1)}${h.mini ? '' : [[54, 22, 3, 0], [66, 14, 2.4, 1.1], [58, 8, 1.8, 2.2]].map(([x, y, r, p]) => `<g data-a="brillitos" data-o="${x} ${y}" data-p="${p}">${fill(star5(x, y, r, r * 0.45), h.c2)}</g>`).join('')}${h.mini ? '' : fill('M68 27A4 4 0 1 1 68 19A3 3 0 1 0 68 27Z', h.c2)}`,
    },
    versionMini: true,
  },
  {
    id: 'gato', nombre: 'Diadema de gato', art: 'la', icono: '🐱', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#34343A', color2: '#FF9EC0',
    animacion: 'resorte',
    piezas: {
      adelante: (h) => {
        const ear = (a, o) => {
          const b1 = P(a - 12, 0.4), b2 = P(a + 12, 0.4), t = P(a, 15);
          const i1 = P(a - 7, 2), i2 = P(a + 7, 2), it = P(a, 11.5);
          return `<g data-a="resorte" data-o="${pt(P(a, 0))}" data-p="${o}">${fill(`M${pt(b1)}Q${pt(P(a - 4, 14))} ${pt(t)}Q${pt(P(a + 4, 14))} ${pt(b2)}Z`, h.f1)}${h.mini ? '' : fill(`M${pt(i1)}Q${pt(P(a - 2.4, 10))} ${pt(it)}Q${pt(P(a + 2.4, 10))} ${pt(i2)}Z`, h.c2)}</g>`;
        };
        return `<path d="M${pt(P(-158, 0.6))}${along(-158, -22, 0.6)}" fill="none" stroke="${h.c1}" stroke-width="3.2" stroke-linecap="round"/>${ear(-126, 0)}${ear(-54, 1.4)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'antenas', nombre: 'Antenitas', art: 'las', icono: '🐝', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#C8F35A',
    animacion: 'resorte',
    piezas: {
      adelante: (h) => {
        const ant = (a, tip, p) => {
          const b = P(a, 0.4);
          let d = `M${pt(b)}`;
          for (let k = 1; k <= 12; k++) {
            const t = k / 12, x = b[0] + (tip[0] - b[0]) * t, y = b[1] + (tip[1] - b[1]) * t;
            const w = k === 12 ? 0 : (k % 2 ? 2.2 : -2.2);
            d += `L${f(x + w)} ${f(y)}`;
          }
          return `<g data-a="resorte" data-o="${pt(b)}" data-p="${p}">${line(d, INK, 1.3)}${fill(circ(tip[0], tip[1] - 3, 4.2), h.f1)}${h.mini ? '' : hl(tip[0] - 1.4, tip[1] - 4.6, 1.5, 1)}</g>`;
        };
        return `<path d="M${pt(P(-158, 0.6))}${along(-158, -22, 0.6)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${ant(-112, [45, 7], 0)}${ant(-68, [75, 7], 1.2)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'navideno', nombre: 'Gorro navideño', art: 'el', icono: '🎅', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#E5484D', color2: '#FAF8F2',
    animacion: 'resorte', ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(39, 47),
      adelante: (h) => {
        const fur = `M${pt(P(-164, 3))} Q60 32 ${pt(P(-16, 3))} L${pt(P(-22, 3.6))} Q60 23.6 ${pt(P(-158, 3.6))}Z`;
        return `${fill('M27.6 44C26 28 38 11 60 9C76 7.6 90 14 98 26C101 31 101.6 36 100 40C95 33 89 28.6 81 27C87 31 91 37.6 92.6 44Z', h.f1)}${h.mini ? '' : hl(45, 20, 6, 2.8, -35)}${fill(fur, h.f2, ` stroke="${h.c2}" stroke-width="2.6" stroke-linejoin="round"`)}<g data-a="resorte" data-o="94 30">${fill([circ(99.6, 42, 5), circ(96.6, 39.6, 3), circ(102.6, 39.6, 3)].join(''), h.f2)}</g>`;
      },
    },
    versionMini: true,
  },
  {
    id: 'pirata', nombre: 'Sombrero de pirata', art: 'el', icono: '🏴‍☠️', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#34343A', color2: GOLD,
    ocultaSlots: COVERS,
    piezas: {
      sombra: () => brimShadow(36, 44),
      adelante: (h) => `${fill(dome(1.4, 36, -150, -30), h.c1d)}${fill('M20 35C24 18 40 12 60 12C80 12 96 18 100 35C92 30 78 29 60 29C42 29 28 30 20 35Z', h.f1)}${line('M21.4 33.6C29 29.6 42 28.4 60 28.4C78 28.4 91 29.6 98.6 33.6', h.c2, 1.6)}${h.mini ? fill(circ(60, 20.6, 3.6), CREAM) : `${line('M54 26.4L66 18.6M54 18.6L66 26.4', CREAM, 1.8)}${fill('M55.6 20.4C55.6 17.4 57.6 15.6 60 15.6C62.4 15.6 64.4 17.4 64.4 20.4C64.4 22 63.6 23 62.6 23.4L62.6 24.6L57.4 24.6L57.4 23.4C56.4 23 55.6 22 55.6 20.4Z', CREAM)}${fill(`${circ(58.2, 20.4, 1.1)}${circ(61.8, 20.4, 1.1)}`, INK)}${hl(40, 20, 6, 2, -20, 0.22)}`}`,
    },
    versionMini: true,
  },
  {
    id: 'aureola', nombre: 'Aureola', art: 'la', icono: '😇', anclaje: 'coronilla', coloreable: false, colorPorDefecto: GOLD,
    animacion: 'levitar',
    piezas: {
      adelante: (h) => `<g data-a="levitar" data-o="60 12">${h.mini ? '' : '<ellipse cx="60" cy="12" rx="17" ry="4.6" fill="none" stroke="#FFE9A8" stroke-width="6" opacity=".35"/>'}<ellipse cx="60" cy="12" rx="17" ry="4.6" fill="none" stroke="${h.c1}" stroke-width="3"/>${h.mini ? '' : '<ellipse cx="54" cy="8.6" rx="5" ry="1" fill="#fff" opacity=".6"/>'}</g>`,
    },
    versionMini: true,
  },
];

// ── Gafas (marco de la cara) ──────────────────────────────
const L = [50.5, 55], RR = [69.5, 55];
const lensGlint = (h, d) => (h.mini ? '' : `<clipPath id="${h.id}gl"><path d="${d}"/></clipPath><g clip-path="url(#${h.id}gl)"><g data-a="destello" data-o="60 55"><path d="M36 70L42 40L46 40L40 70ZM44 70L50 40L51.6 40L45.6 70Z" fill="#fff" opacity=".6"/></g></g>`);
const temples = (color, w = 1.8, y = 53.4, x0 = 41.4) => line(`M${x0} ${y}L28.4 ${y - 1.6}M${120 - x0} ${y}L91.6 ${y - 1.6}`, color, w);
const glassShadow = (d) => `<g transform="translate(0.6 1.6)">${sh(d, 0.14, 'flat')}</g>`;
const roundLens = `${circ(L[0], L[1], 9.3)}${circ(RR[0], RR[1], 9.3)}`;

const GLASSES = [
  {
    id: 'redondas', nombre: 'Gafas redondas', art: 'las', icono: '👓', anclaje: 'ojos', coloreable: true, colorPorDefecto: '#34343A',
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow(`${circ(L[0], L[1], 9.6)}${circ(RR[0], RR[1], 9.6)}`),
      adelante: (h) => `${fill(roundLens, '#fff', ' opacity=".13"')}${lensGlint(h, roundLens)}${`<path d="${roundLens}" fill="none" stroke="${h.c1}" stroke-width="2.1"/>`}${line('M58.6 52.4Q60 50.4 61.4 52.4', h.c1, 1.8)}${temples(h.c1)}`,
    },
    versionMini: true,
  },
  {
    id: 'cuadradas', nombre: 'Gafas cuadradas', art: 'las', icono: '🤓', anclaje: 'ojos', coloreable: true, colorPorDefecto: '#34343A',
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow('M41.6 45H59.4V65H41.6ZM60.6 45H78.4V65H60.6Z'),
      adelante: (h) => {
        const d = 'M45 45H56C58 45 59.4 46.4 59.4 48.4V61.6C59.4 63.6 58 65 56 65H45C43 65 41.6 63.6 41.6 61.6V48.4C41.6 46.4 43 45 45 45ZM64 45H75C77 45 78.4 46.4 78.4 48.4V61.6C78.4 63.6 77 65 75 65H64C62 65 60.6 63.6 60.6 61.6V48.4C60.6 46.4 62 45 64 45Z';
        return `${fill(d, '#fff', ' opacity=".13"')}${lensGlint(h, d)}<path d="${d}" fill="none" stroke="${h.c1}" stroke-width="2.8"/>${fill('M57.8 49.4H62.2V55.6H57.8Z', CREAM)}${h.mini ? '' : line('M58.6 51.2H61.4M58.6 53.8H61.4', '#C9C2B0', 0.7)}${temples(h.c1, 2.2, 52, 41.6)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'aviador', nombre: 'Gafas de aviador', art: 'las', icono: '🕶️', anclaje: 'ojos', coloreable: true, colorPorDefecto: '#34343A', color2: '#D9B45A',
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow(twin('M41 49.5C41 46.5 44 46 50.5 46C57 46 60 46.5 59.5 49.5C59 56 56 64.5 50 64.5C45 64.5 41 57 41 49.5Z')),
      adelante: (h) => {
        const d = twin('M41 49.5C41 46.5 44 46 50.5 46C57 46 60 46.5 59.5 49.5C59 56 56 64.5 50 64.5C45 64.5 41 57 41 49.5Z');
        return `${fill(d, h.f1, ' opacity=".42"')}${lensGlint(h, d)}<path d="${d}" fill="none" stroke="${h.c2}" stroke-width="1.4"/>${line('M43.4 46.2Q60 44.4 76.6 46.2', h.c2, 1.2)}${line('M59.2 48.6Q60 47.8 60.8 48.6', h.c2, 1.2)}${temples(h.c2, 1.4, 50, 41.2)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'corazon', nombre: 'Gafas de corazón', art: 'las', icono: '💖', anclaje: 'ojos', coloreable: true, colorPorDefecto: '#FF7EB6',
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow(`${heart(L[0], 55.4, 1.02)}${heart(RR[0], 55.4, 1.02)}`),
      adelante: (h) => {
        const d = `${heart(L[0], 55.4, 1)}${heart(RR[0], 55.4, 1)}`;
        return `${fill(d, h.f1, ' opacity=".3"')}${lensGlint(h, d)}<path d="${d}" fill="none" stroke="${h.c1}" stroke-width="2.2" stroke-linejoin="round"/>${line('M59.6 50.6Q60 49.6 60.4 50.6', h.c1, 1.6)}${temples(h.c1, 1.8, 51.6, 40.6)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'estrella', nombre: 'Gafas de estrella', art: 'las', icono: '⭐', anclaje: 'ojos', coloreable: true, colorPorDefecto: '#FFD23F',
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow(`${star5(L[0], 55.6, 10.4, 5.8)}${star5(RR[0], 55.6, 10.4, 5.8)}`),
      adelante: (h) => {
        const d = `${star5(L[0], 55.6, 10.2, 5.8)}${star5(RR[0], 55.6, 10.2, 5.8)}`;
        return `${fill(d, h.f1, ' opacity=".28"')}${lensGlint(h, d)}<path d="${d}" fill="none" stroke="${h.c1}" stroke-width="2" stroke-linejoin="round"/>${temples(h.c1, 1.8, 52.4, 40.6)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'tresd', nombre: 'Gafas 3D', art: 'las', icono: '🎬', anclaje: 'ojos', coloreable: false, colorPorDefecto: '#FAF8F2',
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow('M38 46H82V64H38Z'),
      adelante: (h) => `${fill('M40.4 47.4H58.8V62.6H40.4Z', '#E5484D', ' opacity=".45"')}${fill('M61.2 47.4H79.6V62.6H61.2Z', '#2BB3C0', ' opacity=".45"')}${lensGlint(h, 'M40.4 47.4H58.8V62.6H40.4ZM61.2 47.4H79.6V62.6H61.2Z')}<path d="M41 46H79C81 46 82 47 82 49V61C82 63 81 64 79 64H64C62 64 61.4 61 60 61C58.6 61 58 64 56 64H41C39 64 38 63 38 61V49C38 47 39 46 41 46ZM40.4 47.4V62.6H58.8V47.4ZM61.2 47.4V62.6H79.6V47.4Z" fill="${h.c1}" fill-rule="evenodd"/>${temples(h.c1, 2, 51, 38.4)}`,
    },
    versionMini: true,
  },
  {
    id: 'monoculo', nombre: 'Monóculo', art: 'el', icono: '🧐', anclaje: 'ojoDer', coloreable: false, colorPorDefecto: GOLD,
    animacion: 'destello',
    piezas: {
      sombra: () => glassShadow(circ(RR[0], RR[1], 9.8)),
      adelante: (h) => `${fill(circ(RR[0], RR[1], 9.5), '#fff', ' opacity=".14"')}${lensGlint(h, circ(RR[0], RR[1], 9.5))}<circle cx="${RR[0]}" cy="${RR[1]}" r="9.5" fill="none" stroke="${h.c1}" stroke-width="2.2"/>${h.mini ? '' : line('M78.6 58.6C84 66 84.6 76 79 84.6', h.c1, 1, 1, ' stroke-dasharray="1.4 1.6"')}`,
    },
    versionMini: true,
  },
  {
    id: 'pixel', nombre: 'Gafas pixeladas', art: 'las', icono: '😎', anclaje: 'ojos', coloreable: false, colorPorDefecto: '#1E1E22',
    piezas: {
      sombra: () => glassShadow('M37 44H83V47H79V61H75V64H45V61H41V47H37Z'),
      adelante: (h) => {
        const lens = 'M41 46.4H59V60.4H57V62.6H54.6V64.6H45.4V62.6H43V60.4H41ZM61 46.4H79V60.4H77V62.6H74.6V64.6H65.4V62.6H63V60.4H61Z';
        return `${fill(lens, h.c1, ' opacity=".55"')}${fill('M37 44H83V46.6H37Z', h.c1)}${h.mini ? '' : fill('M43 48.6H46V51.6H43ZM46 51.6H49V54.6H46ZM63 48.6H66V51.6H63ZM66 51.6H69V54.6H66Z', '#fff', ' opacity=".75"')}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'esqui', nombre: 'Gafas de esquí', art: 'las', icono: '⛷️', anclaje: 'ojos', coloreable: true, colorPorDefecto: '#4AA8FF', color2: '#34343A',
    animacion: 'destello',
    piezas: {
      atras: (h) => fill('M14 51.6H106V58.4H14Z', h.c2),
      sombra: () => glassShadow('M37 54C37 47 42 44.5 49 44.5L71 44.5C78 44.5 83 47 83 54L83 57C83 63 79 65.5 73 65.5C68 65.5 65 63 62.5 60.5C61 59 59 59 57.5 60.5C55 63 52 65.5 47 65.5C41 65.5 37 63 37 57Z'),
      adelante: (h) => {
        const d = 'M37 54C37 47 42 44.5 49 44.5L71 44.5C78 44.5 83 47 83 54L83 57C83 63 79 65.5 73 65.5C68 65.5 65 63 62.5 60.5C61 59 59 59 57.5 60.5C55 63 52 65.5 47 65.5C41 65.5 37 63 37 57Z';
        return `<linearGradient id="${h.id}sk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD23F"/><stop offset=".5" stop-color="#F5A524"/><stop offset="1" stop-color="#FF7EB6"/></linearGradient>${fill('M26 51.6H38V58.4H26ZM82 51.6H94V58.4H82Z', h.c2)}${fill(d, `url(#${h.id}sk)`, ' opacity=".42"')}${lensGlint(h, d)}<path d="${d}" fill="none" stroke="${h.c1}" stroke-width="3" stroke-linejoin="round"/>`;
      },
    },
    versionMini: true,
  },
  {
    id: 'nariz', nombre: 'Gafas con nariz', art: 'las', icono: '🥸', anclaje: 'ojos', coloreable: false, colorPorDefecto: '#1E1E22', color2: '#F4A9A0',
    incompatibleCon: ['vello'],
    piezas: {
      sombra: () => glassShadow(`${roundLens}${ell(60, 60, 4.4, 4)}`),
      piel: (h) => fill(sym('M60 62.8C55 61.6 48 62.6 44.4 66.6C48.4 68.6 55 67.6 60 66'), h.c1),
      adelante: (h) => `${fill(roundLens, '#fff', ' opacity=".12"')}<path d="${circ(L[0], L[1], 8.8)}${circ(RR[0], RR[1], 8.8)}" fill="none" stroke="${h.c1}" stroke-width="2.8"/>${line('M41.6 44.2Q50.5 39.6 58.8 43.6M61.2 43.6Q69.5 39.6 78.4 44.2', h.c1, 3.2)}${fill(ell(60, 59.6, 4.2, 3.9), h.f2)}${h.mini ? '' : hl(58.6, 58, 1.4, 0.9, -20, 0.6)}${temples(h.c1, 2.2, 53.6, 41.8)}`,
    },
    versionMini: true,
  },
];

// ── Vello facial (cara, recortado al cuerpo, debajo de la boca y los ojos) ──
const MOUTH_HOLE = ell(60, 71.6, 10.4, 6.6);
const fullBeard = (inner) => `M${pt(P(158, 3))}${along(158, 22, 3)}${inner}Z`;
const FACIAL = [
  {
    id: 'bigote', nombre: 'Bigote clásico', art: 'el', icono: '👨', anclaje: 'boca', coloreable: true, colorPorDefecto: '#34343A',
    piezas: {
      adelante: (h) => `${fill(sym('M60 63C55.6 60.8 47.4 60.4 41.4 65.8C40 67.4 41 69.8 43.2 69.6C49.2 69 55 68.2 60 66.8'), h.f1)}${h.mini ? '' : line('M46 66.6L48 68.6M50.4 65.4L52 67.8M74 66.6L72 68.6M69.6 65.4L68 67.8', h.c1d, 0.9, 0.5)}`,
    },
    versionMini: true,
  },
  {
    id: 'manubrio', nombre: 'Bigote de manubrio', art: 'el', icono: '🥨', anclaje: 'boca', coloreable: true, colorPorDefecto: '#34343A',
    piezas: {
      adelante: (h) => fill(sym('M60 61.6C56.5 60.8 52 60.9 48 61.9C44.5 62.8 42.2 63.2 41.4 61.7C40.8 60.5 41.6 59.3 42.6 59.6C41.2 57.2 37.6 58.2 38 61.3C38.4 64.8 42.8 65.8 47 64.8C51.5 63.8 56 63.6 60 64.4'), h.f1),
    },
    versionMini: true,
  },
  {
    id: 'lapiz', nombre: 'Bigote lápiz', art: 'el', icono: '✏️', anclaje: 'boca', coloreable: true, colorPorDefecto: '#34343A',
    piezas: {
      adelante: (h) => fill(sym('M60 65C54.6 64.6 49 64.8 43.6 66.6C43 67 43.4 67.6 44 67.5C49.4 66.8 54.8 66.6 60 66.8'), h.c1),
    },
    versionMini: false,
  },
  {
    id: 'barba', nombre: 'Barba completa', art: 'la', icono: '🧔', anclaje: 'menton', coloreable: true, colorPorDefecto: '#8A5A3B',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => `${fill(`${fullBeard('C86 66 78 62.4 70 64.6C66 61.8 63 61.6 60 62.6C57 61.6 54 61.8 50 64.6C42 62.4 34 66')}${MOUTH_HOLE}`, h.f1, ' fill-rule="evenodd"')}${h.mini ? '' : line('M44 80C46 84 49 87 52 88.6M76 80C74 84 71 87 68 88.6M60 82L60 88', h.c1d, 1, 0.4)}`,
    },
    versionMini: true,
  },
  {
    id: 'lenador', nombre: 'Barba de leñador', art: 'la', icono: '🪓', anclaje: 'menton', coloreable: true, colorPorDefecto: '#C0552F',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => {
        const r = rng(7);
        const curls = h.mini ? '' : Array.from({ length: 9 }, (_, k) => {
          const x = 38 + k * 5.5, y = 80 + r() * 8;
          return line(`M${f(x)} ${f(y)}q2 3 0 6`, h.c1d, 1.1, 0.45);
        }).join('');
        return `${fill(`M${pt(P(164, 3))}${along(164, 16, 3)}C90 58 82 56 72 60.6C67 59.4 63 59.6 60 61C57 59.6 53 59.4 48 60.6C38 56 30 58 ${pt(P(164, 3))}Z${MOUTH_HOLE}`, h.f1, ' fill-rule="evenodd"')}${curls}${h.mini ? '' : hl(40, 74, 4, 1.6, 30, 0.2)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'candado', nombre: 'Candado', art: 'el', icono: '🔒', anclaje: 'boca', coloreable: true, colorPorDefecto: '#34343A',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => fill(`M60 61.8C54 61.2 48 62.5 46.5 67C45 72 46 80 50 84C53 87 57 88 60 88C63 88 67 87 70 84C74 80 75 72 73.5 67C72 62.5 66 61.2 60 61.8Z${ell(60, 71.6, 9.8, 6.4)}`, h.f1, ' fill-rule="evenodd"'),
    },
    versionMini: true,
  },
  {
    id: 'chivera', nombre: 'Chivera', art: 'la', icono: '🐐', anclaje: 'menton', coloreable: true, colorPorDefecto: '#34343A',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => `${fill('M53.4 79.6C56 78.6 64 78.6 66.6 79.6C66 85 63 90.4 60 91.6C57 90.4 54 85 53.4 79.6Z', h.f1)}${h.mini ? '' : line('M58 82L59 88M62 82L61 88', h.c1d, 0.9, 0.45)}`,
    },
    versionMini: true,
  },
  {
    id: 'tres-dias', nombre: 'Barba de tres días', art: 'la', icono: '🌑', anclaje: 'menton', coloreable: true, colorPorDefecto: '#34343A',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => {
        const area = `${fullBeard('C86 66 78 63 70 65C66 63 63 62.8 60 63.6C57 62.8 54 63 50 65C42 63 34 66')}${MOUTH_HOLE}`;
        const r = rng(11);
        const dots = h.mini ? '' : Array.from({ length: 70 }, () => {
          const a = rad(20 + r() * 140), rr = 22 + r() * 13;
          const x = 60 + rr * Math.cos(a), y = 62 + rr * Math.sin(a) * 0.86;
          if (Math.hypot((x - 60) / 11.4, (y - 71.6) / 7.6) < 1 || y < 64) return '';
          return `M${f(x)} ${f(y)}h.01`;
        }).join('');
        return `${fill(area, h.c1, ' fill-rule="evenodd" opacity=".34"')}${dots ? line(dots, h.c1d, 1.3, 0.7) : ''}`;
      },
    },
    versionMini: true,
  },
];

// ── Cuello (cuerpo) ───────────────────────────────────────
const NECK = [
  {
    id: 'bufanda', nombre: 'Bufanda', art: 'la', icono: '🧣', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#E5484D', color2: '#FAF5E8',
    animacion: 'mecer',
    piezas: {
      sombra: () => sh(band(152, 28, 0, 87, 79), 0.3, 'up'),
      adelante: (h) => {
        const b = `M${pt(P(154, 2.8))} Q60 85.6 ${pt(P(26, 2.8))} L${pt(P(38, 2.8))} Q60 101 ${pt(P(142, 2.8))}Z`;
        const stripes = h.mini ? '' : `${fill(`M44 84.6Q46 86.8 46.6 88.8L43 90.6Q42.2 88 40.6 85.8Z`, h.c2, ' opacity=".9"')}${fill(`M76 84.6Q74 86.8 73.4 88.8L77 90.6Q77.8 88 79.4 85.8Z`, h.c2, ' opacity=".9"')}`;
        const tails = `<g data-a="mecer" data-o="72 87">${fill('M67 86L70 106C70.4 108 72.6 108.6 74 107.6L77 105.4L74.6 85Z', h.f1)}${fill('M73 85.4L78.6 103.6C79.4 105.4 81.6 105.6 82.8 104.4L85 102L80 84Z', h.c1d)}${h.mini ? '' : `${line('M70.6 106.4L70.8 109.6M73.4 106.8L73.8 109.8M79.4 104.6L80.4 107.6M82.4 103.6L83.8 106.4', h.c1d, 1, 0.8)}${fill('M68.4 95L76 94L76.6 97.4L69 98.4Z', h.c2, ' opacity=".9"')}`}</g>`;
        return `${fill(b, h.f1)}${stripes}${tails}${h.mini ? '' : hl(42, 83.6, 3.4, 0.9, 12, 0.22)}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'corbatin', nombre: 'Corbatín', art: 'el', icono: '🎀', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#E5484D',
    animacion: 'mecer',
    piezas: {
      sombra: () => sh(ell(60, 87.6, 14, 4), 0.3, 'radial'),
      adelante: (h) => `<g data-a="mecer" data-o="60 84">${fill(sym('M60 82.6C55 79.2 49.4 78.4 47.8 80.6C46.8 82.8 46.8 86 47.8 88.2C49.4 90.4 55 89.4 60 86.2'), h.f1)}${h.mini ? '' : line('M50.6 81.6Q52.6 84.4 50.6 87.2M69.4 81.6Q67.4 84.4 69.4 87.2', h.c1d, 1, 0.5)}${fill('M58.6 81.4H61.4C62.6 81.4 63.2 82.2 63.2 83.4V85.6C63.2 86.8 62.6 87.4 61.4 87.4H58.6C57.4 87.4 56.8 86.8 56.8 85.6V83.4C56.8 82.2 57.4 81.4 58.6 81.4Z', h.c1d)}</g>`,
    },
    versionMini: true,
  },
  {
    id: 'corbata', nombre: 'Corbata', art: 'la', icono: '👔', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#2BB3C0', color2: '#FAF5E8',
    animacion: 'mecer',
    piezas: {
      sombra: () => sh(ell(60, 86.6, 10, 3.4), 0.3, 'radial'),
      adelante: (h) => `${fill(twin('M58.6 80.8L50.6 78.6L53.6 85Z'), CREAM)}<g data-a="mecer" data-o="60 86">${fill('M57.6 86.6L62.4 86.6L65.4 101L60 106.4L54.6 101Z', h.f1)}${h.mini ? '' : line('M56.4 92L63.8 89.4M55.6 97.6L64.8 94.4M56.6 102.6L65 99.6', h.c2, 1.1, 0.7)}</g>${fill('M56.4 80.2H63.6L62.2 86.8H57.8Z', h.c1d)}`,
    },
    versionMini: true,
  },
  {
    id: 'panoleta', nombre: 'Pañoleta', art: 'la', icono: '🤠', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#E5484D', color2: '#FAF5E8',
    animacion: 'mecer',
    piezas: {
      sombra: () => sh(band(150, 30, 0, 87, 80), 0.28, 'up'),
      adelante: (h) => `${fill(`M${pt(P(152, 2.2))} Q60 87 ${pt(P(28, 2.2))} L${pt(P(33, 2.2))} Q60 92 ${pt(P(147, 2.2))}Z`, h.f1)}<g data-a="mecer" data-o="60 87">${fill('M46 85.6Q60 90.6 74 85.6Q67 93 61.4 101.4Q60 102.8 58.6 101.4Q53 93 46 85.6Z', h.f1)}${h.mini ? '' : fill([circ(54, 89.6, 0.9), circ(60, 91, 0.9), circ(66, 89.6, 0.9), circ(57, 95, 0.8), circ(63, 95, 0.8), circ(60, 98.6, 0.7)].join(''), h.c2)}</g>${fill(`${circ(86.6, 82.4, 2.6)}`, h.c1d)}${h.mini ? '' : fill('M88 84.6L93.6 92.4L90.4 93.6L86.6 86Z', h.c1d)}`,
    },
    versionMini: true,
  },
  {
    id: 'hawaiano', nombre: 'Collar hawaiano', art: 'el', icono: '🌺', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#FF7EB6', color2: '#FFD23F',
    piezas: {
      sombra: () => sh(band(150, 30, 0, 91, 84), 0.22, 'up'),
      adelante: (h) => {
        const n = h.mini ? 6 : 9;
        let out = '';
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1), x = (1 - t) ** 2 * 32 + 2 * t * (1 - t) * 60 + t * t * 88, y = (1 - t) ** 2 * 75 + 2 * t * (1 - t) * 95 + t * t * 75;
          const c = k % 2 ? h.f2 : h.f1, r = h.mini ? 3.6 : 2.5;
          const petals = [0, 72, 144, 216, 288].map((a) => circ(x + 2.6 * Math.cos(rad(a + k * 20)), y + 2.6 * Math.sin(rad(a + k * 20)), r)).join('');
          out += `${fill(petals, c)}${fill(circ(x, y, 1.3), k % 2 ? '#E5484D' : '#FFF4C2')}`;
        }
        return out;
      },
    },
    versionMini: true,
  },
  {
    id: 'cadena', nombre: 'Cadena dorada', art: 'la', icono: '⛓️', anclaje: 'cuello', coloreable: false, colorPorDefecto: GOLD,
    piezas: {
      adelante: (h) => {
        const n = h.mini ? 9 : 17;
        let d = '';
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1), x = (1 - t) ** 2 * 34 + 2 * t * (1 - t) * 60 + t * t * 86, y = (1 - t) ** 2 * 76 + 2 * t * (1 - t) * 95 + t * t * 76;
          const dx = 2 * (1 - t) * (60 - 34) + 2 * t * (86 - 60), dy = 2 * (1 - t) * (95 - 76) + 2 * t * (76 - 95);
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI + (k % 2 ? 90 : 0);
          d += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${k % 2 ? 1.2 : 2.3}" ry="${k % 2 ? 2 : 1.3}" transform="rotate(${f(ang)} ${f(x)} ${f(y)})"/>`;
        }
        return `<g fill="none" stroke="${h.c1}" stroke-width="${h.mini ? 1.8 : 1.2}">${d}</g>${h.mini ? '' : `<g fill="none" stroke="#FFF1C4" stroke-width=".5" opacity=".8" transform="translate(-.4 -.4)">${d}</g>`}`;
      },
    },
    versionMini: true,
  },
  {
    id: 'medalla', nombre: 'Medalla', art: 'la', icono: '🏅', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#2BB3C0', color2: GOLD,
    animacion: 'mecer',
    piezas: {
      sombra: () => sh(ell(60, 96, 8, 3), 0.26, 'radial'),
      adelante: (h) => `${fill('M38 76.6L57.6 89.8L62.4 89.8L82 76.6L78.4 75.2L60 86.6L41.6 75.2Z', h.f1)}<g data-a="mecer" data-o="60 89">${fill('M58 88.4H62V91.4H58Z', h.c2)}${fill(circ(60, 96, 6.4), h.f2)}${fill(star5(60, 96.2, 3.6, 1.6), h.c2, ' opacity=".9" stroke="#C99A1E" stroke-width=".6"')}${h.mini ? '' : hl(57.6, 93.6, 1.8, 1, -30, 0.6)}</g>`,
    },
    versionMini: true,
  },
  {
    id: 'ruana', nombre: 'Ruana', art: 'la', icono: '🧥', anclaje: 'cuello', coloreable: true, colorPorDefecto: '#8A5A3B', color2: '#FAF5E8',
    animacion: 'mecer',
    piezas: {
      sombra: () => sh('M26 68C34 76 47 80.6 60 80.6C73 80.6 86 76 94 68C85 73 72 76.4 60 76.4C48 76.4 35 73 26 68Z', 0.34, 'up'),
      adelante: (h) => {
        const L0 = P(162, 2.4), R0 = P(18, 2.4);
        const fringe = h.mini ? '' : line(Array.from({ length: 13 }, (_, k) => {
          const t = k / 12, x = 15 + t * 45, y = 101 + t * 12.4;
          return `M${f(x)} ${f(y)}l-.4 3M${f(120 - x)} ${f(y)}l.4 3`;
        }).join(''), h.c1d, 1, 0.85);
        return `<g data-a="mecer" data-o="60 80">${fill(`M${pt(L0)}C34 76 46 80.6 60 80.6C74 80.6 86 76 ${pt(R0)}C99 84 104 93 106 100.4Q84 104 60 113.4Q36 104 14 100.4C16 93 21 84 ${pt(L0)}Z`, h.f1)}${h.mini ? '' : `${line('M17.6 95.6Q38 99 60 107.4Q82 99 102.4 95.6', h.c2, 2.2, 0.9)}${line('M16 99Q37 102.6 60 111Q83 102.6 104 99', h.c1d, 1.2, 0.7)}${line('M60 81L60 106', h.c1d, 0.9, 0.35)}`}${fringe}${line('M36 74.6Q48 82 60 82.4Q72 82 84 74.6', h.c1l, 1.4, 0.55)}</g>`;
      },
    },
    versionMini: true,
  },
  {
    id: 'capa', nombre: 'Capa de héroe', art: 'la', icono: '🦸', anclaje: 'espalda', coloreable: true, colorPorDefecto: '#E5484D', color2: GOLD,
    animacion: 'ondear',
    piezas: {
      atras: (h) => `<g data-a="ondear" data-o="60 70">${fill('M34 68C26 84 16 100 9 113C19 109 26 113 34 109C42 113 50 109 60 112C70 109 78 113 86 109C94 113 101 109 111 113C104 100 94 84 86 68Z', h.f1)}${h.mini ? '' : fill('M36 70C30 84 22 98 16 110C22 109 27 111 33 108C38 98 42 86 44 74Z', h.c1d, ' opacity=".5"')}</g>`,
      adelante: (h) => `${line('M38.6 80.6Q60 87.4 81.4 80.6', h.c1d, 1.4)}${fill(`${circ(38.4, 80, 2.8)}${circ(81.6, 80, 2.8)}`, h.c2)}${h.mini ? '' : fill(`${circ(37.6, 79.2, 0.9)}${circ(80.8, 79.2, 0.9)}`, '#fff', ' opacity=".7"')}`,
    },
    versionMini: true,
  },
];

// ── Detalles de cara (cara, recortados al cuerpo) ─────────
const FACE = [
  {
    id: 'rubor', nombre: 'Rubor', art: 'el', icono: '☺️', anclaje: 'boca', coloreable: false, colorPorDefecto: PINK,
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => `<radialGradient id="${h.id}rb"><stop offset="0" stop-color="${h.c1}" stop-opacity=".95"/><stop offset=".55" stop-color="${h.c1}" stop-opacity=".6"/><stop offset="1" stop-color="${h.c1}" stop-opacity="0"/></radialGradient>${fill(`${ell(41.2, 66.4, 7.2, 4.2)}${ell(78.8, 66.4, 7.2, 4.2)}`, `url(#${h.id}rb)`)}`,
    },
    versionMini: true,
  },
  {
    id: 'pecas', nombre: 'Pecas', art: 'las', icono: '🌟', anclaje: 'boca', coloreable: false, colorPorDefecto: '#FFC9A8',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => fill(`${[[38.6, 62.6, 0.95], [41.6, 61.4, 0.8], [44.2, 63.4, 0.9], [40, 65.6, 0.8], [43.2, 66.2, 0.7], [37.2, 65.2, 0.6]].map(([x, y, r]) => `${circ(x, y, r)}${circ(120 - x, y, r)}`).join('')}`, h.c1, ' opacity=".9"'),
    },
    versionMini: false,
  },
  {
    id: 'curita', nombre: 'Curita', art: 'la', icono: '🩹', anclaje: 'frente', coloreable: false, colorPorDefecto: '#F2C9A0',
    clipAlCuerpo: true,
    piezas: {
      adelante: (h) => `<g transform="rotate(-35 81 44)">${fill('M75.4 41.6H86.6C87.9 41.6 88.9 42.6 88.9 43.9V44.1C88.9 45.4 87.9 46.4 86.6 46.4H75.4C74.1 46.4 73.1 45.4 73.1 44.1V43.9C73.1 42.6 74.1 41.6 75.4 41.6Z', h.c1)}${fill('M79.2 41.6H82.8V46.4H79.2Z', '#E3A97C')}${fill(`${circ(76, 43, 0.35)}${circ(76, 45, 0.35)}${circ(86, 43, 0.35)}${circ(86, 45, 0.35)}`, '#C98B63')}</g>`,
    },
    versionMini: false,
  },
  {
    id: 'lunar', nombre: 'Lunar', art: 'el', icono: '⚫', anclaje: 'boca', coloreable: false, colorPorDefecto: '#1E1E22',
    clipAlCuerpo: true,
    piezas: { adelante: (h) => fill(circ(74.2, 75, 1.35), h.c1) },
    versionMini: false,
  },
  {
    id: 'brillitos', nombre: 'Brillitos', art: 'los', icono: '✨', anclaje: 'ojos', coloreable: false, colorPorDefecto: '#FFFFFF',
    animacion: 'brillitos', clipAlCuerpo: true,
    piezas: {
      adelante: (h) => [[36, 50, 3.4, 0], [84.6, 48, 2.6, 1.1], [81, 74, 2.8, 2.1], [38.6, 76.4, 2.2, 0.6]].map(([x, y, r, p]) => `<g data-a="brillitos" data-o="${x} ${y}" data-p="${p}">${fill(spark(x, y, r), h.c1)}</g>`).join(''),
    },
    versionMini: false,
  },
  {
    id: 'corazoncito', nombre: 'Corazoncito', art: 'el', icono: '💗', anclaje: 'boca', coloreable: false, colorPorDefecto: '#FF7EB6',
    clipAlCuerpo: true,
    piezas: { adelante: (h) => `${fill(heart(80.4, 66.6, 0.36), h.c1)}${fill(circ(79.4, 64.4, 0.5), '#fff', ' opacity=".7"')}` },
    versionMini: false,
  },
];

// ── Extras (cuerpo) ───────────────────────────────────────
const EXTRAS = [
  {
    id: 'audifonos', nombre: 'Audífonos', art: 'los', icono: '🎧', anclaje: 'izq', coloreable: true, colorPorDefecto: '#34343A', color2: '#C8F35A',
    piezas: {
      atras: (h) => `<path d="M${pt(P(-172, 4))}${along(-172, -8, 4)}" fill="none" stroke="${h.c1}" stroke-width="4" stroke-linecap="round"/>`,
      adelante: (h) => `${fill('M25 48.6H29C31.4 48.6 33 50.2 33 52.6V63.4C33 65.8 31.4 67.4 29 67.4H25C22.6 67.4 21 65.8 21 63.4V52.6C21 50.2 22.6 48.6 25 48.6ZM91 48.6H95C97.4 48.6 99 50.2 99 52.6V63.4C99 65.8 97.4 67.4 95 67.4H91C88.6 67.4 87 65.8 87 63.4V52.6C87 50.2 88.6 48.6 91 48.6Z', h.f1)}${fill('M31.4 51.4H33.6V64.6H31.4ZM86.4 51.4H88.6V64.6H86.4Z', h.c2)}${hl(24.4, 52.6, 1.4, 2.6, 0, 0.35)}`,
    },
    versionMini: false,
  },
  {
    id: 'flor', nombre: 'Flor en la cabeza', art: 'la', icono: '🌸', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#FF7EB6', color2: '#FFD23F',
    animacion: 'resorte',
    piezas: {
      adelante: (h) => `<g data-a="resorte" data-o="40 37">${fill('M41 36C44 37 47 36 48.6 33.4C45.6 32.4 42.6 33.4 41 36Z', '#3FC59B')}${fill([0, 72, 144, 216, 288].map((a) => circ(36.4 + 4 * Math.cos(rad(a - 90)), 31.6 + 4 * Math.sin(rad(a - 90)), 3.4)).join(''), h.f1)}${fill(circ(36.4, 31.6, 2.2), h.c2)}</g>`,
    },
    versionMini: false,
  },
  {
    id: 'lapiz-oreja', nombre: 'Lápiz de lado', art: 'el', icono: '✏️', anclaje: 'der', coloreable: false, colorPorDefecto: '#FFD23F',
    piezas: {
      atras: (h) => `<g transform="rotate(-32 92 40)">${fill('M78 37.6H102V42.4H78Z', h.f1)}${fill('M102 37.6H106.4C107.6 37.6 108.4 38.4 108.4 39.6V40.4C108.4 41.6 107.6 42.4 106.4 42.4H102Z', '#FF8FB8')}${fill('M101 37.4H103V42.6H101Z', '#C9CDD3')}${fill('M78 37.6L72 40L78 42.4Z', '#F2D3A8')}${fill('M74 39.2L72 40L74 40.8Z', INK)}${line('M80 40H100', '#E0A800', 0.8, 0.6)}</g>`,
    },
    versionMini: false,
  },
  {
    id: 'mariposa', nombre: 'Mariposa posada', art: 'la', icono: '🦋', anclaje: 'coronilla', coloreable: true, colorPorDefecto: '#2BB3C0', color2: '#FFD23F',
    animacion: 'aletear',
    piezas: {
      adelante: (h) => `<g transform="rotate(14 82 26)"><g data-a="aletear" data-o="82 26">${fill(`${twin('M81.4 25.6C78 19 70.6 18.6 70.6 23.4C70.6 26 74 27.6 81.4 26.6Z', 82)}${twin('M81.4 26.6C76 27.6 72.6 30.6 74.4 33C76 35 80 32 81.4 27.4Z', 82)}`, h.f1)}${fill(`${circ(75, 22.6, 1.4)}${circ(89, 22.6, 1.4)}`, h.c2)}</g>${line('M82 22.4L82 31', INK, 1.6)}${line('M82 22.6Q80.6 19.4 79 18.6M82 22.6Q83.4 19.4 85 18.6', INK, 0.7)}</g>`,
    },
    versionMini: false,
  },
  {
    id: 'globo', nombre: 'Globo atado', art: 'el', icono: '🎈', anclaje: 'der', coloreable: true, colorPorDefecto: '#E5484D',
    animacion: 'flotar',
    piezas: {
      atras: (h) => `<g data-a="flotar" data-o="92 66">${line('M92 66C98 52 96 36 104 16', '#6F6F69', 0.8)}${fill('M104 -7C109.6 -7 113.6 -2.4 113.6 3.6C113.6 10 108.6 15 104 15C99.4 15 94.4 10 94.4 3.6C94.4 -2.4 98.4 -7 104 -7Z', h.f1)}${fill('M102.6 15L105.4 15L106 17.4L102 17.4Z', h.c1d)}${hl(100, -1.4, 2.4, 4, 20, 0.5)}</g>`,
    },
    versionMini: false,
  },
];

// ── Catálogo ──────────────────────────────────────────────
const BY_SLOT = { cabello: HAIR, cabeza: HEAD, gafas: GLASSES, vello: FACIAL, cuello: NECK, cara: FACE, extras: EXTRAS };
const FRAME = { gafas: 'cara', vello: 'cara', cara: 'cara' };
const SKIN = new Set(['vello', 'cara']);
export const ITEMS = [];
for (const slot of SLOTS) {
  for (const it of BY_SLOT[slot]) {
    ITEMS.push({
      slot, icono: '', anclaje: 'espalda', coloreable: false, color2: CREAM, clipAlCuerpo: SKIN.has(slot), animacion: null,
      ocultaSlots: [], varianteCon: null, incompatibleCon: [], versionMini: true, ...it,
      marco: FRAME[slot] ?? 'cuerpo',
    });
  }
}
export const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
export const itemsOf = (slot) => ITEMS.filter((it) => it.slot === slot);

export const SLOT_INFO = {
  cabello: { nombre: 'Cabello', icono: 'M6 14c0-5 3-9 6-9s6 4 6 9M8 9c2 1 6 1 8 0' },
  cabeza: { nombre: 'Cabeza', icono: 'M4 15h16M7 15c0-5 2-8 5-8s5 3 5 8' },
  gafas: { nombre: 'Gafas', icono: 'M3 12h2m14 0h2M5 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M13 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0' },
  vello: { nombre: 'Vello', icono: 'M12 11c-2-1.6-5-1.6-7 1c2 1 4 1 7-.4c3 1.4 5 1.4 7 .4c-2-2.6-5-2.6-7-1Z' },
  cuello: { nombre: 'Cuello', icono: 'M5 9c4 3 10 3 14 0M7 10l-1 9M17 10l1 9M12 12v8' },
  cara: { nombre: 'Detalles', icono: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z' },
  extras: { nombre: 'Extras', icono: 'M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z' },
};

/** Looks sugeridos: un conjunto completo con un toque. */
export const LOOKS = [
  { id: 'ejecutivo', nombre: 'Ejecutivo', config: { cabello: 'raya', cuello: 'corbata', vello: 'lapiz', colores: { cuello: '#E5484D' } } },
  { id: 'costeno', nombre: 'Costeño', config: { cabeza: 'vueltiao', cuello: 'panoleta', vello: 'bigote', colores: { cuello: '#E5484D' } } },
  { id: 'rockero', nombre: 'Rockero', config: { cabello: 'tupe', gafas: 'aviador', cuello: 'cadena', vello: 'tres-dias' } },
  { id: 'fiestero', nombre: 'Fiestero', config: { cabeza: 'fiesta', gafas: 'estrella', cuello: 'hawaiano', cara: 'brillitos' } },
  { id: 'intelectual', nombre: 'Intelectual', config: { cabeza: 'boina', gafas: 'redondas', vello: 'chivera', cuello: 'corbatin', colores: { cabeza: '#34343A', cuello: '#E5484D' } } },
  { id: 'invierno', nombre: 'Invierno', config: { cabeza: 'lana', cuello: 'bufanda', cara: 'rubor', colores: { cabeza: '#E5484D', cuello: '#2BB3C0' } } },
  { id: 'explorador', nombre: 'Explorador', config: { cabeza: 'pescador', cuello: 'panoleta', extras: 'mariposa', vello: 'lenador', colores: { cabeza: '#8A5A3B', cuello: '#F5A524' } } },
  { id: 'superheroe', nombre: 'Superhéroe', config: { cabello: 'copete', cuello: 'capa', cara: 'brillitos', colores: { cuello: '#E5484D' } } },
];

// ── Reglas ────────────────────────────────────────────────
const conflicts = (a, b) => a.incompatibleCon.some((x) => x === b.id || x === b.slot) || b.incompatibleCon.some((x) => x === a.id || x === a.slot);

/** Color vigente de un ítem en una apariencia (solo de la paleta si es coloreable). */
export function colorOf(cfg, item) {
  const c = cfg?.colores?.[item.slot];
  return item.coloreable && PAL.has(c) ? c : item.colorPorDefecto;
}

/**
 * Valida una apariencia (de la base de datos, la caché o el editor): descarta en silencio IDs desconocidos, ítems en
 * un slot que no es el suyo, colores fuera de la paleta y combinaciones incompatibles. Devuelve solo IDs y colores.
 */
export function validateLook(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const colores = {};
  for (const slot of SLOTS) {
    const id = raw[slot];
    const it = typeof id === 'string' ? BY_ID.get(id) : null;
    if (!it || it.slot !== slot) continue;
    if (Object.values(out).some((oid) => typeof oid === 'string' && conflicts(BY_ID.get(oid), it))) continue;
    out[slot] = id;
    const c = raw.colores?.[slot];
    if (it.coloreable && typeof c === 'string' && PAL.has(c.toUpperCase()) && c.toUpperCase() !== it.colorPorDefecto) colores[slot] = c.toUpperCase();
  }
  if (Object.keys(colores).length) out.colores = colores;
  return out;
}

/** Equipa `id` en su slot (o quita el slot con id = null). Resuelve conflictos quitando lo incompatible. */
export function equip(cfg, slot, id, color) {
  const next = { ...cfg, colores: { ...(cfg.colores ?? {}) } };
  const removed = [];
  if (!id) { delete next[slot]; delete next.colores[slot]; }
  else {
    const it = BY_ID.get(id);
    next[slot] = id;
    if (color !== undefined) { if (color && color !== it.colorPorDefecto) next.colores[slot] = color; else delete next.colores[slot]; }
    else if (cfg[slot] !== id) delete next.colores[slot];
    for (const s of SLOTS) {
      if (s === slot || !next[s]) continue;
      const other = BY_ID.get(next[s]);
      if (other && conflicts(it, other)) { removed.push(other); delete next[s]; delete next.colores[s]; }
    }
  }
  if (!Object.keys(next.colores).length) delete next.colores;
  return { config: next, removed };
}

/** Combinación aleatoria que respeta las reglas (nunca vacía ni igual a la actual). */
export function surprise(current = {}, rnd = Math.random) {
  const P_SLOT = { cabeza: 0.7, cabello: 0.5, gafas: 0.5, vello: 0.35, cuello: 0.55, cara: 0.35, extras: 0.3 };
  for (let tries = 0; tries < 20; tries++) {
    let cfg = {};
    for (const slot of SLOTS) {
      if (rnd() > P_SLOT[slot]) continue;
      const list = itemsOf(slot);
      const it = list[Math.floor(rnd() * list.length)];
      const color = it.coloreable && rnd() < 0.6 ? PALETTE[Math.floor(rnd() * PALETTE.length)].hex : undefined;
      cfg = equip(cfg, slot, it.id, color).config;
    }
    cfg = validateLook(cfg);
    if (!isClassic(cfg) && JSON.stringify(cfg) !== JSON.stringify(validateLook(current))) return cfg;
  }
  return validateLook({ cabeza: 'corona', gafas: 'corazon' });
}

const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
export const itemName = (it) => lc(it.nombre);
/** "Lukas con sombrero vueltiao y gafas redondas" */
export function describe(cfg) {
  const names = SLOTS.map((s) => BY_ID.get(cfg?.[s])).filter(Boolean).map(itemName);
  if (!names.length) return 'Lukas';
  return `Lukas con ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`}`;
}
/** "Lukas se quitó el bigote clásico para ponerse las gafas con nariz" */
export const conflictText = (removed, by) => `Lukas se quitó ${removed.art} ${itemName(removed)} para ponerse ${by.art} ${itemName(by)}`;
