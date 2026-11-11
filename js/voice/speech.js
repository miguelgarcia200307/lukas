// Voz de Lukas (speechSynthesis) robusta en iOS Safari/PWA y Chrome Android, más el AudioContext compartido.
// - iOS solo deja hablar si la síntesis "nació" de un gesto: unlockVoice() se llama dentro del toque (utterance
//   silenciosa) y ese desbloqueo sirve para todas las respuestas siguientes de la sesión.
// - Las voces cargan tarde (getVoices vacío + voiceschanged): se esperan y se elige la mejor en español.
// - Antes de hablar el micrófono ya está liberado (el grabador detiene los tracks) y la sesión de audio pasa a
//   reproducción; cancel() antes de cada frase y resume() si Safari deja la cola en pausa.
// Las preferencias de voz son por dispositivo (las voces cambian entre equipos): van en localStorage.

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
const KEY = 'lukas-voice';
const DEFAULTS = { voiceURI: '', rate: 1, handsfree: true, engine: 0 };

/**
 * Formas de usar la voz del sistema. En iPhone algunas combinaciones "hablan" sin sonar (según el modelo y la
 * versión de iOS); "Probar voz" las recorre preguntando si se escuchó y guarda la que funciona en ese teléfono.
 * voice: fijar la voz elegida (si no, iOS usa su voz por defecto del idioma) · keeper: audio silencioso de fondo
 * que pone la página en modo reproducción.
 */
export const ENGINES = [
  { voice: false, keeper: false },
  { voice: true, keeper: false },
  { voice: false, keeper: true },
  { voice: true, keeper: true },
];
const engine = () => ENGINES[voicePrefs().engine] ?? ENGINES[0];
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

// En iOS las voces "Eloquence" (Eddy, Flo, Reed…) y las de efectos pueden listarse y no sonar en la web
const BAD_URI = /eloquence|speech\.synthesis\.voice/i;
function score(v) {
  const l = langOf(v);
  const r = LANG_RANK.indexOf(l);
  const bad = NOVELTY.test(v.name) || BAD_URI.test(v.voiceURI || '');
  return (bad ? 100 : 0) + (r >= 0 ? r : 4) * 10 - (GOOD.test(v.name) ? 3 : 0) + (v.localService === false ? 1 : 0);
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
/**
 * AudioContext compartido del grabador y la señal sonora. Solo se crea al grabar (no al hablar): en iOS un
 * AudioContext activo deja el audio de la página en modo "ambiente", que el modo silencio enmudece.
 */
export function sharedAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx || ctx.state === 'closed') ctx = new Ctx();
  if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {});
  return ctx;
}
/** Suspende el AudioContext cuando no se graba ni suena la señal (para no interferir con la voz) */
export function releaseAudioContext() {
  try { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); } catch { /* nada */ }
}

// ── "Ancla" de reproducción: un <audio> silencioso que suena mientras Lukas habla. En iOS pone la página en modo
// reproducción (suena aunque el iPhone esté en silencio y sale por el altavoz, no por el auricular).
// Se le da play() por primera vez dentro de un toque; después iOS permite reusar ese mismo elemento sin toque.
let keeper = null;
function silentWav() {
  const rate = 8000, n = 4000; // 0,5 s de silencio, PCM 8 bits mono
  const b = new ArrayBuffer(44 + n), v = new DataView(b);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
/** Diagnóstico: un pitido corto con un <audio> normal (no voz). Si suena esto pero no la voz, el problema es la voz. */
export function playTestTone() {
  const rate = 16000, n = Math.round(rate * 0.5);
  const b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 800);
    const f = i < n / 2 ? 660 : 880;
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 0.5 * env * 32767), true);
  }
  const a = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
  a.setAttribute('playsinline', '');
  audioSession('playback');
  return a.play().then(() => true).catch(() => false);
}

function keeperEl() {
  if (keeper || typeof document === 'undefined') return keeper;
  keeper = document.createElement('audio');
  keeper.src = silentWav();
  keeper.loop = true;
  keeper.preload = 'auto';
  keeper.setAttribute('playsinline', '');
  keeper.setAttribute('x-webkit-airplay', 'deny');
  return keeper;
}
function holdPlayback(on) {
  const k = keeperEl();
  if (!k) return;
  try {
    if (on) { const p = k.play(); p?.catch?.(() => {}); } else k.pause();
  } catch { /* nada */ }
}

let unlocked = false;
/** Llamar SIEMPRE dentro de un toque: desbloquea la síntesis y el audio de reproducción (iOS) para la sesión. */
export function unlockVoice() {
  // El ancla se "estrena" en el toque y se pausa enseguida si no hay nada que decir
  if (engine().keeper) {
    const k = keeperEl();
    try { k?.play()?.then(() => { if (!current) k.pause(); }).catch(() => {}); } catch { /* nada */ }
  }
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
  const eng = engine();
  const setVoice = eng.voice || !!prefs.voiceURI; // si el usuario eligió una voz, se respeta
  const r = Math.min(1.5, Math.max(0.7, Number(rate ?? prefs.rate) || 1));
  // cancel() solo si hay una frase nuestra sonando: el ciclo cancel→speak inmediato a veces se "traga" la frase en Safari,
  // y la frase silenciosa del desbloqueo no hace falta cancelarla (dura un instante)
  if (current) stopSpeaking();
  releaseAudioContext();
  if (eng.keeper) { audioSession('playback'); holdPlayback(true); } // modo reproducción mientras habla (ver "ancla")
  if (synth.paused) synth.resume();
  unlocked = true;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    try { if (voice && setVoice) u.voice = voice; } catch { /* voz no válida: se usa el idioma */ }
    u.lang = (voice?.lang || 'es-MX').replace('_', '-');
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
      if (eng.keeper) holdPlayback(false);
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
  return sleep(300).then(releaseAudioContext);
}
