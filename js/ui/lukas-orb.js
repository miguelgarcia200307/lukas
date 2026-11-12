// Lukas, el personaje: orbe índigo con dos ojos (barras) y una moneda lima como boca.
// 100 % código: SVG + requestAnimationFrame. Cada frame escribe atributos directo en el DOM (sin re-render).
// Todo se mueve con PARÁMETROS SUAVIZADOS (v += (objetivo − v)·k·min(1, dt·60)): ningún cambio de estado salta.
// Componente independiente del orbe de la pantalla de voz (comparte colores y la geometría de la cara: face-geometry.js).
import { clamp, lerp, smooth, spring, easeInOutCubic, easeOutCubic, eyePoints, mouthPoints } from './face-geometry.js';
import { onLook, isClassic } from '../lukas/store.js'; // apariencia (accesorios): la capa se carga solo si hay alguno

export { spring, easeInOutCubic, easeOutCubic };
const TAU = Math.PI * 2;
const NS = 'http://www.w3.org/2000/svg';
export const ORB_COLORS = { light: '#ABA3FF', mid: '#5848EE', deep: '#3320C0', lime: '#C8F35A', alert: '#F0997B', halo: '#5B4BF0', paper: '#F6F5F2' };
export const REST_ALPHA = -2.3; // luz arriba a la izquierda
export const SMALL_PX = 40; // por debajo: versión simplificada
// `size` = diámetro del cuerpo (33·2 = 66 unidades). El SVG es más grande (halo, sombra, destello) y sobresale
// centrado sin afectar el layout: caja completa 120 u (×1.818), versión simple 76 u (×1.152).
export const BODY_UNITS = 66;
export const DURATIONS = { intro: 2.0, done: 2.2, error: 1.4 };

// ── Curvas (spring, easeInOutCubic, easeOutCubic, clamp, lerp, smooth: face-geometry.js) ──
const r2 = (v) => Math.round(v * 100) / 100;
/** Equivalente del ángulo de reposo más cercano al actual (termina la vuelta en vez de devolverse). */
export const nearestRest = (a, rest = REST_ALPHA) => rest + TAU * Math.round((a - rest) / TAU);
/** Sacudida compartida por el personaje y los formularios. */
export const shakeX = (t) => 5 * Math.exp(-5 * t) * Math.sin(34 * t);

// ── Geometría ─────────────────────────────────────────────
const N = 48;
const TH = Array.from({ length: N }, (_, i) => (i / N) * TAU);
const COS = TH.map(Math.cos);
const SIN = TH.map(Math.sin);
// FIRMA: silueta fija de piedra pulida (nunca un círculo perfecto)
const SIG = TH.map((t) => 0.035 * Math.sin(2 * t + 0.6) + 0.025 * Math.sin(3 * t + 2.1));
const PX = new Float64Array(N);
const PY = new Float64Array(N);

/** Contorno del orbe: 48 puntos polares cerrados con Catmull-Rom → Bézier cúbicas. */
export function contourPath(scale = 1, amp = 0, phase = 0, b = 0, phi = 0, cx = 60, cy = 60) {
  const R = 33 * scale;
  for (let i = 0; i < N; i++) {
    const t = TH[i];
    const def = amp ? amp * (0.5 * Math.sin(3 * t + phase) + 0.35 * Math.sin(5 * t - 1.3 * phase + 1) + 0.4 * Math.sin(2 * t + 0.7 * phase + 2)) : 0;
    const bul = b ? b * Math.pow((1 + Math.cos(t - phi)) / 2, 4) - 0.22 * b : 0;
    const r = R * (1 + SIG[i] + def + bul);
    PX[i] = cx + r * COS[i];
    PY[i] = cy + r * SIN[i];
  }
  let d = `M${r2(PX[0])} ${r2(PY[0])}`;
  for (let i = 0; i < N; i++) {
    const p0 = (i - 1 + N) % N, p2 = (i + 1) % N, p3 = (i + 2) % N;
    d += `C${r2(PX[i] + (PX[p2] - PX[p0]) / 6)} ${r2(PY[i] + (PY[p2] - PY[p0]) / 6)} ${r2(PX[p2] - (PX[p3] - PX[i]) / 6)} ${r2(PY[p2] - (PY[p3] - PY[i]) / 6)} ${r2(PX[p2])} ${r2(PY[p2])}`;
  }
  return d + 'Z';
}

// Formas de ojo (abierto, feliz, cansado, cerrado "‿"): face-geometry.js
const E = new Float64Array(6);

/** Ojo: un path cuadrático de 3 puntos. */
export function eyePath(x, y, { h = 12, open = 1, grow = 1, happy = 0, tired = 0, closed = 0, gx = 0, gy = 0 } = {}) {
  eyePoints(E, h, open, grow, happy, tired, closed);
  return `M${r2(x + E[0] + gx)} ${r2(y + E[1] + gy)}Q${r2(x + E[2] + gx)} ${r2(y + E[3] + gy)} ${r2(x + E[4] + gx)} ${r2(y + E[5] + gy)}`;
}

/** Boca (la moneda): con hw = 0 es un punto perfecto del diámetro del trazo. */
const M = new Float64Array(6);
export function mouthPath(x, y, hw = 0, c = 0) {
  mouthPoints(M, x, y, hw, c);
  return `M${r2(M[0])} ${r2(M[1])}Q${r2(M[2])} ${r2(M[3])} ${r2(M[4])} ${r2(M[5])}`;
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const LIME = hexRgb(ORB_COLORS.lime), CORAL = hexRgb(ORB_COLORS.alert);
const mixColor = (t) => (t < 0.004 ? ORB_COLORS.lime : t > 0.996 ? ORB_COLORS.alert : `rgb(${LIME.map((v, i) => Math.round(lerp(v, CORAL[i], t))).join(',')})`);

// ── Movimiento reducido (con simulación global para /brand) ──
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const settings = { speed: 1, reducedOverride: null, haptics: true };
export const LukasOrbSettings = {
  get speed() { return settings.speed; },
  set speed(v) { settings.speed = clamp(+v || 1, 0.05, 4); },
  /** null = seguir al sistema; true/false = forzar (simulador de /brand). */
  get reducedOverride() { return settings.reducedOverride; },
  set reducedOverride(v) { settings.reducedOverride = v; wakeAll(); },
  get haptics() { return settings.haptics; },
  set haptics(v) { settings.haptics = !!v; },
};
export const prefersReducedMotion = () => (settings.reducedOverride ?? !!mq?.matches);

// ── Un solo rAF para todos los personajes ─────────────────
const active = new Set();
let raf = 0, last = 0;
function tick(now) {
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60) * settings.speed;
  last = now;
  for (const e of active) e.frame(dt);
  raf = active.size ? requestAnimationFrame(tick) : 0;
  if (!raf) last = 0;
}
function schedule(engine, on) {
  if (on) active.add(engine); else active.delete(engine);
  if (active.size && !raf && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); }
}
const all = new Set();
function wakeAll() { for (const e of all) e.wake(); }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    else if (active.size && !raf) raf = requestAnimationFrame(tick);
  });
  mq?.addEventListener?.('change', wakeAll);
}

