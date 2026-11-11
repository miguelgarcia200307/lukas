// Arranque: máquina de estados de la sesión en el router y regla de recarga del service worker. Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH, guardRoute, shouldReloadOnControllerChange } from '../../js/route-guard.js';

const login = { path: 'login', public: true };
const inicio = { path: 'inicio' };
const ajustes = { path: 'ajustes' };

test('mientras la sesión carga no se decide ninguna redirección', () => {
  for (const r of [null, login, inicio, ajustes]) assert.deepEqual(guardRoute(r, AUTH.LOADING), { wait: true });
});

test('sin sesión: las rutas protegidas van al login y el login se muestra', () => {
  assert.deepEqual(guardRoute(inicio, AUTH.UNAUTHENTICATED), { redirect: 'login' });
  assert.deepEqual(guardRoute(ajustes, AUTH.UNAUTHENTICATED), { redirect: 'login' });
  assert.deepEqual(guardRoute(null, AUTH.UNAUTHENTICATED), { redirect: 'login' });
  assert.deepEqual(guardRoute(login, AUTH.UNAUTHENTICATED), { ok: true });
});

test('con sesión: el login va al inicio y las rutas protegidas se muestran', () => {
  assert.deepEqual(guardRoute(login, AUTH.AUTHENTICATED), { redirect: 'inicio' });
  assert.deepEqual(guardRoute(null, AUTH.AUTHENTICATED), { redirect: 'inicio' });
  assert.deepEqual(guardRoute(ajustes, AUTH.AUTHENTICATED), { ok: true });
});

test('transiciones loading → authenticated / unauthenticated', () => {
  // La misma ruta pasa de "esperar" a una decisión solo cuando la sesión se resuelve
  assert.ok(guardRoute(inicio, AUTH.LOADING).wait);
  assert.ok(guardRoute(inicio, AUTH.AUTHENTICATED).ok);
  assert.equal(guardRoute(inicio, AUTH.UNAUTHENTICATED).redirect, 'login');
});

test('service worker: la primera instalación no recarga; un reemplazo real o "Actualizar ahora" sí', () => {
  assert.equal(shouldReloadOnControllerChange({ wasControlled: false, userRequested: false }), false); // clients.claim() inicial
  assert.equal(shouldReloadOnControllerChange({ wasControlled: true, userRequested: false }), true); // otra pestaña aplicó una versión nueva
  assert.equal(shouldReloadOnControllerChange({ wasControlled: false, userRequested: true }), true);
  // Secuencia de una misma pestaña: instalación inicial (sin recarga) y luego una actualización real (recarga)
  let controlled = false;
  const change = () => { const r = shouldReloadOnControllerChange({ wasControlled: controlled, userRequested: false }); controlled = true; return r; };
  assert.equal(change(), false);
  assert.equal(change(), true);
});
