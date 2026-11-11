// La versión debe coincidir en sw.js, js/config.js y version.json (si no, el modal mostraría otro número)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('versión sincronizada en sw.js, config.js y version.json', () => {
  const sw = /const VERSION = 'lukas-v([\d.]+)'/.exec(fs.readFileSync('sw.js', 'utf8'))?.[1];
  const app = /APP_VERSION = '([\d.]+)'/.exec(fs.readFileSync('js/config.js', 'utf8'))?.[1];
  const info = JSON.parse(fs.readFileSync('version.json', 'utf8'));
  assert.ok(sw && app);
  assert.equal(sw, app);
  assert.equal(info.version, app);
  assert.ok(Array.isArray(info.notes) && info.notes.length > 0 && info.notes.length <= 5, 'entre 1 y 5 novedades');
});
