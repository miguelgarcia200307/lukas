// Experiencia de carga alrededor del personaje: umbrales, frases, entrada escalonada, estados vacíos y de error,
// loaders en línea, sacudida y la transición compartida (el personaje viaja entre pantallas sin corte).
import { LukasOrbSettings, prefersReducedMotion, spring, shakeX } from './lukas-orb.js';
import { html, raw } from '../utils/dom.js';

export const LOADER = { delay: 300, minShow: 600, slowAfter: 4000, phraseEvery: 2500 };
export const PHRASES = ['Ordenando tus lucas…', 'Ya casi…', 'Sumando cada peso…', 'Un momento más…'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

/** Loader en línea para botones (reemplaza al spinner genérico; se ve solo con .btn.loading). */
export const ORB_SPINNER = '<lukas-orb class="spinner" size="22" state="thinking" aria-hidden="true"></lukas-orb>';

// ── Loader de sección ─────────────────────────────────────
// <lukas-loader size="48"> no muestra nada los primeros 300 ms; si aparece, settle() garantiza 600 ms mínimo.
// Pasados 4 s, frases suaves debajo.
if (typeof customElements !== 'undefined' && !customElements.get('lukas-loader')) {
  class LukasLoaderElement extends HTMLElement {
    connectedCallback() {
      if (this.started) return;
      this.started = true;
      this.setAttribute('role', 'status');
      this.setAttribute('aria-busy', 'true');
      this.innerHTML = '<span class="lukas-sr">Cargando</span>';
      this.showTimer = setTimeout(() => this.show(), LOADER.delay);
    }
    disconnectedCallback() { this.stop(); }
    show() {
      this.shownAt = now();
      this.classList.add('is-shown');
      const size = +this.getAttribute('size') || 48;
      this.innerHTML = `<lukas-orb size="${size}" state="thinking"></lukas-orb><div class="lukas-phrase is-hidden" aria-live="polite"></div><span class="lukas-sr">Cargando</span>`;
      this.slowTimer = setTimeout(() => { this.stopPhrases = startPhrases(this.querySelector('.lukas-phrase')); }, LOADER.slowAfter - LOADER.delay);
    }
    stop() {
      clearTimeout(this.showTimer); clearTimeout(this.slowTimer);
      this.stopPhrases?.(); this.stopPhrases = null;
    }
    /** Resuelve cuando el loader puede irse (nunca antes de 600 ms visible). */
    async settle() {
      this.stop();
      if (!this.shownAt) return false;
      const left = LOADER.minShow - (now() - this.shownAt);
      if (left > 0) await wait(left);
      return true;
    }
  }
  customElements.define('lukas-loader', LukasLoaderElement);

  // Al volver la conexión, las pantallas en error de carga pasan a procesando y recargan solas
  window.addEventListener('online', () => {
    document.querySelectorAll('#view .lukas-error [data-retry]').forEach((b) => b.click());
  });

  // Reintentar desde un estado de error: el personaje pasa a procesando antes de que la vista recargue
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.lukas-error [data-retry]');
    if (!b) return;
    const box = b.closest('.lukas-error');
    const orb = box.querySelector('lukas-orb');
    orb?.setMood('neutral');
    orb?.think();
    box.dataset.busySince = String(now());
  }, true);
}

/** html del loader de sección (personaje de 48 px). */
export const loaderHtml = (size = 48) => html`<lukas-loader size="${size}"></lukas-loader>`;

/**
 * Antes de pintar el contenido que reemplaza a un loader (o a un error que se está reintentando):
 * espera el mínimo de 600 ms si el personaje alcanzó a aparecer. Devuelve true si se mostró.
 */
export async function settle(root) {
  if (!root) return false;
  const loaders = [...root.querySelectorAll('lukas-loader')];
  const busy = [...root.querySelectorAll('.lukas-error[data-busy-since]')];
  const shown = await Promise.all([
    ...loaders.map((l) => l.settle?.() ?? false),
    ...busy.map(async (b) => { const left = LOADER.minShow - (now() - Number(b.dataset.busySince)); if (left > 0) await wait(left); return true; }),
  ]);
  return shown.some(Boolean);
}

/** Estado vacío con el personaje en reposo mirando hacia el botón principal. */
export function orbEmpty({ title, text = '', action = null, look = '.tab-voice .voice-fab', size = 88 }) {
  return html`<div class="empty lukas-empty fade-up">
    <lukas-orb size="${size}" look-at="${look}"></lukas-orb>
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}
    ${action ? html`<button class="btn btn-primary btn-sm mt-2" ${raw(action.attrs ?? '')}>${action.label}</button>` : ''}
  </div>`;
}

