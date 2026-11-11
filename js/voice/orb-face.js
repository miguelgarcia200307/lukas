// Cara de Lukas sobre el orbe de voz: dos ojos y la moneda lima como boca, con las proporciones del personaje
// (face-geometry.js). Se dibuja en el MISMO frame y el MISMO contexto 2D que el orbe: orb.js la llama al final de su
// draw() con la geometría que ya calculó (contorno deformado, centro, radio, nivel, modo). Nada de otro rAF ni canvas.
// La cara va montada en la superficie: sigue el centroide real, el radio medio, el estiramiento, el lóbulo dominante
// (inclinación y paralaje) y nunca se acerca al borde a menos de 0.18 R. Evita el núcleo del brillo del orbe.
// Lukas ESCUCHA, no habla: mientras grabas, la boca no hace lip-sync; solo se mueve cuando Lukas responde en voz alta.
// Cero objetos nuevos por frame: todo vive en arreglos y objetos creados una vez.
import { FACE_ENABLED, FACE_SCALE } from '../config.js';
import { clamp, lerp, approach, spring, easeInOutCubic, eyePoints, mouthPoints } from '../ui/face-geometry.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
// Unidades del personaje (cuerpo de radio 33): ojos ±9.5/−5 (0.29R/−0.15R), alto 12 (0.36R), trazo 6 (0.18R),
// boca en +11 (0.33R) con punto de 9 (0.27R).
const U = 33;
const EYE_X = 9.5, EYE_Y = -5, EYE_H = 12, EYE_W = 6, MOUTH_Y = 11, MOUTH_W = 9;
const EYE_COLOR = 'rgba(255,255,255,0.96)';
// Lima → coral precalculado (sin strings nuevos por frame)
const LIME = [200, 243, 90], CORAL = [240, 153, 123];
const MOUTH_COLORS = Array.from({ length: 33 }, (_, i) => `rgb(${LIME.map((v, k) => Math.round(lerp(v, CORAL[k], i / 32))).join(',')})`);
MOUTH_COLORS[0] = '#C8F35A';
MOUTH_COLORS[32] = '#F0997B';
// Brillo del orbe (orb.js): degradado blanco centrado en (−0.30R, −0.40R). Los ojos nunca entran a su núcleo.
const SHINE_X = -0.3, SHINE_Y = -0.4;
export const SHINE_CORE = 0.16; // en R (comparado 0.12 / 0.16 / 0.20: el ojo sale del destello sin correr mucho la cara)
const MARGIN = 0.18; // distancia mínima al borde, en R
// Detección de voz: la MISMA fórmula de recorder.js (umbral = max(0.02, piso·3) sobre el RMS, piso adaptativo),
// replicada sobre el nivel que ya recibe el orbe (nivel = RMS·4) para no tocar recorder.js.
const VAD_CALIBRATE = 0.35, VAD_MIN_SPEECH = 0.25;

/** Ajustes de la página de prueba (voice-face.html). En la app quedan en null / 1. */
export const FaceSettings = { scale: null, speed: 1, reduced: null, lowEnd: null, core: null, onFrame: null };

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Interruptor: FACE_ENABLED en config.js y ?face=0 en la URL (salida de emergencia). */
export function faceAllowed() {
  if (!FACE_ENABLED) return false;
  try { return new URLSearchParams(location.search).get('face') !== '0'; } catch { return true; }
}

/** La crea orb.js. Apagada → null y el orbe se dibuja exactamente como antes. */
export function createFace(orb) { return faceAllowed() ? new OrbFace(orb) : null; }

/** Tamaño de la cara según el radio del orbe en px (Inicio, hoja y hoja compacta). */
export function scaleFor(R) {
  if (FaceSettings.scale != null) return FaceSettings.scale;
  const { large, medium, small } = FACE_SCALE;
  if (R >= 84) return large;
  if (R <= 34) return small;
  return R >= 58 ? lerp(medium, large, (R - 58) / 26) : lerp(small, medium, (R - 34) / 24);
}

