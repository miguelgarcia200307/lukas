// Voz de Lukas (speechSynthesis) robusta en iOS Safari/PWA y Chrome Android, más el AudioContext compartido.
// - iOS solo deja hablar si la síntesis "nació" de un gesto: unlockVoice() se llama dentro del toque (utterance
//   silenciosa) y ese desbloqueo sirve para todas las respuestas siguientes de la sesión.
// - Las voces cargan tarde (getVoices vacío + voiceschanged): se esperan y se elige la mejor en español.
// - Antes de hablar el micrófono ya está liberado (el grabador detiene los tracks) y la sesión de audio pasa a
//   reproducción; cancel() antes de cada frase y resume() si Safari deja la cola en pausa.
// Las preferencias de voz son por dispositivo (las voces cambian entre equipos): van en localStorage.

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
const KEY = 'lukas-voice';
const DEFAULTS = { voiceURI: '', rate: 1, handsfree: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const canSpeak = () => !!synth && typeof window.SpeechSynthesisUtterance !== 'undefined';
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function voicePrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function setVoicePrefs(patch) {
  const next = { ...voicePrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento: solo esta sesión */ }
  return next;
}

// ───────────────────────── voces ─────────────────────────
let voicesP = null;
/** Espera a que el navegador cargue las voces (iOS y Chrome las entregan tarde) */
export function loadVoices(timeout = 2500) {
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  voicesP ??= new Promise((resolve) => {
    const t0 = Date.now();
    const done = () => { synth.removeEventListener?.('voiceschanged', check); clearInterval(poll); voicesP = null; resolve(synth.getVoices()); };
    const check = () => { if (synth.getVoices().length || Date.now() - t0 > timeout) done(); };
    synth.addEventListener?.('voiceschanged', check);
    const poll = setInterval(check, 150);
  });
  return voicesP;
}

// Voces "de juguete" de iOS/macOS que suenan robóticas: van al final
const NOVELTY = /eddy|flo\b|grandma|grandpa|abuel|reed|rocko|sandy|shelley|albert|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|good news|bad news/i;
const GOOD = /enhanced|premium|mejorada|neural|natural|google/i;
const LANG_RANK = ['es-co', 'es-mx', 'es-us', 'es-419'];
const langOf = (v) => String(v.lang || '').replace('_', '-').toLowerCase();

function score(v) {
  const l = langOf(v);
  const r = LANG_RANK.indexOf(l);
  return (r >= 0 ? r : 4) * 10 + (NOVELTY.test(v.name) ? 6 : 0) - (GOOD.test(v.name) ? 3 : 0) + (v.localService === false ? 1 : 0);
}
/** Voces en español, de la mejor a la peor (es-CO, es-MX, es-US, luego cualquier es-*) */
export function spanishVoices(voices) {
  return voices.filter((v) => langOf(v).startsWith('es')).sort((a, b) => score(a) - score(b));
}
/** ¿Hay alguna voz en español que no sea de juguete ni compacta? (para sugerir descargar una mejorada en iOS) */
export const hasGoodSpanish = (voices) => spanishVoices(voices).some((v) => GOOD.test(v.name) || (!isIOS() && !NOVELTY.test(v.name)));

export function pickVoice(voices, uri = voicePrefs().voiceURI) {
  const es = spanishVoices(voices);
  return (uri && voices.find((v) => v.voiceURI === uri)) || es[0] || null;
}

// ───────────────────────── sesión de audio y desbloqueo ─────────────────────────
/** iOS 17+: reproducción por el altavoz (no por el auricular) al hablar; grabación al escuchar */
export function audioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* no soportado */ }
}

let ctx = null;
/** AudioContext compartido: se crea/reanuda dentro de un gesto y se reutiliza (grabador y señal sonora) */
export function sharedAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx || ctx.state === 'closed') ctx = new Ctx();
  if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
  return ctx;
}

let unlocked = false;
/** Llamar SIEMPRE dentro de un toque: desbloquea la síntesis (iOS) y el audio para el resto de la sesión. */
export function unlockVoice() {
  sharedAudioContext();
  if (!canSpeak() || unlocked) return;
  try {
    if (!synth.speaking) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 2;
      synth.speak(u);
    }
    if (synth.paused) synth.resume();
    unlocked = true;
    loadVoices(); // empieza a cargarlas ya
  } catch { /* sin voz: la interfaz sigue mostrando todo */ }
}
// Al volver de segundo plano iOS puede exigir un gesto nuevo
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { unlocked = false; stopSpeaking(); } });
}