// ── Parámetros suavizados ─────────────────────────────────
// Valores de reposo. Ángulos: al y phi (se desenrollan, nunca se normalizan a la fuerza).
const REST = {
  op: 1, sc: 1, br: 0, amp: 0.018, spd: 0.7, b: 0, phi: REST_ALPHA, al: REST_ALPHA,
  q: 0, jy: 0, dx: 0, halo: 1, shadow: 1, shine: 1, ring: 0, ringR: 42, tint: 0,
  ap: 1, grow: 1, eo: 1, wh: 0, wt: 0, wc: 0, gx: 0, gy: 0,
  mhw: 0, mc: 0, mw: 9, my: 71, mx: 60, mcol: 0, flip: 1, mo: 0,
  simp: 0, pull: 0, lx: 0, ly: 0,
};
const KEYS = Object.keys(REST);
const FACE_KEYS = ['wh', 'wt', 'wc', 'gx', 'gy', 'mhw', 'mc', 'mw', 'my', 'mx', 'mcol', 'mo'];
// Reacciones cortas (editor de apariencia): duración en s. Solo en reposo; no cambian nada si nadie las pide.
const FX_DUR = { cosquillas: 1.4, timido: 2.2, arriba: 1.3, ajuste: 0.8, presume: 1.4, feliz: 1.6, pose1: 1.8, pose2: 1.8, pose3: 1.4 };
const FX_HAPPY = new Set(['cosquillas', 'presume', 'feliz', 'pose3']);
const K_BODY = 0.12, K_FACE = 0.14, K_DRIVE = 0.6;
// Suavizado en cascada (dos pasadas de la misma fórmula): arranca con ease-in, sin tirón en el primer frame.
// Solo para parámetros "tranquilos" (k < 0.5); los guiados por curva (salto, sacudida, caída) van directo.
const CASCADE = new Set(['wh', 'wt', 'wc', 'gx', 'gy', 'mhw', 'mc', 'mw', 'my', 'mx', 'mcol', 'sc', 'halo', 'shine', 'shadow', 'lx', 'ly', 'simp', 'b', 'amp']);
const SHINE_R = 25; // fuera del alcance de los ojos incluso con la mirada girando en procesando

let uid = 0;
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
};

/**
 * Motor del personaje. Se monta dentro de `host` (cualquier elemento).
 * opts: { state, size, simple, mood, onSequenceEnd, onEvent }
 */
export class LukasOrbEngine {
  constructor(host, { state = 'rest', size = 96, simple = null, mood = 'neutral', onSequenceEnd = null, onEvent = null } = {}) {
    this.host = host;
    this.size = size;
    this.simple = simple ?? size < SMALL_PX;
    this.mood = mood;
    this.onSequenceEnd = onSequenceEnd;
    this.onEvent = onEvent;
    this.t = 0; // reloj propio (s)
    this.tau = 0; // tiempo en el estado actual
    this.phase = 0; // fase de deformación acumulada
    this.v = { ...REST };
    this.m = { ...REST }; // etapa intermedia de la cascada
    this.T = { ...REST };
    this.K = {};
    this.visible = true;
    this.running = false;
    this.hapticDone = false;
    this.blink = { next: 1.6 + Math.random() * 2, start: -1, second: false };
    this.ghost = 0; // crossfade (movimiento reducido)
    this.faceKey = '';
    this.rm = prefersReducedMotion();
    this.build();
    this.state = state;
    this.enterState(state, true);
    this.computeTargets(0);
    if (this.simple) this.T.simp = 1;
    Object.assign(this.v, this.T);
    Object.assign(this.m, this.T);
    this.render();
    all.add(this);
    this.io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((es) => { this.visible = es[es.length - 1].isIntersecting; this.wake(); }, { rootMargin: '40px' })
      : null;
    this.io?.observe(host);
    this.wake();
  }

  build() {
    const id = `lk${++uid}`;
    const simple = this.simple;
    const vbSize = simple ? 76 : 120;
    const vb0 = 60 - vbSize / 2;
    const svg = el('svg', { viewBox: `${vb0} ${vb0} ${vbSize} ${vbSize}`, role: 'img', 'aria-label': 'Lukas', class: 'lukas-orb-svg', focusable: 'false' });
    const k = vbSize / BODY_UNITS;
    const off = `${r2(((1 - k) / 2) * 100)}%`;
    Object.assign(svg.style, { position: 'absolute', left: off, top: off, width: `${r2(k * 100)}%`, height: `${r2(k * 100)}%`, pointerEvents: 'none' });
    const defs = el('defs', {}, svg);
    const g = el('radialGradient', { id: `${id}b`, r: '0.78' }, defs);
    el('stop', { offset: '0', 'stop-color': ORB_COLORS.light }, g);
    el('stop', { offset: '0.5', 'stop-color': ORB_COLORS.mid }, g);
    el('stop', { offset: '1', 'stop-color': ORB_COLORS.deep }, g);
    const hg = el('radialGradient', { id: `${id}h` }, defs);
    el('stop', { offset: '0', 'stop-color': ORB_COLORS.halo, 'stop-opacity': '0.22' }, hg);
    el('stop', { offset: '1', 'stop-color': ORB_COLORS.halo, 'stop-opacity': '0' }, hg);
    const sg = el('radialGradient', { id: `${id}s` }, defs);
    el('stop', { offset: '0', 'stop-color': ORB_COLORS.deep, 'stop-opacity': '0.22' }, sg);
    el('stop', { offset: '1', 'stop-color': ORB_COLORS.deep, 'stop-opacity': '0' }, sg);

    const root = el('g', {}, svg);
    const shadow = el('ellipse', { cx: 60, cy: 102, rx: 28, ry: 4.5, fill: `url(#${id}s)` }, root);
    const move = el('g', {}, root);
    const halo = el('circle', { cx: 60, cy: 60, r: 52, fill: `url(#${id}h)` }, move);
    const ring = el('circle', { cx: 60, cy: 60, r: 42, fill: 'none', stroke: ORB_COLORS.lime, 'stroke-width': 2.5, opacity: 0 }, move);
    const squash = el('g', {}, move);
    const body = el('path', { fill: `url(#${id}b)` }, squash);
    const tint = el('path', { fill: ORB_COLORS.alert, opacity: 0 }, squash);
    const shine = el('ellipse', { rx: 7, ry: 4, fill: '#fff', opacity: 0.28 }, squash);
    const face = el('g', {}, squash);
    const mkFace = (parent) => {
      const f = el('g', {}, parent);
      const common = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      return {
        g: f,
        eyeL: el('path', { ...common, stroke: '#fff' }, f),
        eyeR: el('path', { ...common, stroke: '#fff' }, f),
        mouth: el('path', { ...common, stroke: ORB_COLORS.lime }, f),
      };
    };
    const live = mkFace(face);
    const ghost = mkFace(face);
    ghost.g.setAttribute('opacity', 0);
    if (simple) for (const n of [shadow, halo, ring, shine]) n.style.display = 'none';
    this.n = { svg, grad: g, root, shadow, move, halo, ring, squash, body, tint, shine, face, live, ghost };
    this.host.appendChild(svg);
  }