/** Un frame de la cara: actualiza el controlador con la geometría del orbe y la dibuja encima, en el mismo contexto. */
export function drawFace(ctx, geo, face, dt) {
  face.update(geo, dt);
  face.paint(ctx, geo);
}

// ── Coordinación: una sola cara "al frente" y el personaje del header ──
// Al frente: la de la hoja de voz si está abierta; si no, la más reciente. Las demás quedan quietas con los ojos
// cerrados en calma (nunca reaccionan ni parpadean dos a la vez). Con la hoja abierta el header queda congelado.
const faces = [];
let uid = 0;
let heldEngine = null, headerRef = null;

/** Caras vivas (solo lectura, para pruebas). */
export const faceList = () => faces;

function frontFace() {
  let best = null;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (!f.canvas.isConnected) continue;
    if (!best || (f.inSheet && !best.inSheet) || (f.inSheet === best.inSheet && f.id > best.id)) best = f;
  }
  return best;
}

function syncHeader() {
  if (typeof document === 'undefined') return;
  const f = frontFace();
  const want = !!(f && f.inSheet);
  const eng = document.querySelector('.home-lukas lukas-orb')?.engine ?? null;
  if (heldEngine && heldEngine !== eng) { heldEngine.hold?.(false); heldEngine = null; }
  headerRef = eng;
  if (!eng?.hold) return;
  if (want && heldEngine !== eng) { eng.hold(true); heldEngine = eng; }
  else if (!want && heldEngine === eng) { eng.hold(false); heldEngine = null; }
}

/** ¿El personaje del header está parpadeando o está por hacerlo? (solo lectura de su estado) */
function headerBlinkSoon() {
  const e = headerRef;
  if (!e || e.held || e.simple || !e.running || e.state !== 'rest' || !e.blink) return false;
  if (e.blink.start >= 0) return true;
  const toNext = e.blink.next - e.t;
  return toNext < 0.8 && toNext > -0.6;
}

// ── Parámetros de la cara (unidades del personaje), todos suavizados ──
const REST = { ap: 1, eh: 1, wh: 0, wt: 0, wc: 0, gx: 0, gy: 0, mhw: 0, mc: 0, mw: MOUTH_W, ms: 1, mo: 0, my: 0, mcol: 0 };
const KEYS = Object.keys(REST);
const NK = KEYS.length;
const K_FACE = 0.14;

export class OrbFace {
  constructor(orb) {
    this.orb = orb;
    this.canvas = orb.canvas;
    this.id = ++uid;
    this.inSheet = !!this.canvas.closest?.('.voice-sheet');
    this.root = this.canvas.closest?.('.voice-sheet, .hero') ?? null;
    this.input = null;
    this.v = { ...REST }; this.m = { ...REST }; this.T = { ...REST }; this.K = { ...REST };
    this.ghost = { ...REST }; this.ghostA = 0; this.key = ''; this.keyNow = 'rest';
    this.clock = 0; this.last = 0; this.realDt = 1 / 60;
    this.mode = 'idle'; this.modeT = 0;
    this.cueName = ''; this.cueT = 0;
    this.antic = 0;
    this.bMin = 3.5; this.bMax = 5;
    this.blinkStart = -1; this.blinkNext = 1.2 + Math.random() * 2; this.blinkSecond = false; this.lastBlink = -10; this.hdrBlinkAt = -10;
    this.nodT = -10; this.lastNod = -10; this.nodPending = -1;
    this.saccNext = 0; this.sgx = 0; this.sgy = 0;
    this.resetVad();
    this.lv = 0;
    this.jy = 0; this.dx = 0; this.Cx = 0; this.Cy = 0;
    // Geometría suavizada (en R, relativa al centro del orbe: el canvas puede cambiar de tamaño sin que la cara se quede atrás)
    this.g = { ox: 0, oy: 0, s: 1, sx: 1, sy: 1, tilt: 0, plx: 0, ply: 0, shift: 0, m: 1, init: false, shiftInit: false };
    this.lobe = 0;
    this.held = false; this.wakeT = -1;
    this.lowEnd = false; this.slowFor = 0; this.frameEma = 16.7;
    this.ms = 0; // costo de la cara por frame (ms, promedio)
    this.E = new Float64Array(6); this.M = new Float64Array(6);
    this.syncIn = 0;
    // Nace detrás de la hoja de voz (Inicio se recargó con la hoja abierta): ya con los ojos cerrados en calma
    const f = frontFace();
    if (f && f.inSheet && !this.inSheet) { this.v.wc = this.m.wc = 1; this.held = true; }
    faces.push(this);
    syncHeader();
  }