// ───────────────────────── hablar ─────────────────────────
let current = null; // referencia viva: en Chrome, si la utterance se recolecta, onend nunca llega
let finishCurrent = null;
export const isSpeaking = () => !!current;

/**
 * Dice el texto y resuelve al terminar: 'end' | 'interrupted' | 'error' | 'unsupported'.
 * Llama a synth.speak() SIN esperas previas: si se invoca dentro de un toque, iOS lo acepta como gesto.
 * Si onend nunca llega (bug de Safari/Chrome), un temporizador lo da por terminado para no trabar la conversación.
 * onstart: avisa cuando de verdad empezó a sonar (para mostrar si el teléfono no reprodujo nada).
 */
export function speak(text, { rate, onstart } = {}) {
  if (!canSpeak() || !text?.trim()) return Promise.resolve('unsupported');
  const prefs = voicePrefs();
  const voices = synth.getVoices();
  if (!voices.length) loadVoices(); // la próxima frase ya tendrá la mejor voz; esta usa la del idioma
  const voice = pickVoice(voices, prefs.voiceURI);
  const r = Math.min(1.5, Math.max(0.7, Number(rate ?? prefs.rate) || 1));
  // cancel() solo si hay una frase nuestra sonando: el ciclo cancel→speak inmediato a veces se "traga" la frase en Safari,
  // y la frase silenciosa del desbloqueo no hace falta cancelarla (dura un instante)
  if (current) stopSpeaking();
  audioSession('playback');
  if (synth.paused) synth.resume();
  unlocked = true;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    try { if (voice) u.voice = voice; } catch { /* voz no válida: se usa el idioma */ }
    u.lang = voice?.lang || 'es-CO';
    u.rate = r;
    u.pitch = 1;
    u.volume = 1;
    let watch = null, guard = null, started = false;
    const finish = (how) => {
      if (finishCurrent !== finish) return;
      clearInterval(watch);
      clearTimeout(guard);
      current = null;
      finishCurrent = null;
      resolve(how);
    };
    u.onstart = () => { if (!started) { started = true; onstart?.(); } };
    u.onend = () => { if (!started) onstart?.(); started = true; finish('end'); };
    let retrying = false;
    u.onerror = (e) => { if (!retrying) finish(e?.error === 'interrupted' || e?.error === 'canceled' ? 'interrupted' : 'error'); };
    current = u;
    finishCurrent = finish;
    try { synth.speak(u); } catch { finish('error'); return; }
    // Safari a veces deja la síntesis en pausa: se reanuda; si a los ~1,2 s no arrancó, se reintenta una vez
    let retried = false;
    const t0 = Date.now();
    watch = setInterval(() => {
      if (synth.paused) synth.resume();
      if (!started && Date.now() - t0 > 3000) { finish('error'); return; } // nunca sonó: avisar sin hacer esperar
      if (!started && !retried && Date.now() - t0 > 1200) {
        retried = true;
        retrying = true;
        try { if (synth.speaking || synth.pending) synth.cancel(); synth.speak(u); } catch { /* nada */ }
        setTimeout(() => { retrying = false; }, 0);
      }
    }, 300);
    guard = setTimeout(() => finish(started ? 'end' : 'error'), 3000 + (text.length * 85) / r);
  });
}

export function stopSpeaking() {
  const f = finishCurrent;
  try { if (synth && (synth.speaking || synth.pending)) synth.cancel(); } catch { /* nada */ }
  f?.('interrupted');
}

/** Señal corta "te escucho" (dos tonos suaves) antes de volver a grabar en manos libres */
export function chime() {
  const c = sharedAudioContext();
  if (!c) return Promise.resolve();
  try {
    const t = c.currentTime + 0.02;
    const g = c.createGain();
    g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    [[660, 0], [990, 0.09]].forEach(([f, d]) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t + d);
      o.connect(g);
      o.start(t + d);
      o.stop(t + d + 0.16);
    });
  } catch { /* sin sonido */ }
  return sleep(300);
}