/** Error de carga / sin conexión: el personaje en error que queda en reposo con ojos cansados. */
export function orbError({ title, text = '', retry = true, size = 96 }) {
  return html`<div class="empty lukas-error" role="alert">
    <lukas-orb size="${size}" state="error" mood="tired"></lukas-orb>
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}
    ${retry ? html`<button class="btn btn-secondary btn-sm mt-2" data-retry>Reintentar</button>` : ''}
  </div>`;
}

/** Error de carga por falta de conexión (no espera los reintentos de Supabase). */
export class OfflineError extends Error {
  constructor() { super('Sin conexión. Revisa tu internet e intenta de nuevo.'); this.name = 'OfflineError'; this.offline = true; }
}
/**
 * Corre una carga de pantalla solo si hay red: sin conexión rechaza de inmediato, y si la conexión
 * se cae a mitad de la carga, también (sin esperar los reintentos del cliente de Supabase).
 */
export function online(task) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(new OfflineError());
  let off = null;
  const dropped = new Promise((_, reject) => { off = () => reject(new OfflineError()); window.addEventListener('offline', off, { once: true }); });
  dropped.catch(() => {});
  return Promise.race([Promise.resolve().then(task), dropped]).finally(() => window.removeEventListener('offline', off));
}

/** Mensaje legible para errores de carga (sin conexión vs. otro fallo). */
export const loadErrorText = (err) => (err?.offline || !navigator.onLine || /fetch|network|failed|conexi[oó]n/i.test(err?.message ?? '')
  ? 'Parece que no hay conexión. Revisa tu internet e inténtalo de nuevo.'
  : 'Algo falló de nuestro lado. Inténtalo de nuevo en un momento.');

/**
 * Muestra el personaje mientras `task` corre dentro de `host` (variante imperativa, usada en /brand).
 * opts: { size (diámetro del personaje), celebrate, keepOnError, phrases, onShow }
 */
export async function orbLoader(host, task, { size = 48, celebrate = false, keepOnError = false, phrases = PHRASES, onShow } = {}) {
  let settled = false, shownAt = 0, ui = null, slowTimer = 0, stopPhrases = null;
  const p = Promise.resolve(typeof task === 'function' ? task() : task);
  p.then(() => { settled = true; }, () => { settled = true; });

  const showTimer = setTimeout(() => {
    if (settled) return;
    ui = document.createElement('div');
    ui.className = 'lukas-loader is-entering';
    ui.setAttribute('aria-busy', 'true');
    ui.innerHTML = `<lukas-orb size="${size}" state="thinking"></lukas-orb><div class="lukas-phrase is-hidden" aria-live="polite"></div>`;
    host.replaceChildren(ui);
    shownAt = now();
    onShow?.(ui);
    slowTimer = setTimeout(() => { stopPhrases = startPhrases(ui.querySelector('.lukas-phrase'), phrases); }, LOADER.slowAfter - LOADER.delay);
  }, LOADER.delay);

  let result, error, failed = false;
  try { result = await p; } catch (e) { error = e; failed = true; }
  clearTimeout(showTimer); clearTimeout(slowTimer); stopPhrases?.();

  if (ui) {
    const left = LOADER.minShow - (now() - shownAt);
    if (left > 0) await wait(left);
    const orb = ui.querySelector('lukas-orb');
    ui.querySelector('.lukas-phrase')?.classList.add('is-hidden');
    ui.removeAttribute('aria-busy');
    if (failed) {
      orb.fail();
      if (!keepOnError) await wait(1400 / LukasOrbSettings.speed);
    } else if (celebrate) {
      orb.succeed();
      await wait(1300 / LukasOrbSettings.speed);
    }
    if (!(failed && keepOnError)) {
      ui.classList.remove('is-entering');
      ui.classList.add('is-leaving');
      await wait(200);
      ui.remove();
    }
  }
  if (failed) throw error;
  return result;
}

/** Frases suaves y cambiantes (fade entre frases cada 2.5 s). Devuelve stop(). */
export function startPhrases(el, phrases = PHRASES) {
  if (!el) return () => {};
  let i = 0, swap = 0;
  const next = () => {
    el.classList.add('is-hidden');
    swap = setTimeout(() => { el.textContent = phrases[i++ % phrases.length]; el.classList.remove('is-hidden'); }, el.textContent ? 360 : 0);
  };
  next();
  const id = setInterval(next, LOADER.phraseEvery);
  return () => { clearInterval(id); clearTimeout(swap); el.classList.add('is-hidden'); };
}