  /** Eventos que solo la hoja conoce: 'ok' | 'error' | 'cancel' | 'denied'. */
  cue(name) {
    // Orden real de los eventos: un cambio de modo hecho ANTES de la señal se procesa primero (los posteriores, en el frame)
    if (this.orb.mode !== this.mode) this.onMode(this.mode, this.orb.mode);
    this.cueName = name;
    this.cueT = this.clock;
  }

  destroy() {
    const i = faces.indexOf(this);
    if (i >= 0) faces.splice(i, 1);
    syncHeader();
  }

  /** Lo llama orb.js al final de su draw(), con su contexto y su geometría de este frame. */
  frame(ctx, geo) {
    const t0 = performance.now();
    const real = this.last ? Math.min(0.1, (t0 - this.last) / 1000) : 1 / 60;
    if (this.last && t0 - this.last < 100) {
      // Gama baja: si el frame tarda más de 20 ms de forma sostenida (2 s), sin paralaje ni inclinación
      this.frameEma += (t0 - this.last - this.frameEma) * 0.1;
      if (this.frameEma > 20) { this.slowFor += real; if (this.slowFor > 2) this.lowEnd = true; } else this.slowFor = 0;
    }
    this.last = t0;
    this.realDt = real;
    drawFace(ctx, geo, this, real * FaceSettings.speed);
    this.ms += (performance.now() - t0 - this.ms) * 0.1;
    FaceSettings.onFrame?.(this);
  }

  resetVad() {
    this.recT = 0; this.noise = null; this.speechMs = 0; this.hasSpeech = false; this.voiced = false;
    this.lastVoiceT = 0; this.belowRun = 0; this.pause = false;
  }

  onMode(prev, next) {
    this.mode = next;
    this.modeT = this.clock;
    if (next === 'recording' || next === 'thinking' || this.cueName === 'denied') this.cueName = ''; // 'denied' dura hasta el siguiente cambio
    if (next === 'recording') {
      if (prev !== 'recording') this.antic = 0.25; // "¡dime!"
      this.resetVad();
      this.saccNext = this.clock + 0.5;
      this.sgx = 0; this.sgy = 0;
    }
    [this.bMin, this.bMax] = next === 'recording' ? [5, 7] : [3.5, 5];
    if (this.blinkStart < 0) this.blinkNext = this.clock + (next === 'recording' ? this.bMin : 1.2 + Math.random() * 1.6);
  }

  // Detección de voz (misma fórmula que recorder.js) con tiempo real, no el de la simulación lenta
  vadStep(geo, rdt) {
    const rms = geo.target / 4;
    this.recT += rdt;
    if (this.recT < VAD_CALIBRATE) {
      this.noise = this.noise == null ? rms : Math.min(this.noise, rms);
      this.belowRun += rdt;
      return;
    }
    const floor = this.noise ?? 0.01;
    const thr = Math.max(0.02, floor * 3);
    const voiced = rms > thr;
    if (voiced) {
      this.speechMs += rdt;
      this.lastVoiceT = this.recT;
      if (!this.hasSpeech && this.speechMs >= VAD_MIN_SPEECH) this.hasSpeech = true;
      // Inicio de sílaba o frase después de una caída: asentimiento si la voz se sostiene 60 ms (no un clic)
      if (!this.voiced && this.belowRun >= 0.12) this.nodPending = this.recT;
      if (this.nodPending >= 0 && this.recT - this.nodPending >= 0.06) {
        this.nodPending = -1;
        if (this.clock - this.lastNod >= 0.45) { this.nodT = this.clock; this.lastNod = this.clock; }
      }
      this.belowRun = 0;
    } else {
      this.noise = floor * 0.98 + Math.min(rms, thr) * 0.02;
      this.belowRun += rdt;
      this.nodPending = -1;
    }
    this.voiced = voiced;
    this.pause = this.hasSpeech && !voiced && this.recT - this.lastVoiceT >= 0.5;
  }