  // ── API ──
  play(state) {
    if (!state) return;
    if (this.held) { this.heldPending = state; return; } // congelado: se aplica al soltar
    if (this.simple && (state === 'intro' || state === 'done' || state === 'error')) {
      // Versión pequeña: solo reposo y procesando
      const prev = state;
      this.setState('rest');
      queueMicrotask(() => this.endSequence(prev, true));
      return;
    }
    this.setState(state);
  }
  think() { this.play('thinking'); }
  succeed() { this.play('done'); }
  fail() { this.play('error'); }
  cancel() { this.play('rest'); }
  setMood(mood = 'neutral') { this.mood = mood; this.wake(); }
  /** Mirada externa normalizada (−1..1). */
  lookAt(x = 0, y = 0) { this.T.lx = clamp(x, -1, 1); this.T.ly = clamp(y, -1, 1); this.wake(); }
  /** Mira hacia el centro de otro elemento. */
  lookAtElement(target) {
    if (!target) return this.lookAt(0, 0);
    const a = this.host.getBoundingClientRect(), b = target.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    this.lookAt(dx / d, dy / d);
  }
  /** Pull-to-refresh: 0..1 (estira y abre más los ojos). */
  setPull(p) { this.T.pull = clamp(p, 0, 1.2); this.wake(); }
  /** Lukas habla (burbuja del editor): la moneda se abre y se cierra como en el orbe de voz. */
  talk(on = true) { this.talking = !!on; this.wake(); }
  /** Reacción corta en reposo: 'cosquillas' | 'timido' | 'arriba' | 'ajuste' | 'presume' | 'feliz' | 'pose1..3'. */
  react(name) {
    if (!FX_DUR[name]) return;
    if (this.state === 'done' || this.state === 'error') this.setState('rest'); // la reacción nueva manda
    this.fx = { name, t0: this.t };
    if (name === 'cosquillas' || name === 'feliz' || name === 'presume') this.layer?.kick(1);
    this.wake();
  }
  /** Energía de los accesorios: más con alegría, tranquilos al procesar o con error. */
  get energy() {
    if (this.fx && FX_HAPPY.has(this.fx.name)) return 1.7;
    return this.state === 'done' ? 1.7 : this.state === 'thinking' ? 0.6 : this.state === 'error' ? 0.45 : 1;
  }
  /** Apariencia (IDs y colores ya validados). La capa de accesorios se importa solo si hace falta. */
  setLook(cfg, { animate, quick = false } = {}) {
    this.lookCfg = cfg ?? {};
    // Fuera de pantalla (dormido) el cambio es inmediato: nadie vería la animación y no quedan piezas a medio salir
    const anim = (animate ?? !!this.lookSeen) && this.running;
    this.lookSeen = true;
    if (this.layer) { this.layer.set(this.lookCfg, { animate: anim, quick }); this.render(); this.wake(); return; }
    if (isClassic(this.lookCfg) && !this.wantLayer) return;
    this.loadLayer(anim);
  }
  /** Fuerza la capa aunque Lukas esté clásico (rubor de tímido en el editor). */
  useLayer() { this.wantLayer = true; if (!this.layer) this.loadLayer(false); }
  loadLayer(anim) {
    if (this.layerLoading || this.destroyed) return;
    this.layerLoading = import('../lukas/layer.js').then((m) => {
      if (this.destroyed || this.layer) return;
      this.layer = m.attachEngine(this);
      this.layer.set(this.lookCfg ?? {}, { animate: anim });
      this.render();
      this.wake();
    }).catch((e) => console.error(e)).finally(() => { this.layerLoading = null; });
  }
  /**
   * Congela al personaje en reposo, sin parpadeo ni animación (mientras la hoja de voz está abierta: nunca reaccionan
   * los dos a la vez). Los estados pedidos mientras tanto se aplican al soltar. Sin llamarlo, nada cambia.
   */
  hold(on = true) {
    on = !!on;
    if (on === !!this.held) return;
    if (on) {
      this.heldPending = this.state === 'thinking' ? 'thinking' : null;
      if (this.state !== 'rest') this.setState('rest');
      this.blink.start = -1;
      this.held = true;
    } else {
      this.held = false;
      const s = this.heldPending;
      this.heldPending = null;
      this.blink.next = this.t + 1.2 + Math.random() * 1.6;
      if (s && s !== this.state) this.play(s);
    }
    this.wake();
  }
  /** 0 = completo, 1 = cara simplificada (para viajar al header sin corte). */
  setSimplify(s) { this.T.simp = clamp(s); this.wake(); }

  /** Continúa exactamente donde va otro personaje (aterrizaje de una transición compartida: sin corte). */
  adopt(src) {
    if (!src) return;
    Object.assign(this.v, src.v);
    Object.assign(this.m, src.m);
    this.t = src.t; this.phase = src.phase;
    this.blink = { ...src.blink };
    this.T.simp = this.simple ? 1 : src.T.simp;
    this.render();
    this.wake();
  }

  setState(state) {
    const prev = this.state;
    this.state = state;
    this.enterState(state, false, prev);
    this.host.dispatchEvent?.(new CustomEvent('statechange', { detail: { state, prev } }));
    this.wake();
  }