/** El contenido entra con fade + translateY 8 px, escalonado 40 ms por bloque. */
export function revealStagger(container, { selector = ':scope > *', step = 40, duration = 460 } = {}) {
  if (!container) return;
  const items = [...container.querySelectorAll(selector)];
  const rm = prefersReducedMotion();
  items.forEach((el, i) => {
    el.animate(
      rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: rm ? 200 : duration, delay: rm ? 0 : Math.min(i, 10) * step, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
    );
  });
}

/** Misma sacudida que el personaje en error (dx = 5·e^(−5t)·sin(34t)). */
export function shake(el, { scale = 1.6 } = {}) {
  if (!el || prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    let t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const t = ((ts - t0) / 1000) * LukasOrbSettings.speed;
      el.style.transform = `translateX(${(shakeX(t) * scale).toFixed(2)}px)`;
      if (t < 0.9) requestAnimationFrame(step);
      else { el.style.transform = ''; resolve(); }
    };
    requestAnimationFrame(step);
  });
}

/**
 * Transición compartida: el personaje viaja (FLIP, 500 ms, spring) hasta `target`.
 * - Si `target` es un <lukas-orb> (oculto mientras tanto), al llegar continúa el estado del viajero (adopt) y se muestra.
 * - Si es un contenedor, se crea dentro un <lukas-orb> de `targetSize`.
 * La cara se simplifica durante el viaje si el destino es pequeño: nunca hay corte seco.
 */
export function flipOrbTo(from, target, { duration = 500, targetSize = 32 } = {}) {
  return new Promise((resolve) => {
    const intoOrb = target.matches?.('lukas-orb');
    const size = intoOrb ? (target.getBoundingClientRect().width || +target.getAttribute('size') || targetSize) : targetSize;
    if (intoOrb) target.style.visibility = 'hidden';
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const s = size / (a.width || 1);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    from.style.transformOrigin = '50% 50%';
    from.style.willChange = 'transform';
    if (size < 40) from.setSimplify?.(1);
    from.lookAt?.(0, 0);
    const done = () => {
      let orb = target;
      if (!intoOrb) {
        orb = document.createElement('lukas-orb');
        orb.setAttribute('size', targetSize);
        orb.setAttribute('state', 'rest');
        target.replaceChildren(orb);
      }
      orb.engine?.adopt(from.engine);
      orb.style.visibility = '';
      from.remove();
      resolve(orb);
    };
    if (prefersReducedMotion()) {
      // Movimiento reducido: crossfade en el sitio
      from.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
      if (intoOrb) { target.style.visibility = ''; target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 }); }
      setTimeout(() => { if (intoOrb) { from.remove(); resolve(target); } else done(); }, 200);
      return;
    }
    let t0 = 0;
    const dur = duration / 1000;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const x = (((ts - t0) / 1000) * LukasOrbSettings.speed) / dur;
      const k = spring(x);
      from.style.transform = `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px) scale(${(1 + (s - 1) * k).toFixed(4)})`;
      if (x < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

// ── Vuelo entre pantallas (arranque → header, login → header) ──
let flying = null;
/** Saca al personaje a una capa fija en su posición actual, para que sobreviva al cambio de pantalla. */
export function takeOff(orb) {
  if (!orb) return null;
  const r = orb.getBoundingClientRect();
  let layer = document.getElementById('orb-flight');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'orb-flight';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '600' });
    document.body.appendChild(layer);
  }
  layer.appendChild(orb);
  Object.assign(orb.style, { position: 'absolute', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
  flying = orb;
  return orb;
}
export const inFlight = () => !!flying;
/** Aterriza en `target` (un <lukas-orb> de la pantalla nueva). Sin destino, el personaje se desvanece. */
export async function land(target) {
  const orb = flying;
  if (!orb) return null;
  flying = null;
  if (!target) {
    await orb.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.86)' }], { duration: 240, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
    orb.remove();
    return null;
  }
  return flipOrbTo(orb, target);
}

/** Una vez al día (hora de Colombia): "listo" solo en la primera carga del día. */
export function firstLoadToday(key = 'lukas.firstLoad') {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  try {
    if (localStorage.getItem(key) === today) return false;
    localStorage.setItem(key, today);
  } catch { /* almacenamiento bloqueado */ }
  return true;
}