  update(geo, dt) {
    const f = Math.min(1, dt * 60);
    this.clock += dt;
    const now = this.clock;
    const rm = FaceSettings.reduced ?? !!mq?.matches;
    this.rm = rm;
    const front = frontFace() === this;
    if (front === this.held) { this.held = !front; if (front) this.wakeT = 0; }
    if (front && (this.syncIn -= this.realDt) <= 0) { this.syncIn = 0.5; syncHeader(); }
    if (geo.mode !== this.mode) this.onMode(this.mode, geo.mode);
    // Nivel para la boca y los ojos al escuchar: ataque k 0.3, caída k 0.08
    const lvT = this.mode === 'recording' ? geo.target : 0;
    this.lv += (lvT - this.lv) * Math.min(1, (lvT > this.lv ? 0.3 : 0.08) * f);
    if (this.mode === 'recording') this.vadStep(geo, this.realDt);
    this.targets(geo, dt, now, rm);
    const { T, K, v, m } = this;
    for (let i = 0; i < NK; i++) {
      const k = KEYS[i], base = K[k];
      if (base < 0.5) {
        // Suavizado en cascada (como el personaje): arranca con ease-in, ninguna expresión salta
        const k2 = Math.min(1, base * 1.7 * f);
        m[k] += (T[k] - m[k]) * k2;
        v[k] += (m[k] - v[k]) * k2;
      } else {
        v[k] += (T[k] - v[k]) * Math.min(1, base * f);
        m[k] = v[k];
      }
    }
    if (rm) this.crossfade(dt); else this.ghostA = 0;
    this.track(geo, f, rm);
  }