  enterState(state, initial, prev) {
    this.tau = 0;
    this.hapticDone = false;
    this.introBlinkSent = false;
    if (state === 'thinking') this.spinBase = initial ? -Math.PI / 2 : this.v.al;
    if (state === 'rest' && !initial) this.blink.next = this.t + 1.2 + Math.random() * 1.6;
    if (state === 'intro') {
      this.blink.start = -1;
      // Repetir la intro con el personaje visible: 200 ms de fundido antes de reconstruirlo (nunca teletransporta)
      if (!initial && this.v.op > 0.05 && this.v.sc > 0.05) this.tau = -0.2;
    }
    if (initial && state === 'intro') this.introFresh = true;
    // Accesibilidad: aria-busy y texto sr-only solo procesando
    const busy = state === 'thinking';
    this.host.toggleAttribute?.('aria-busy', busy);
    if (busy) this.host.setAttribute('aria-busy', 'true');
    this.onEvent?.('state', state, prev);
  }

  endSequence(state, immediate) {
    if (!immediate) this.setState('rest');
    this.onSequenceEnd?.(state);
    this.host.dispatchEvent?.(new CustomEvent('sequenceend', { detail: { state } }));
  }

  wake() {
    const connected = this.host.isConnected !== false;
    if (connected && !this.destroyed) all.add(this); else all.delete(this);
    const want = this.visible && !this.destroyed && connected;
    if (want && !this.running) { this.running = true; schedule(this, true); }
    else if (!want && this.running) { this.running = false; schedule(this, false); }
  }

  destroy() {
    this.destroyed = true;
    this.layer?.destroy();
    this.layer = null;
    this.io?.disconnect();
    all.delete(this);
    this.wake();
    this.n.svg.remove();
  }

  // ── Frame ──
  frame(dt) {
    this.t += dt;
    this.tau += dt;
    const rm = prefersReducedMotion();
    this.rm = rm;
    const rebuilt = this.state === 'intro' && this.tau >= 0 && this.tau - dt < 0 && this.v.op < 0.2;
    this.computeTargets(dt);
    const v = this.v, m = this.m, T = this.T, K = this.K;
    if (rebuilt) { Object.assign(v, T); Object.assign(m, T); this.phase = 0; } // invisible: op ≈ 0, cuerpo en 0
    // Suavizado universal (dt-correcto): v += (objetivo − v)·k·min(1, dt·60)
    const f = Math.min(1, dt * 60);
    for (const k of KEYS) {
      const base = K[k] ?? K_BODY;
      if (base < 0.5 && CASCADE.has(k)) {
        const k2 = Math.min(1, base * 1.7 * f);
        m[k] += (T[k] - m[k]) * k2;
        v[k] += (m[k] - v[k]) * k2;
      } else {
        const kk = Math.min(1, base * f);
        v[k] += (T[k] - v[k]) * kk;
        m[k] = v[k];
      }
    }
    this.phase += v.spd * dt; // la fase se ACUMULA
    if (rm) this.crossfade(dt);
    else if (this.ghost) { this.ghost = 0; this.n.ghost.g.setAttribute('opacity', 0); this.n.live.g.setAttribute('opacity', 1); }
    this.lastDt = dt;
    this.render();
    // Fin de secuencias
    const dur = DURATIONS[this.state];
    if (dur && this.tau >= dur) this.endSequence(this.state);
    // Dormir cuando no hay nada que animar (iconos pequeños en reposo)
    if ((this.simple || this.held) && this.state === 'rest' && !this.ghost && !this.fx && !this.layer?.busy) {
      let still = true;
      for (const k of KEYS) if (Math.abs(T[k] - v[k]) > 0.002) { still = false; break; }
      if (still) { this.running = false; schedule(this, false); }
    }
  }

  // Movimiento reducido: las expresiones cambian con crossfade de 200 ms
  crossfade(dt) {
    const key = this.faceKeyNow;
    if (key !== this.faceKey) {
      if (this.faceKey) {
        const { live, ghost } = this.n;
        for (const p of ['eyeL', 'eyeR', 'mouth']) {
          for (const a of ['d', 'stroke', 'stroke-width', 'transform']) {
            const val = live[p].getAttribute(a);
            if (val == null) ghost[p].removeAttribute(a); else ghost[p].setAttribute(a, val);
          }
        }
        this.ghost = 1;
        for (const k of FACE_KEYS) this.v[k] = this.m[k] = this.T[k]; // la cara nueva aparece ya formada
      }
      this.faceKey = key;
    }
    if (this.ghost > 0) {
      this.ghost = Math.max(0, this.ghost - dt / 0.2);
      this.n.ghost.g.setAttribute('opacity', r2(this.ghost));
      this.n.live.g.setAttribute('opacity', r2(1 - this.ghost));
    }
  }

