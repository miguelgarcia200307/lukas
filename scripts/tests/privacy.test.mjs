// Pruebas del modo privado (lógica y persistencia). Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacy, PRIVACY_KEYS, STORAGE_KEY } from '../../js/privacy.js';
import { sensitiveAmount, sensitiveLine, MASK } from '../../js/ui/sensitive.js';

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) };
};

test('por defecto todo visible', () => {
  const p = createPrivacy(memoryStorage());
  assert.equal(PRIVACY_KEYS.some((k) => p.isHidden(k)), false);
  assert.equal(p.allHidden(), false);
});

test('el ojito individual alterna solo esa tarjeta', () => {
  const p = createPrivacy(memoryStorage());
  p.toggle('accounts');
  assert.equal(p.isHidden('accounts'), true);
  assert.equal(p.isHidden('creditCards'), false);
  p.toggle('accounts');
  assert.equal(p.isHidden('accounts'), false);
  p.toggle('desconocida'); // claves ajenas se ignoran
  assert.equal(PRIVACY_KEYS.some((k) => p.isHidden(k)), false);
});

test('toggleAll: con al menos una visible oculta todas; con todas ocultas muestra todas (incluido el caso mixto)', () => {
  const p = createPrivacy(memoryStorage());
  p.toggleAll(); // todo visible → todo oculto
  assert.equal(p.allHidden(), true);
  p.toggleAll(); // todo oculto → todo visible
  assert.ok(PRIVACY_KEYS.every((k) => !p.isHidden(k)));
  p.toggle('loans'); p.toggle('subscriptions'); // mixto
  assert.equal(p.allHidden(), false);
  p.toggleAll(); // mixto → todo oculto
  assert.equal(p.allHidden(), true);
});

test('el estado global se recalcula solo: ocultar las 4 una por una deja todo oculto', () => {
  const p = createPrivacy(memoryStorage());
  let calls = 0;
  p.onPrivacyChange(() => calls++);
  for (const k of PRIVACY_KEYS) p.toggle(k);
  assert.equal(p.allHidden(), true);
  assert.equal(calls, 4);
});

test('persistencia local entre sesiones (y datos corruptos → todo visible)', () => {
  const st = memoryStorage();
  const a = createPrivacy(st);
  a.toggle('creditCards');
  a.toggle('loans');
  const b = createPrivacy(st); // "reabrir la app"
  assert.equal(b.isHidden('creditCards'), true);
  assert.equal(b.isHidden('loans'), true);
  assert.equal(b.isHidden('accounts'), false);
  assert.deepEqual(JSON.parse(st.dump()[STORAGE_KEY]).hidden.sort(), ['creditCards', 'loans']);
  assert.equal(createPrivacy(memoryStorage({ [STORAGE_KEY]: '{no es json' })).allHidden(), false);
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const c = createPrivacy(broken); // sin almacenamiento: funciona en memoria
  c.toggle('accounts');
  assert.equal(c.isHidden('accounts'), true);
});

test('máscara de longitud fija y sin el valor real', () => {
  for (const v of [5, 63800, 30711000, 9999999999]) {
    const s = String(sensitiveAmount(v, { hidden: true }));
    assert.ok(s.includes(MASK));
    assert.ok(!/\d/.test(s.replace(/class="[^"]*"/g, '')), `sin dígitos: ${s}`);
  }
  const line = String(sensitiveLine(1469000, { hidden: true, before: 'Debes ' }));
  assert.ok(line.includes('Debes ') && line.includes('saldo oculto') && line.includes('aria-hidden="true"'));
  assert.ok(!line.includes('1.469.000'));
  assert.ok(String(sensitiveLine(1469000, { before: 'Debes ' })).includes('$1.469.000'));
});
