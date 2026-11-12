// Conversación manos libres: tras la señal "te escucho" (chime) el AudioContext compartido debe quedar ACTIVO para que
// el detector de voz del grabador oiga la respuesta ("sí", "no", "de pronto"). Uso: npm test
//
// Según la especificación de Web Audio, suspend()/resume() cambian `state` de forma ASÍNCRONA (WebKit lo hace así;
// Chrome lo adelanta). La secuencia real de VoiceSession.talk() es: chime() → releaseAudioContext() (suspend) y,
// en el mismo instante, Recorder.start() → sharedAudioContext(). Si el código solo reanuda cuando `state` YA dice
// "suspended", con la semántica de la especificación el contexto termina suspendido y el analizador queda mudo.
import test from 'node:test';
import assert from 'node:assert/strict';

/** AudioContext de prueba con la semántica de la especificación: el estado cambia cuando se procesa el mensaje */
class SpecAudioContext {
  constructor() { this.state = 'running'; this.queue = Promise.resolve(); }
  suspend() { this.queue = this.queue.then(() => { this.state = 'suspended'; }); return this.queue; }
  resume() { this.queue = this.queue.then(() => { this.state = 'running'; }); return this.queue; }
  createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
globalThis.window = { AudioContext: SpecAudioContext };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const { sharedAudioContext, releaseAudioContext } = await import('../../js/voice/speech.js');

test('chime → escucha automática: el contexto queda activo aunque el suspend() esté pendiente', async () => {
  const ctx = sharedAudioContext();
  await flush();
  assert.equal(ctx.state, 'running');
  releaseAudioContext(); // fin de chime(): suspend() pendiente, `state` todavía dice "running"
  assert.equal(ctx.state, 'running', 'semántica de la especificación: el cambio aún no se aplica');
  assert.equal(sharedAudioContext(), ctx); // Recorder.start() en el mismo instante
  await flush();
  assert.equal(ctx.state, 'running', 'el grabador necesita el contexto activo para detectar la voz');
});

test('sin escucha pendiente, soltar el contexto lo suspende (no interfiere con la voz de Lukas)', async () => {
  const ctx = sharedAudioContext();
  await flush();
  releaseAudioContext();
  await flush();
  assert.equal(ctx.state, 'suspended');
});

test('pedirlo de nuevo después de suspendido lo reanuda', async () => {
  const ctx = sharedAudioContext();
  await flush();
  assert.equal(ctx.state, 'running');
});