  targets(geo, dt, now, rm) {
    const { T, K } = this;
    Object.assign(T, REST);
    for (let i = 0; i < NK; i++) K[KEYS[i]] = K_FACE;
    const motion = rm ? 0 : 1;
    let blinkOn = true, key = 'rest';
    this.jy = 0; this.dx = 0;
    const ct = now - this.cueT;
    const cue = this.cueName;
    if ((cue === 'ok' && ct > 1.5) || (cue === 'error' && ct > 1.2) || (cue === 'cancel' && ct > 0.5)) this.cueName = '';

    if (this.held) {
      // Detrás de la hoja de voz: ojos cerrados en calma, sin reaccionar
      T.wc = 1; K.wc = 0.08; blinkOn = false; key = 'held';
    } else if (this.cueName === 'ok') {
      // Éxito: "^ ^" y la moneda se estira en sonrisa; la cara sube 0.05 R y vuelve con resorte
      T.wh = 1; T.gy = -0.6; T.mhw = 8.58; T.mc = 7.59; T.mw = 5.28;
      K.wh = 0.16; K.mhw = 0.15; K.mc = 0.15; K.mw = 0.15; K.gx = 0.16; K.gy = 0.16;
      if (motion) this.jy = ct < 0.18 ? -1.65 * Math.sin((ct / 0.18) * (Math.PI / 2)) : -1.65 * (1 - spring((ct - 0.18) / 0.6));
      blinkOn = false; key = 'ok';
    } else if (this.cueName === 'error') {
      // Error: ojos cansados mirando abajo, boca preocupada coral y una sacudida corta solo de la cara
      T.wt = 1; T.gy = 1.6; T.mhw = 4.8; T.mc = -3; T.mw = 4.4; T.mcol = 1;
      K.wt = 0.18; K.mhw = 0.15; K.mc = 0.15; K.mw = 0.15; K.mcol = 0.18; K.gx = 0.16; K.gy = 0.16;
      if (motion) this.dx = 1.32 * Math.exp(-5 * ct) * Math.sin(34 * ct); // 0.04 R·e^(−5t)·sin(34t)
      blinkOn = false; key = 'error';
    } else if (this.cueName === 'cancel') {
      T.wc = 1; K.wc = 0.3; blinkOn = false; key = 'cancel';
    } else if (this.cueName === 'denied') {
      // Sin permiso de micrófono: cansado, boca neutra (hasta que vuelva a intentar)
      T.wt = 1; T.gy = 1.4; T.mhw = 3.2; T.mc = 0.4; T.mw = 5;
      K.wt = 0.16; blinkOn = false; key = 'denied';
    } else if (this.mode === 'recording') {
      if (this.antic > 0) {
        // Anticipación (250 ms): ojos más abiertos y la moneda un poco más grande
        this.antic -= dt;
        T.eh = 1.2; T.ms = 1.15; K.eh = 0.3; K.ms = 0.3;
        blinkOn = false; key = 'antic';
      } else {
        // Escuchando: la boca NO hace lip-sync; solo respira muy poco con el nivel
        const lv = this.lv * motion;
        T.eh = 1.05 + 0.1 * clamp((lv - 0.25) / 0.5);
        T.ms = 1 + 0.12 * lv;
        K.eh = 0.3; K.ms = 0.3;
        key = 'listen';
        if (this.pause) {
          // Pausa (antes del envío automático): expectativa, "¿algo más?"
          T.eh = 1.1; T.mhw = 2; T.mc = 1.3; T.mw = 7.5; K.mhw = 0.12; K.mc = 0.12; K.mw = 0.12;
          key = 'pause';
        }
        // Mirada hacia ti con micro-movimientos cada 1.5–3 s
        if (motion && now >= this.saccNext) {
          this.saccNext = now + 1.5 + Math.random() * 1.5;
          this.sgx = (Math.random() * 2 - 1) * 0.66;
          this.sgy = (Math.random() * 2 - 1) * 0.66;
        }
        T.gx = this.sgx * motion; T.gy = this.sgy * motion; K.gx = 0.25; K.gy = 0.25;
        // Asentimiento: baja 0.03 R y vuelve en 260 ms (ease-out y resorte)
        const e = now - this.nodT;
        if (motion && e >= 0 && e < 0.6) this.jy = e < 0.09 ? 0.99 * (1 - Math.pow(1 - e / 0.09, 3)) : 0.99 * (1 - spring((e - 0.09) / 0.26));
      }
    } else if (this.mode === 'thinking') {
      // Procesando: entrecerrados, la mirada da una vuelta que acelera y frena (periodo 1.2 s)
      T.ap = 0.78; T.mw = 6.5; blinkOn = false; key = 'think';
      if (motion) {
        const u = (now - this.modeT) / 1.2, n = Math.floor(u), fr = u - n;
        const ang = -Math.PI / 2 + TAU * (n + easeInOutCubic(fr));
        T.gx = 2.64 * Math.cos(ang); T.gy = 1.98 * Math.sin(ang); // 0.08 R × 0.06 R
        K.gx = 0.3; K.gy = 0.3;
      }
    } else if (this.mode === 'speaking') {
      // Lukas habla (respuesta en voz alta): ahí sí, la moneda se abre y se cierra suave con su nivel
      T.mo = clamp((geo.level - 0.28) / 0.22) * motion; K.mo = 0.35;
      T.gx = 0.6 * Math.sin(0.7 * now) * motion; T.gy = 0.3 * Math.sin(0.53 * now) * motion;
      key = 'speak';
    } else {
      // Reposo: mira alrededor despacio (±0.04 R) y la boca flota
      T.gx = 1.32 * Math.sin(0.7 * now) * Math.sin(0.31 * now) * motion;
      T.gy = 0.8 * Math.sin(0.53 * now) * motion;
      T.my = 0.6 * Math.sin(now * 1.1 + 1) * motion;
      // Escribiendo en "O escríbelo aquí": mira hacia abajo, hacia el campo
      if (this.root && (!this.input || !this.input.isConnected)) this.input = this.root.querySelector('input[name="q"]');
      if (this.input && document.activeElement === this.input) { T.gy = 1.98; T.gx *= 0.3; key = 'focus'; }
    }

    // Volver al frente (se cerró la hoja): abre los ojos que traía cerrados
    if (!this.held && this.wakeT >= 0) {
      this.wakeT += dt;
      if (this.wakeT < 0.2) { T.wc = 1; blinkOn = false; }
      K.wc = 0.12;
      if (this.wakeT > 1.2) this.wakeT = -1;
    }

    // Parpadeo: cierra rápido (k 0.55), abre más lento (k 0.3); a veces doble. Nunca a la vez que el header.
    if (headerBlinkSoon()) this.hdrBlinkAt = now;
    const free = now - this.hdrBlinkAt > 0.75 && !headerBlinkSoon();
    if (blinkOn && this.blinkStart < 0 && free) {
      // Escuchando: aprovecha las pausas cortas para parpadear (se ve natural)
      const pauseBlink = key === 'listen' && this.hasSpeech && this.belowRun > 0.15 && now - this.lastBlink > 2.5;
      if (now >= this.blinkNext || pauseBlink) this.startBlink(now);
    }
    if (this.blinkStart >= 0) {
      const e = now - this.blinkStart;
      if (e < 0.075) { T.ap = 0; K.ap = 0.55; } else { K.ap = 0.3; if (e > 0.32) this.blinkStart = -1; }
    } else K.ap = 0.2;

    if (rm) for (let i = 0; i < NK; i++) if (KEYS[i] !== 'ap') K[KEYS[i]] = 1; // movimiento reducido: crossfade
    this.keyNow = key;
  }

