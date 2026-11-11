// La extracción a face-geometry.js no cambia nada del personaje: mismas salidas que la v1.7.1 (instantánea en fixtures).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../../js/ui/lukas-orb.js';
import * as G from '../../js/ui/face-geometry.js';
import { sample } from './fixtures/make-lukas-geometry.mjs';

const snap = JSON.parse(fs.readFileSync(new URL('./fixtures/lukas-geometry-v1.7.1.json', import.meta.url), 'utf8'));
const now = sample(L);

for (const k of Object.keys(snap)) {
  test(`lukas-orb idéntico a la v1.7.1: ${k}`, () => assert.deepEqual(now[k], snap[k]));
}

test('face-geometry: ojo y boca llenan el arreglo dado (sin objetos nuevos)', () => {
  const out = new Float64Array(6);
  assert.equal(G.eyePoints(out, 12, 1, 1, 0, 0, 0), out);
  assert.deepEqual([...out], [0, -6, 0, 0, 0, 6]);
  G.eyePoints(out, 12, 1, 1, 0, 0, 1);
  assert.deepEqual([...out], G.EYE_CLOSED);
  assert.equal(G.mouthPoints(out, 60, 71, 0, 0), out);
  assert.deepEqual([...out], [59.99, 71, 60, 71, 60.01, 71]);
});

test('face-geometry: approach es dt-correcto y nunca se pasa', () => {
  assert.equal(G.approach(0, 1, 0.5, 1), 0.5);
  assert.equal(G.approach(0, 1, 0.5, 0.5), 0.25);
  assert.equal(G.approach(0, 1, 3, 1), 1);
});
