// Dobles de prueba para la hoja de voz (se inyectan con un import map en scripts/ui-tests/voice-convo.html):
// micrófono (Recorder), voz de Lukas (speech.js) y la función ai-assistant (api/ai.js). Sin red, sin audio real.
//
// window.__mic: lista de lo que "dice" el usuario en cada grabación: 'voz' (habla y hace pausa) o 'silencio'.
// window.__assistant(turn): respuesta guionizada de la función para cada envío { events: [[ev, data]…], done }.
// window.__spoken: frases que dijo Lukas · window.__sent: cada envío a la función (audio o texto, con su `expect`).

window.__spoken = [];
window.__sent = [];
window.__mic = [];

// ── speech.js
export const unlockVoice = () => {};
export const stopSpeaking = () => {};
export const isSpeaking = () => false;
export const voicePrefs = () => ({ voiceURI: '', rate: 1, handsfree: true, engine: 0 });
export const chime = () => new Promise((r) => setTimeout(r, 5));
export const speak = (text) => { window.__spoken.push(text); return new Promise((r) => setTimeout(() => r('end'), 5)); };
export const sharedAudioContext = () => null;
export const releaseAudioContext = () => {};
export const audioSession = () => {};

// ── recorder.js
export const canRecord = () => true;
export class Recorder {
  constructor(cb = {}) { Object.assign(this, cb); this.state = 'idle'; this.hasSpeech = false; this.startedAt = 0; }
  async start() {
    this.state = 'recording';
    this.startedAt = performance.now();
    this.mimeType = 'audio/webm';
    const what = window.__mic.shift() ?? 'silencio';
    if (what === 'voz') {
      setTimeout(() => { if (this.state !== 'recording') return; this.hasSpeech = true; this.onSpeech?.(); this.silenceFired = true; this.onSilence?.(); }, 20);
    } else {
      // Nadie habla: el reloj de la hoja pasa de los 8 s de espera
      setTimeout(() => { if (this.state === 'recording') this.onTick?.(9); }, 20);
    }
  }
  get seconds() { return 1.4; }
  get heardVoice() { return this.hasSpeech; }
  stop() { this.state = 'idle'; this.duration = 1.4; return Promise.resolve(new Blob([new Uint8Array(4000)], { type: 'audio/webm' })); }
  cancel() { this.state = 'idle'; }
}

// ── api/ai.js
export const pingAssistant = () => {};
export const learnCategoryHints = () => {};
export const aiUsage = () => Promise.resolve({});
export const sendTestPush = () => Promise.resolve({});
export async function streamAssistant(turn) {
  window.__sent.push({ audio: !!turn.audio, text: turn.text ?? null, expect: turn.expect ?? '', mode: turn.mode ?? null });
  const r = window.__assistant(turn);
  turn.onEvent?.('sent', {});
  for (const [ev, data] of r.events ?? []) turn.onEvent?.(ev, data);
  turn.onEvent?.('done', r.done);
  return r.done;
}