  startBlink(now) {
    this.blinkStart = now;
    this.lastBlink = now;
    if (!this.blinkSecond && this.bMin < 4 && Math.random() < 0.18) { this.blinkNext = now + 0.36; this.blinkSecond = true; }
    else { this.blinkNext = now + this.bMin + Math.random() * (this.bMax - this.bMin); this.blinkSecond = false; }
  }

  // Movimiento reducido: las expresiones cambian con crossfade de 200 ms (el parpadeo se permite)
  crossfade(dt) {
    if (this.keyNow !== this.key) {
      if (this.key) {
        Object.assign(this.ghost, this.v);
        this.ghostA = 1;
        for (let i = 0; i < NK; i++) { const k = KEYS[i]; if (k !== 'ap') this.v[k] = this.m[k] = this.T[k]; }
      }
      this.key = this.keyNow;
    }
    if (this.ghostA > 0) this.ghostA = Math.max(0, this.ghostA - dt / 0.2);
  }

  /** La cara montada en la superficie: centroide, escala, estiramiento, inclinación, paralaje, brillo y margen. */
  track(geo, f, rm) {
    const g = this.g, R = geo.R, n = geo.n, r = geo.r, px = geo.px, py = geo.py;
    if (!R) return;
    let A = 0, sx = 0, sy = 0, rs = 0, imax = 0;
    for (let i = 0; i < n; i++) {
      const c = px[i] * py[i + 1] - px[i + 1] * py[i];
      A += c; sx += (px[i] + px[i + 1]) * c; sy += (py[i] + py[i + 1]) * c; rs += r[i];
      if (r[i] > r[imax]) imax = i;
    }
    const rM = rs / n;
    const q = n / 4;
    // Lóbulo dominante con histéresis (sigue al lóbulo actual mientras se mueve; cambia solo si otro es claramente mayor)
    let li = this.lobe % n;
    for (let s = 0; s < 8; s++) {
      const a = r[(li + 1) % n], b = r[(li - 1 + n) % n];
      if (a > r[li] && a >= b) li = (li + 1) % n; else if (b > r[li]) li = (li - 1 + n) % n; else break;
    }
    if (r[imax] > r[li] + 0.02 * R) li = imax;
    this.lobe = li;
    // Fuerza del lóbulo por encima de la ondulación de reposo (≈0.03 R): quieto en reposo, vivo al hablar
    const amp = clamp(((r[li] - rM) / R - 0.03) / 0.12);
    const th = (li / n) * TAU;
    const lo = FaceSettings.lowEnd ?? this.lowEnd;
    const fs = scaleFor(R);
    // Objetivos (en R)
    const tox = rm || !A ? 0 : (sx / (3 * A) - geo.cx) / R;
    const toy = rm || !A ? 0 : (sy / (3 * A) - geo.cy) / R;
    const ts = fs * (rm ? geo.blobScale : rM / R);
    const tsx = rm ? 1 : clamp((r[0] + r[2 * q]) / 2 / rM, 0.92, 1.08);
    const tsy = rm ? 1 : clamp((r[q] + r[3 * q]) / 2 / rM, 0.92, 1.08);
    const tTilt = rm || lo ? 0 : 6 * DEG * amp * Math.cos(th);
    const tPx = rm || lo ? 0 : 0.04 * amp * Math.cos(th);
    const tPy = rm || lo ? 0 : 0.04 * amp * Math.sin(th);
    if (!g.init) {
      g.ox = tox; g.oy = toy; g.s = ts; g.sx = tsx; g.sy = tsy; g.tilt = tTilt; g.plx = tPx; g.ply = tPy; g.init = true;
    } else {
      g.ox = approach(g.ox, tox, 0.35, f); g.oy = approach(g.oy, toy, 0.35, f);
      g.s = approach(g.s, ts, 0.2, f);
      g.sx = approach(g.sx, tsx, 0.2, f); g.sy = approach(g.sy, tsy, 0.2, f);
      g.tilt = approach(g.tilt, tTilt, 0.15, f);
      g.plx = approach(g.plx, tPx, 0.15, f); g.ply = approach(g.ply, tPy, 0.15, f);
    }
    // Brillo: si la punta del ojo izquierdo (con su tapa redonda) entra al núcleo, la cara se corre en diagonal
    const k = (g.s * R) / U;
    const v = this.v;
    const ex = (g.ox + g.plx - SHINE_X) * R + k * (-EYE_X) * g.sx;
    const ey = (g.oy + g.ply - SHINE_Y) * R + k * (EYE_Y - (EYE_H / 2) * v.eh - EYE_W / 2) * g.sy;
    const core = (FaceSettings.core ?? SHINE_CORE) * R;
    const d2 = ex * ex + ey * ey;
    let need = 0;
    if (d2 < core * core) { const b = ex * 0.6 + ey * 0.8; need = (-b + Math.sqrt(b * b - (d2 - core * core))) / R; }
    if (g.shiftInit) g.shift = approach(g.shift, need, 0.15, f); else { g.shift = need; g.shiftInit = true; }
    this.Cx = geo.cx + (g.ox + g.plx + 0.6 * g.shift) * R;
    this.Cy = geo.cy + (g.oy + g.ply + 0.8 * g.shift) * R;
    // Margen: los puntos extremos de la cara nunca a menos de 0.18 R del contorno real
    const eyeTop = EYE_Y + v.gy - (EYE_H / 2) * v.eh - EYE_W / 2, eyeBot = EYE_Y + v.gy + (EYE_H / 2) * v.eh + EYE_W / 2;
    const ew = EYE_X + EYE_W / 2 + Math.abs(v.gx);
    const mh = Math.max(0, v.mhw) + (v.mw * v.ms) / 2;
    const mb = MOUTH_Y + v.my + Math.max(0, v.mc) / 2 + ((v.mw * v.ms) / 2) * (1 + 0.5 * v.mo);
    let worst = 1;
    worst = Math.min(worst, this.fit(geo, -ew, eyeTop, k), this.fit(geo, ew, eyeTop, k), this.fit(geo, -ew, eyeBot, k),
      this.fit(geo, ew, eyeBot, k), this.fit(geo, -mh, mb, k), this.fit(geo, mh, mb, k));
    g.m = worst < g.m ? worst : approach(g.m, worst, 0.2, f);
  }