  computeTargets(dt) {
    const T = this.T, K = this.K;
    const t = this.t, tau = this.tau;
    const rm = !!this.rm;
    const motion = rm || this.held ? 0 : 1;
    const full = 1 - T.simp; // detalle (halo, brillo, deformación) que se apaga en la versión simple
    for (const k in K) delete K[k];
    const keepSimp = T.simp, keepPull = T.pull, keepLx = T.lx, keepLy = T.ly;

    // Base: reposo (con humor)
    Object.assign(T, REST);
    T.simp = keepSimp; T.pull = keepPull; T.lx = keepLx; T.ly = keepLy;
    T.al = nearestRest(this.v.al);
    T.phi = nearestRest(this.v.phi);
    K.al = 0.08; K.phi = 0.08;
    T.ringR = this.v.ringR; // el destello se desvanece sin encogerse si se interrumpe
    K.simp = 0.14; K.pull = 0.45; K.lx = 0.08; K.ly = 0.08;
    T.br = 0.015 * Math.sin(t * 1.7) * motion * full;
    T.amp = 0.018 * motion * full;
    T.halo = full; T.shadow = full; T.shine = full;
    T.gx = 1.6 * Math.sin(0.7 * t) * Math.sin(0.31 * t) * motion * full;
    T.gy = 0.9 * Math.sin(0.53 * t) * motion * full;
    T.my = 71 + 0.6 * Math.sin(t * 1.1 + 1) * motion * full;
    for (const k of FACE_KEYS) K[k] = K_FACE;
    let face = 'rest';
    let blinkOn = !this.simple && !this.held;

    const mood = this.mood;
    const applyMood = () => {
      if (mood === 'tired') {
        T.wt = 1; T.gy += 1.4; T.gx *= 0.4;
        T.mhw = 3.2; T.mc = 0.4; T.mw = 5; face = 'tired';
      } else if (mood === 'closed') {
        T.wc = 1; T.gx = 0; T.gy = 0.4; T.br *= 0.7; face = 'closed';
        blinkOn = false;
      }
    };

    switch (this.state) {
      case 'rest':
        applyMood();
        break;

      case 'intro': {
        blinkOn = false;
        const s = this.simple;
        if (tau < 0) {
          applyMood();
          T.op = 0; K.op = 0.35;
          face = 'rest';
          break;
        }
        if (rm || s) {
          // Aparición tranquila: fundido, sin caída ni rebote
          T.op = smooth(0, 0.5, tau);
          T.eo = smooth(0.45, 0.8, tau);
          K.op = 0.5; K.eo = 0.5;
        } else {
          // 0–600 ms: la moneda cae girando de canto y rebota
          T.my = -19 + 90 * spring(tau / 0.6);
          const settle = smooth(0.42, 0.66, tau);
          T.flip = lerp(Math.abs(Math.cos(tau * 15)), 1, settle);
          // 250–1050 ms: el orbe se infla detrás, líquido
          T.sc = spring((tau - 0.25) / 0.8);
          if (tau > 0.25) { T.amp = 0.018 + 0.24 * Math.exp(-3.5 * (tau - 0.25)); T.spd = 7; }
          else T.amp = 0.26;
          T.br = 0;
          // 300–900 ms: halo y sombra
          T.halo = smooth(0.3, 0.9, tau) * full;
          T.shadow = smooth(0.3, 0.9, tau) * full;
          T.shine = smooth(0.5, 1.0, tau) * full;
          // 850–1300 ms: los ojos crecen desde abajo
          T.grow = spring((tau - 0.85) / 0.45);
          T.eo = smooth(0.84, 0.92, tau);
          T.gx = 0; T.gy = 0;
          for (const k of ['my', 'flip', 'sc', 'amp', 'spd', 'halo', 'shadow', 'shine', 'grow', 'eo', 'br']) K[k] = K_DRIVE;
          K.spd = 1; K.amp = 0.5;
        }
        // 1500 ms: primer parpadeo (160 ms). Está vivo.
        if (tau >= 1.5 && this.blink.start < 0) this.startBlink(false);
        if (tau >= 1.66 && !this.introBlinkSent) {
          this.introBlinkSent = true;
          this.host.dispatchEvent?.(new CustomEvent('introblink'));
          this.onEvent?.('introblink');
        }
        face = 'intro';
        break;
      }

      case 'thinking': {
        blinkOn = false;
        const u = tau / 1.2, n = Math.floor(u), f = u - n;
        const ang = this.spinBase + TAU * (n + easeInOutCubic(f)); // acelera y frena, nunca lineal
        if (rm) {
          // La luz pulsa suave
          const p = 0.5 + 0.5 * Math.sin(t * 2.4);
          T.halo = (0.55 + 0.45 * p) * full; T.shine = (0.6 + 0.4 * p) * full;
          T.gx = 0; T.gy = 0;
        } else {
          T.al = ang; K.al = 0.35;
          T.phi = ang; K.phi = 0.35;
          T.amp = 0.045 * full; T.spd = 2.6; T.b = 0.14 * full; K.b = 0.1; K.amp = 0.1;
          T.halo = (0.8 + 0.2 * Math.sin(t * 5)) * full;
          T.br = 0;
          T.gx = 3 * Math.cos(ang); T.gy = 2.2 * Math.sin(ang);
          K.gx = 0.3; K.gy = 0.3;
          T.mx = 60 + 1.6 * Math.cos(ang) * full;
          T.my = 71;
        }
        T.ap = 0.78;
        T.mw = 6.5; // concentrado
        face = 'think';
        break;
      }

      case 'done': {
        blinkOn = false;
        if (!rm) {
          if (tau < 0.5) {
            const x = tau / 0.5;
            T.jy = -9 * 4 * x * (1 - x);
            T.q = -0.05 * Math.sin(Math.PI * x);
          } else {
            const d = tau - 0.5;
            T.q = 0.13 * Math.exp(-5.5 * d) * Math.cos(13 * d);
            if (!this.hapticDone) {
              this.hapticDone = true;
              if (settings.haptics && navigator.userActivation?.hasBeenActive !== false) try { navigator.vibrate?.(10); } catch { /* sin soporte */ }
              this.onEvent?.('land');
            }
          }
          K.jy = K_DRIVE; K.q = K_DRIVE;
          T.br = 0;
          if (tau >= 0.45 && tau <= 1.15) {
            const p = (tau - 0.45) / 0.7;
            T.ringR = 42 + 16 * easeOutCubic(p);
            T.ring = 0.7 * (1 - p) * full;
            K.ringR = 1; K.ring = K_DRIVE;
          } else if (tau < 0.45 && this.v.ring < 0.02) { T.ringR = 42; K.ringR = 1; }
        }
        if (tau < 1.7) {
          T.wh = 1; T.gx = 0; T.gy = -0.6;
          T.mhw = 8.5; T.mc = 7.5; T.mw = 5.2; T.my = 69;
          K.wh = 0.16; K.mhw = 0.15; K.mc = 0.15; K.mw = 0.15; K.my = 0.15;
          face = 'happy';
        } else applyMood();
        break;
      }

      case 'error': {
        blinkOn = false;
        if (!rm) {
          T.dx = shakeX(tau); K.dx = 0.75;
          T.br = -0.05 * Math.exp(-4 * tau); K.br = K_DRIVE;
        }
        T.tint = 0.38 * (1 - clamp(tau / 0.9)); K.tint = 0.5;
        if (tau < 1.1) {
          T.wt = 1; T.gx = 0; T.gy = 1.6;
          T.mhw = 4.8; T.mc = -3; T.mw = 4.4; T.my = 73; T.mcol = 1;
          K.wt = 0.18; K.mhw = 0.15; K.mc = 0.15; K.mw = 0.15; K.my = 0.15; K.mcol = 0.18;
          face = 'worried';
        } else applyMood();
        break;
      }
    }

    // Reacciones del editor (solo en reposo)
    this.blushAmount = Math.max(0, (this.blushAmount ?? 0) - (this.fx?.name === 'timido' ? 0 : 1.6 * (dt || 0)));
    const fx = this.fx;
    if (fx) {
      const e = t - fx.t0;
      if (e >= FX_DUR[fx.name] || this.state !== 'rest') this.fx = null;
      else {
        const smile = (hw, c, w, y = 70) => { T.mhw = hw; T.mc = c; T.mw = w; T.my = y; K.mhw = 0.22; K.mc = 0.22; K.mw = 0.22; K.my = 0.22; };
        switch (fx.name) {
          case 'cosquillas': {
            blinkOn = false; T.wh = 1; T.gx = 0; T.gy = -0.4; K.wh = 0.3; smile(8.5, 7.5, 5.2, 69);
            if (motion) {
              const d = Math.exp(-1.4 * e);
              T.dx = 1.8 * Math.sin(e * 46) * d; T.br = 0.03 * Math.sin(e * 30) * d; T.jy = -2.4 * Math.abs(Math.sin(e * 13)) * d;
              T.mo = 0.3 + 0.3 * Math.sin(e * 24); K.dx = 0.75; K.br = K_DRIVE; K.jy = K_DRIVE; K.mo = 0.5;
            }
            face = 'tickle';
            break;
          }
          case 'timido':
            this.blushAmount = Math.min(1, (this.blushAmount ?? 0) + 2.5 * (dt || 0.016));
            T.wh = 0.35; T.gx = -2.4; T.gy = 2.4; smile(2.6, 1.2, 5, 72);
            if (motion) { T.q = 0.035; K.q = 0.12; T.sc = 0.97; }
            face = 'shy';
            break;
          case 'arriba':
            T.gx *= 0.2; T.gy = -2.2; K.gy = 0.2;
            if (motion && e < 0.5) { T.jy = -3 * Math.sin((Math.PI * e) / 0.5); K.jy = K_DRIVE; }
            face = 'up';
            break;
          case 'ajuste':
            if (e < 0.09) { T.ap = 0; K.ap = 0.55; }
            if (motion) { T.q = 0.11 * Math.exp(-6 * e) * Math.cos(16 * e); K.q = K_DRIVE; }
            smile(3, 1.6, 6, 70.5);
            face = 'adjust';
            break;
          case 'presume':
            blinkOn = false; T.wh = 1; smile(6.5, 5, 5.6);
            if (motion) { T.jy = -2.4 * Math.sin(Math.min(1, e / 0.6) * Math.PI); K.jy = K_DRIVE; }
            face = 'proud';
            break;
          case 'feliz': blinkOn = false; T.wh = 1; smile(8, 7, 5.4, 69.5); face = 'happy2'; break;
          case 'pose1': T.gx += -3; T.gy += -1.6; smile(6, 4.6, 5.6); if (motion) { T.q = -0.04; K.q = 0.12; } face = 'pose1'; break;
          case 'pose2': T.gx += 3; T.gy += 0.6; T.wh = 0.55; smile(4.6, 3, 6); if (motion) { T.q = 0.05; K.q = 0.12; } face = 'pose2'; break;
          case 'pose3':
            blinkOn = false; T.wh = 1; smile(7.6, 6.4, 5.4);
            if (motion && e < 0.6) { T.jy = -5 * Math.sin((Math.PI * e) / 0.6); K.jy = K_DRIVE; }
            face = 'pose3';
            break;
          default: break;
        }
      }
    }
    // Habla (burbuja): la moneda se abre con un nivel de voz sintético, como el orbe de voz al responder
    if (this.talking && motion && !(this.fx && this.fx.name === 'cosquillas')) { T.mo = Math.min(1, Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1)) * 1.6); K.mo = 0.35; }

    // Mirada externa (estados vacíos) y pull-to-refresh
    T.gx += 3.4 * T.lx;
    T.gy += 3 * T.ly;
    if (T.lx || T.ly) face += `:${Math.round(T.lx * 4)},${Math.round(T.ly * 4)}`;

    // Parpadeo: cierra rápido (k 0.55), abre más lento (k 0.3); a veces doble
    const b = this.blink;
    if (blinkOn && this.state === 'rest' && t >= b.next && b.start < 0) this.startBlink(true);
    if (b.start >= 0) {
      const e = t - b.start;
      if (e < 0.075) { T.ap = 0; K.ap = 0.55; }
      else { K.ap = 0.3; if (e > 0.32) b.start = -1; }
    }
    if (!K.ap) K.ap = 0.2;

    if (rm) {
      // Sin deformación, vueltas, saltos ni sacudidas
      T.amp = 0; T.b = 0; T.q = 0; T.jy = 0; T.dx = 0; T.ring = 0;
      T.br = 0;
      T.al = nearestRest(this.v.al); T.phi = T.al;
      for (const k of FACE_KEYS) K[k] = 1;
    }
    this.faceKeyNow = face;
  }

  startBlink(scheduleNext) {
    const b = this.blink;
    b.start = this.t;
    if (scheduleNext) {
      if (!b.second && Math.random() < 0.18) { b.next = this.t + 0.36; b.second = true; }
      else { b.next = this.t + 3.9 + (Math.random() - 0.5) * 1.4; b.second = false; }
    }
  }

  render() {
    const v = this.v, n = this.n;
    const simp = clamp(v.simp);
    const full = 1 - simp;
    // Cuerpo
    const sc = Math.max(0, v.sc * (1 + v.br));
    if (sc < 0.004) n.body.setAttribute('d', 'M60 60Z');
    else {
      const d = contourPath(sc, Math.max(0, v.amp) * full, this.phase, Math.max(0, v.b) * full, v.phi);
      n.body.setAttribute('d', d);
      if (v.tint > 0.004) n.tint.setAttribute('d', d);
    }
    n.tint.setAttribute('opacity', r2(Math.max(0, v.tint)));
    // Luz
    const ca = Math.cos(v.al), sa = Math.sin(v.al);
    const gx = r2(0.5 + 0.18 * ca), gy = r2(0.5 + 0.18 * sa);
    n.grad.setAttribute('cx', gx); n.grad.setAttribute('cy', gy);
    n.grad.setAttribute('fx', gx); n.grad.setAttribute('fy', gy);
    if (!this.simple) {
      const so = 0.28 * clamp(v.shine) * clamp(sc);
      n.shine.setAttribute('opacity', r2(so));
      if (so > 0.003) {
        // Brillo especular en el "hombro" del orbe (a 0.62 R): con 8.8/12 quedaba entre los ojos
        const sx = r2(60 + SHINE_R * ca * sc), sy = r2(60 + SHINE_R * sa * sc);
        n.shine.setAttribute('cx', sx);
        n.shine.setAttribute('cy', sy);
        n.shine.setAttribute('transform', `rotate(${r2((v.al * 180) / Math.PI + 90)} ${sx} ${sy})`);
      }
      // Halo y destello
      n.halo.setAttribute('opacity', r2(clamp(v.halo)));
      n.ring.setAttribute('opacity', r2(clamp(v.ring)));
      n.ring.setAttribute('r', r2(v.ringR));
      // Sombra: se achica y aclara al saltar
      const h = clamp(-v.jy / 9, 0, 1.4);
      n.shadow.setAttribute('rx', r2(28 * (1 - 0.3 * h) * clamp(v.sc, 0, 1.2)));
      n.shadow.setAttribute('ry', r2(4.5 * (1 - 0.2 * h)));
      n.shadow.setAttribute('opacity', r2(clamp(v.shadow) * (1 - 0.45 * h)));
      n.shadow.setAttribute('transform', `translate(${r2(v.dx)} 0)`);
    }
    // Pull-to-refresh: se estira y abre más los ojos
    const pull = v.pull;
    const q = v.q - 0.1 * pull;
    n.move.setAttribute('transform', `translate(${r2(v.dx)} ${r2(v.jy + 3 * pull)})`);
    n.squash.setAttribute('transform', `translate(60 94) scale(${r2(1 + q)} ${r2(1 - q)}) translate(-60 -94)`);
    n.root.setAttribute('opacity', r2(clamp(v.op)));
    // Cara: respira con el cuerpo
    const fs = 1 + v.br * 0.7;
    n.face.setAttribute('transform', `translate(60 60) scale(${Math.round(fs * 1000) / 1000}) translate(-60 -60)`);
    // Ojos
    const eyeW = lerp(6, 8, simp), eyeH = lerp(12, 13, simp) * (1 + 0.35 * pull);
    const ey = lerp(55, 52.5, simp);
    const opts = { h: eyeH, open: clamp(v.ap, 0, 1.2), grow: Math.max(0, v.grow), happy: clamp(v.wh), tired: clamp(v.wt), closed: clamp(v.wc), gx: v.gx * lerp(1, 0.75, simp), gy: (v.gy + 1.2 * pull) * lerp(1, 0.75, simp) };
    const L = n.live;
    L.eyeL.setAttribute('d', eyePath(50.5, ey, opts));
    L.eyeR.setAttribute('d', eyePath(69.5, ey, opts));
    const ew = r2(eyeW * clamp(v.eo) * Math.min(1, 0.4 + v.grow * 2));
    L.eyeL.setAttribute('stroke-width', ew);
    L.eyeR.setAttribute('stroke-width', ew);
    L.eyeL.setAttribute('opacity', r2(clamp(v.eo)));
    L.eyeR.setAttribute('opacity', r2(clamp(v.eo)));
    // Boca (moneda)
    const mw = v.mw * (v.mhw < 1 ? lerp(1, 12 / 9, simp) : lerp(1, 1.2, simp));
    const my = v.my + 3 * simp;
    L.mouth.setAttribute('d', mouthPath(v.mx, my, v.mhw, v.mc));
    L.mouth.setAttribute('stroke-width', r2(mw));
    L.mouth.setAttribute('stroke', mixColor(clamp(v.mcol)));
    const flip = clamp(v.flip, 0.02, 1);
    const mo = clamp(v.mo);
    if (flip < 0.999) L.mouth.setAttribute('transform', `translate(${r2(v.mx)} ${r2(my)}) scale(${r2(flip)} 1) translate(${r2(-v.mx)} ${r2(-my)})`);
    else if (mo > 0.01) L.mouth.setAttribute('transform', `translate(${r2(v.mx)} ${r2(my)}) scale(${r2(1 - 0.06 * mo)} ${r2(1 + 0.5 * mo)}) translate(${r2(-v.mx)} ${r2(-my)})`);
    else L.mouth.removeAttribute('transform');
    // Accesorios: mismo frame, mismos parámetros suavizados
    if (this.layer) { this.layer.render(this.lastDt || 0); this.lastDt = 0; }
  }
}

