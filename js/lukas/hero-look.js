// Accesorios sobre el Lukas grande del Inicio. Ese Lukas es el orbe de voz (canvas, js/voice/*), que no se toca:
// aquí solo se LEE su geometría pública de cada frame (orb.geo y la cara orb.face, en solo lectura) y se dibujan dos
// SVG hermanos del canvas dentro del mismo .orb-body (que ya flota, se aplasta y salta): uno detrás (piezas traseras)
// y otro delante. Los marcos replican exactamente la transformación con que la cara pinta los ojos y la boca, así los
// ítems siguen el centro real, el estiramiento, la inclinación y el asentimiento. La piel (vello, rubor) se recorta
// con el contorno real del blob y deja libres los ojos y la boca del canvas con una máscara de sus mismos trazos.
import { onLook } from './store.js';
import { LookLayer, eyeShape } from './layer.js';
import { scaleFor } from '../voice/orb-face.js';
import { mouthPoints, clamp } from '../ui/face-geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const r2 = (v) => Math.round(v * 100) / 100;
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
};
let uid = 0;

/** Monta los accesorios del usuario sobre el orbe del Inicio. Devuelve { kick, destroy }. */
export function attachHeroLook(orb, body) {
  const canvas = orb.canvas;
  const id = `hl${++uid}`;
  const mk = (cls) => el('svg', { class: `hero-look ${cls}`, 'aria-hidden': 'true', focusable: 'false' });
  const backSvg = mk('is-back'), frontSvg = mk('is-front');
  canvas.before(backSvg);
  canvas.after(frontSvg);
  const defs = el('defs', {}, frontSvg);
  const clip = el('clipPath', { id: `${id}c` }, defs);
  const clipPath = el('path', {}, clip);
  // Máscara de la piel: todo visible menos los trazos de los ojos y la boca del canvas (con 1.2 u de margen)
  const mask = el('mask', { id: `${id}m`, maskUnits: 'userSpaceOnUse', x: -2000, y: -2000, width: 4000, height: 4000 }, defs);
  el('rect', { x: -2000, y: -2000, width: 4000, height: 4000, fill: '#fff' }, mask);
  const mFace = el('g', { fill: 'none', stroke: '#000', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mask);
  const mEyes = el('path', { 'stroke-width': 8.4 }, mFace);
  const mMouth = el('path', {}, mFace);
  const back = el('g', {}, backSvg), skin = el('g', {}, frontSvg), front = el('g', {}, frontSvg);

  const E = new Float64Array(6), M = new Float64Array(6);
  let fr = { body: '', face: '' };
  let off = { eyeDy: 0, mouthDx: 0, mouthDy: 0, talk: 0 };
  let crownY = 0, kickY = 0;

  /** Transformaciones del frame actual (mismas cuentas que OrbFace.paint, en px del canvas). */
  const compute = () => {
    const geo = orb.geo, face = orb.face, R = geo.R;
    if (!R) return false;
    const g = face?.g;
    if (g?.init) {
      const fs = scaleFor(R);
      const bs = (g.s * R) / fs / 33;
      const bx = geo.cx + g.ox * R, by = geo.cy + g.oy * R;
      fr.body = `translate(${r2(bx)} ${r2(by)}) scale(${r2(bs * g.sx * 1000) / 1000} ${r2(bs * g.sy * 1000) / 1000}) translate(-60 -60)`;
      const k = (g.s * R) / 33;
      const m = g.m < 0.9999 ? `translate(${r2(geo.cx)} ${r2(geo.cy)}) scale(${r2(g.m * 1000) / 1000}) translate(${r2(-geo.cx)} ${r2(-geo.cy)}) ` : '';
      fr.face = `${m}translate(${r2(face.Cx)} ${r2(face.Cy)}) rotate(${r2((g.tilt * 180) / Math.PI)}) scale(${r2(k * g.sx * 1000) / 1000} ${r2(k * g.sy * 1000) / 1000}) translate(${r2(face.dx)} ${r2(face.jy)}) translate(-60 -60)`;
      const v = face.v;
      off = { eyeDy: 0, mouthDx: 0, mouthDy: clamp(v.my, -2.5, 3.5), talk: clamp(v.mo) };
      crownY = face.jy * 2 + kickY;
      // Máscara: los mismos trazos que pinta la cara (ojos y moneda), un poco más gruesos
      eyeShape(E, 12 * v.eh, clamp(v.ap, 0, 1.2), clamp(v.wh), clamp(v.wt), clamp(v.wc));
      let d = '';
      for (const side of [-1, 1]) {
        const x = 60 + side * 9.5 + v.gx, y = 55 + v.gy;
        d += `M${r2(x + E[0])} ${r2(y + E[1])}Q${r2(x + E[2])} ${r2(y + E[3])} ${r2(x + E[4])} ${r2(y + E[5])}`;
      }
      mEyes.setAttribute('d', d);
      const my = 71 + v.my;
      mouthPoints(M, 60, my, v.mhw, v.mc);
      mMouth.setAttribute('d', `M${r2(M[0])} ${r2(M[1])}Q${r2(M[2])} ${r2(M[3])} ${r2(M[4])} ${r2(M[5])}`);
      mMouth.setAttribute('stroke-width', r2(v.mw * v.ms + 2.4));
      mMouth.setAttribute('transform', v.mo > 0.01 ? `translate(60 ${r2(my)}) scale(${r2(1 - 0.06 * v.mo)} ${r2(1 + 0.5 * v.mo)}) translate(-60 ${r2(-my)})` : '');
      mFace.setAttribute('transform', fr.face);
    } else {
      // Sin cara (FACE_ENABLED apagado): el cuerpo es el blob centrado
      const bs = (R * geo.blobScale) / 33;
      fr.body = `translate(${r2(geo.cx)} ${r2(geo.cy)}) scale(${r2(bs * 1000) / 1000}) translate(-60 -60)`;
      fr.face = `translate(${r2(geo.cx)} ${r2(geo.cy)}) scale(${r2(bs * 0.85 * 1000) / 1000}) translate(-60 -60)`;
      off = { eyeDy: 0, mouthDx: 0, mouthDy: 0, talk: 0 };
      crownY = kickY;
    }
    // Silueta real del blob (72 puntos del frame) para recortar la piel
    if (layer?.hasSkin()) {
      let p = `M${r2(geo.px[0])} ${r2(geo.py[0])}`;
      for (let i = 1; i < geo.n; i++) p += `L${r2(geo.px[i])} ${r2(geo.py[i])}`;
      clipPath.setAttribute('d', `${p}Z`);
    }
    return true;
  };

  const layer = new LookLayer({
    back, skin, front, svg: frontSvg, clipId: `${id}c`, faceMask: orb.face ? `${id}m` : null, tier: 'grande',
    frames: () => fr,
    offsets: () => off,
    energy: () => {
      const f = orb.face;
      if (f?.held) return 0.45; // detrás de la hoja de voz: se calman
      if (orb.mode === 'recording') return 0.5;
      if (f?.cueName === 'ok') return 1.7;
      return 1;
    },
    bodyY: () => crownY,
    light: () => [48.5, 45],
  });

  // Loop propio (lee la geometría que el orbe ya calculó en su frame); en pausa si no se ve o la pestaña está oculta
  let raf = 0, last = 0, visible = true, cfg = {};
  const sizeBoxes = () => {
    const w = orb.w || canvas.clientWidth, h = orb.h || canvas.clientHeight;
    for (const s of [backSvg, frontSvg]) s.setAttribute('viewBox', `0 0 ${r2(w)} ${r2(h)}`);
  };
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    kickY *= Math.exp(-dt * 10);
    if (compute()) layer.render(dt);
    schedule();
  };
  const schedule = () => {
    const want = visible && !document.hidden && canvas.isConnected && !layer.empty;
    if (want && !raf) raf = requestAnimationFrame(tick);
    if (!want) last = 0;
  };
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; schedule(); }) : null;
  io?.observe(body);
  const onVis = () => schedule();
  document.addEventListener('visibilitychange', onVis);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sizeBoxes) : null;
  ro?.observe(canvas);
  sizeBoxes();

  let first = true;
  const off$ = onLook((c) => {
    cfg = c;
    layer.set(cfg, { animate: !first });
    first = false;
    compute();
    layer.render(0);
    schedule();
  });

  return {
    /** Empujón a los resortes (Lukas saltó o lo aplastaron). */
    kick(s = 1) { kickY -= 8 * s; layer.kick(s); schedule(); },
    destroy() {
      off$();
      cancelAnimationFrame(raf);
      io?.disconnect(); ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      layer.destroy();
      backSvg.remove(); frontSvg.remove();
    },
  };
}