  /** Factor (≤ 1) que mantiene este punto de la cara a 0.18 R del borde, escalando hacia el centro del orbe. */
  fit(geo, fx, fy, k) {
    const g = this.g;
    const lx = (fx + this.dx) * k * g.sx, ly = (fy + this.jy) * k * g.sy;
    const c = Math.cos(g.tilt), s = Math.sin(g.tilt);
    const rx = this.Cx + lx * c - ly * s - geo.cx, ry = this.Cy + lx * s + ly * c - geo.cy;
    const dist = Math.hypot(rx, ry);
    if (dist < 1e-6) return 1;
    let a = Math.atan2(ry, rx);
    if (a < 0) a += TAU;
    const idx = (a / TAU) * geo.n, i0 = Math.floor(idx) % geo.n, t = idx - Math.floor(idx);
    const rc = geo.r[i0] * (1 - t) + geo.r[i0 + 1] * t;
    return Math.min(1, Math.max(0.1, (rc - MARGIN * geo.R) / dist));
  }

  paint(ctx, geo) {
    if (!geo.R) return;
    const g = this.g, k = (g.s * geo.R) / U;
    ctx.save();
    if (g.m < 0.9999) { ctx.translate(geo.cx, geo.cy); ctx.scale(g.m, g.m); ctx.translate(-geo.cx, -geo.cy); }
    ctx.translate(this.Cx, this.Cy);
    if (g.tilt) ctx.rotate(g.tilt);
    ctx.scale(k * g.sx, k * g.sy);
    ctx.translate(this.dx, this.jy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (this.ghostA > 0) {
      this.features(ctx, this.ghost, this.ghostA);
      this.features(ctx, this.v, 1 - this.ghostA);
    } else this.features(ctx, this.v, 1);
    ctx.restore();
  }

  features(ctx, p, alpha) {
    if (alpha <= 0.003) return;
    ctx.globalAlpha = alpha;
    const E = eyePoints(this.E, EYE_H * p.eh, clamp(p.ap, 0, 1.2), 1, clamp(p.wh), clamp(p.wt), clamp(p.wc));
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const x = side * EYE_X + p.gx, y = EYE_Y + p.gy;
      ctx.moveTo(x + E[0], y + E[1]);
      ctx.quadraticCurveTo(x + E[2], y + E[3], x + E[4], y + E[5]);
    }
    ctx.strokeStyle = EYE_COLOR;
    ctx.lineWidth = EYE_W;
    ctx.stroke();
    // Boca: la moneda (y sus formas: sonrisa, preocupada, abierta al hablar)
    const my = MOUTH_Y + p.my, mo = p.mo;
    const M = mouthPoints(this.M, 0, my, p.mhw, p.mc);
    const talk = mo > 0.01;
    if (talk) { ctx.save(); ctx.translate(0, my); ctx.scale(1 - 0.06 * mo, 1 + 0.5 * mo); ctx.translate(0, -my); }
    ctx.beginPath();
    ctx.moveTo(M[0], M[1]);
    ctx.quadraticCurveTo(M[2], M[3], M[4], M[5]);
    ctx.strokeStyle = MOUTH_COLORS[Math.round(clamp(p.mcol) * 32)];
    ctx.lineWidth = p.mw * p.ms;
    ctx.stroke();
    if (talk) ctx.restore();
  }
}