/**
 * SVG estático del personaje en reposo (íconos, splash de iOS, página sin conexión). Sin DOM: corre en Node.
 * { simple: cara simplificada y viewBox recortado · mood: 'neutral' | 'tired' · id: prefijo de ids }
 */
export function staticOrbSvg({ simple = true, mood = 'neutral', id = 'lk' } = {}) {
  const simp = simple ? 1 : 0;
  const ca = Math.cos(REST_ALPHA), sa = Math.sin(REST_ALPHA);
  const g = r2(0.5 + 0.18 * ca), gy = r2(0.5 + 0.18 * sa);
  const tired = mood === 'tired' ? 1 : 0;
  const eye = { h: lerp(12, 13, simp), tired, gy: tired * 1.4 * lerp(1, 0.75, simp) };
  const ey = lerp(55, 52.5, simp);
  const ew = lerp(6, 8, simp);
  const mhw = tired ? 3.2 : 0, mc = tired ? 0.4 : 0;
  const mw = tired ? 5 * lerp(1, 1.2, simp) : 9 * lerp(1, 12 / 9, simp);
  const my = 71 + 3 * simp;
  const vb = simple ? '22 22 76 76' : '0 0 120 120';
  const shine = simple ? '' : `<ellipse cx="${r2(60 + SHINE_R * ca)}" cy="${r2(60 + SHINE_R * sa)}" rx="7" ry="4" fill="#fff" opacity="0.28" transform="rotate(${r2((REST_ALPHA * 180) / Math.PI + 90)} ${r2(60 + SHINE_R * ca)} ${r2(60 + SHINE_R * sa)})"/>`;
  const extras = simple ? '' : `<radialGradient id="${id}h"><stop offset="0" stop-color="${ORB_COLORS.halo}" stop-opacity="0.22"/><stop offset="1" stop-color="${ORB_COLORS.halo}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}s"><stop offset="0" stop-color="${ORB_COLORS.deep}" stop-opacity="0.22"/><stop offset="1" stop-color="${ORB_COLORS.deep}" stop-opacity="0"/></radialGradient>`;
  const under = simple ? '' : `<ellipse cx="60" cy="102" rx="28" ry="4.5" fill="url(#${id}s)"/><circle cx="60" cy="60" r="52" fill="url(#${id}h)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><defs>
    <radialGradient id="${id}b" r="0.78" cx="${g}" cy="${gy}" fx="${g}" fy="${gy}"><stop offset="0" stop-color="${ORB_COLORS.light}"/><stop offset="0.5" stop-color="${ORB_COLORS.mid}"/><stop offset="1" stop-color="${ORB_COLORS.deep}"/></radialGradient>${extras}</defs>
    ${under}<path d="${contourPath(1)}" fill="url(#${id}b)"/>${shine}
    <g fill="none" stroke-linecap="round"><path d="${eyePath(50.5, ey, eye)}" stroke="#fff" stroke-width="${ew}"/><path d="${eyePath(69.5, ey, eye)}" stroke="#fff" stroke-width="${ew}"/>
    <path d="${mouthPath(60, my, mhw, mc)}" stroke="${ORB_COLORS.lime}" stroke-width="${r2(mw)}"/></g></svg>`;
}

