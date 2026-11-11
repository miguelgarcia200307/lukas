// Mecanismo común de guardado (js/ui/submit.js): éxito, error, timeout, doble envío y formulario cerrado. Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSave, SaveTimeoutError } from '../../js/ui/submit.js';

/** Botón falso con lo mínimo que usa runSave */
function fakeButton() {
  const classes = new Set();
  const attrs = {};
  return {
    dataset: {}, isConnected: true,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; },
    get loading() { return classes.has('loading'); }, attrs,
  };
}
const quiet = () => {};
const silenceConsole = (t) => { const e = console.error; console.error = () => {}; t.after(() => { console.error = e; }); };

test('éxito: devuelve el valor y libera el botón', async () => {
  const b = fakeButton();
  let during = null;
  const r = await runSave(async () => { during = b.loading; return 42; }, { button: b, notify: quiet });
  assert.deepEqual(r, { ok: true, value: 42 });
  assert.equal(during, true);
  assert.equal(b.loading, false);
  assert.equal(b.dataset.saving, undefined);
  assert.equal(b.attrs['aria-busy'], undefined);
});

test('error: muestra el mensaje, libera el botón y permite reintentar', async (t) => {
  silenceConsole(t);
  const b = fakeButton();
  const shown = [];
  const r = await runSave(async () => { throw new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'); }, { button: b, notify: (m, o) => shown.push([m, o.type]) });
  assert.equal(r.ok, false);
  assert.deepEqual(shown, [['Sin conexión. Revisa tu internet e intenta de nuevo.', 'err']]);
  assert.equal(b.loading, false);
  const again = await runSave(async () => 'guardado', { button: b, notify: quiet }); // reintento
  assert.deepEqual(again, { ok: true, value: 'guardado' });
});

test('timeout: una acción que nunca termina libera el botón con un error claro', async (t) => {
  silenceConsole(t);
  const b = fakeButton();
  const shown = [];
  const r = await runSave(() => new Promise(() => {}), { button: b, timeoutMs: 30, notify: (m) => shown.push(m) });
  assert.equal(r.ok, false);
  assert.ok(r.error instanceof SaveTimeoutError);
  assert.match(shown[0], /demoró demasiado/);
  assert.equal(b.loading, false);
});

test('doble clic: mientras guarda, el segundo envío se ignora (se guarda una sola vez)', async () => {
  const b = fakeButton();
  let calls = 0;
  let release;
  const action = () => { calls++; return new Promise((r) => { release = r; }); };
  const first = runSave(action, { button: b, notify: quiet });
  const second = await runSave(action, { button: b, notify: quiet });
  assert.deepEqual(second, { ok: false, skipped: true });
  release('ok');
  assert.deepEqual(await first, { ok: true, value: 'ok' });
  assert.equal(calls, 1);
  const third = await runSave(async () => { calls++; }, { button: b, notify: quiet }); // al terminar, el bloqueo se libera
  assert.equal(third.ok, true);
  assert.equal(calls, 2);
});

test('el estado es local a cada botón: un guardado colgado no bloquea otro formulario', async () => {
  const a = fakeButton(), b = fakeButton();
  runSave(() => new Promise(() => {}), { button: a, timeoutMs: 10_000, notify: quiet });
  const r = await runSave(async () => 'otro formulario', { button: b, notify: quiet });
  assert.deepEqual(r, { ok: true, value: 'otro formulario' });
});

test('formulario cerrado mientras guarda: no hay errores al liberar un botón que ya no está en pantalla', async () => {
  const b = fakeButton();
  const r = await runSave(async () => { b.isConnected = false; return 'ok'; }, { button: b, notify: quiet });
  assert.equal(r.ok, true);
  assert.equal(b.loading, false);
});

test('una acción síncrona que lanza también se maneja', async (t) => {
  silenceConsole(t);
  const r = await runSave(() => { throw new Error('Revisa los datos'); }, { notify: quiet });
  assert.equal(r.ok, false);
});