/** think() al empezar; succeed() o fail() según el resultado. */
export function withOrb(orb, promise) {
  const o = orb?.engine ?? orb;
  o?.think();
  return Promise.resolve(typeof promise === 'function' ? promise() : promise).then(
    (r) => { o?.succeed(); return r; },
    (e) => { o?.fail(); throw e; },
  );
}

// ── Custom elements ───────────────────────────────────────
// <lukas-orb state="intro|rest|thinking|done|error" size="48" mood="neutral|tired|closed"></lukas-orb>
// size = diámetro del personaje en px (el halo y la sombra sobresalen sin ocupar espacio)
// Métodos: play(s), think(), succeed(), fail(), cancel(), setMood(m), lookAt(x,y), lookAtElement(el), setPull(p)
// Eventos: sequenceend {detail:{state}}, introblink, statechange
if (typeof customElements !== 'undefined' && !customElements.get('lukas-orb')) {
  class LukasOrbElement extends HTMLElement {
    static get observedAttributes() { return ['state', 'mood']; }
    connectedCallback() {
      if (!this.engine) {
        const size = +this.getAttribute('size') || 96;
        this.style.setProperty('--lk-size', `${size}px`);
        const simpleAttr = this.getAttribute('simple');
        this.engine = new LukasOrbEngine(this, {
          state: this.getAttribute('state') || 'rest',
          size,
          simple: simpleAttr == null ? null : simpleAttr !== 'false',
          mood: this.getAttribute('mood') || 'neutral',
          onSequenceEnd: (s) => this.onSequenceEnd?.(s),
        });
        this.sr = document.createElement('span');
        this.sr.className = 'sr-only';
        this.appendChild(this.sr);
        this.addEventListener('statechange', (e) => { this.sr.textContent = e.detail.state === 'thinking' ? 'Cargando' : ''; });
        if (this.engine.state === 'thinking') this.sr.textContent = 'Cargando';
      } else this.engine.wake();
      // Apariencia de la cuenta (o una fija con setLook); look="none" y los spinners de botón quedan clásicos
      if (!this.unLook && !this.lookOverride && this.getAttribute('look') !== 'none' && !this.classList.contains('spinner')) {
        this.unLook = onLook((cfg) => this.engine?.setLook(cfg));
      }
      // look-at="selector": mira hacia ese elemento y, de vez en cuando, vuelve a mirarte
      const sel = this.getAttribute('look-at');
      if (sel && !this.lookTimer) {
        let n = 0;
        const glance = () => {
          if (!this.isConnected) { this.lookTimer = 0; return; }
          const t = document.querySelector(sel);
          if (n++ % 3 === 2 || !t) this.engine.lookAt(0, 0); else this.engine.lookAtElement(t);
          this.lookTimer = setTimeout(glance, n % 3 === 0 ? 1600 : 2800);
        };
        this.lookTimer = setTimeout(glance, 450);
      }
    }
    disconnectedCallback() { this.engine?.wake(); clearTimeout(this.lookTimer); this.lookTimer = 0; this.unLook?.(); this.unLook = null; }
    attributeChangedCallback(name, old, val) {
      if (!this.engine || old === val) return;
      if (name === 'state') this.engine.play(val);
      if (name === 'mood') this.engine.setMood(val);
    }
    get state() { return this.engine?.state; }
    play(s) { this.engine?.play(s); }
    think() { this.engine?.think(); }
    succeed() { this.engine?.succeed(); }
    fail() { this.engine?.fail(); }
    cancel() { this.engine?.cancel(); }
    setMood(m) { this.engine?.setMood(m); }
    lookAt(x, y) { this.engine?.lookAt(x, y); }
    lookAtElement(t) { this.engine?.lookAtElement(t); }
    setPull(p) { this.engine?.setPull(p); }
    setSimplify(s) { this.engine?.setSimplify(s); }
    talk(on) { this.engine?.talk(on); }
    react(name) { this.engine?.react(name); }
    /** Apariencia fija (editor, comparar): deja de seguir a la cuenta. null vuelve a seguirla. */
    setLook(cfg, opts) {
      this.unLook?.(); this.unLook = null;
      this.lookOverride = cfg ?? null;
      if (cfg) this.engine?.setLook(cfg, opts);
      else if (this.isConnected) this.unLook = onLook((c) => this.engine?.setLook(c, opts));
    }
    destroy() { this.unLook?.(); this.unLook = null; this.engine?.destroy(); this.engine = null; }
  }
  customElements.define('lukas-orb', LukasOrbElement);

  // <lukas-lockup orientation="horizontal|vertical" size="64" intro></lukas-lockup>
  class LukasLockupElement extends HTMLElement {
    connectedCallback() {
      if (this.built) return;
      this.built = true;
      const size = +this.getAttribute('size') || 64;
      const intro = this.hasAttribute('intro');
      this.classList.add('lukas-lockup', `is-${this.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal'}`);
      this.style.setProperty('--lk-size', `${size}px`);
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', 'Lukas');
      this.orb = document.createElement('lukas-orb');
      this.orb.setAttribute('size', size);
      this.orb.setAttribute('state', intro ? 'intro' : 'rest');
      this.orb.setAttribute('aria-hidden', 'true');
      this.word = document.createElement('span');
      this.word.className = 'lukas-word';
      this.word.textContent = 'Lukas';
      this.word.setAttribute('aria-hidden', 'true');
      if (intro) this.word.classList.add('is-hidden');
      // El wordmark entra 150 ms después de que el personaje parpadea
      this.orb.addEventListener('introblink', () => setTimeout(() => this.word.classList.remove('is-hidden'), 150 / settings.speed));
      this.append(this.orb, this.word);
    }
    replay() {
      this.word.classList.add('is-hidden');
      this.orb.play('intro');
    }
  }
  customElements.define('lukas-lockup', LukasLockupElement);
}
