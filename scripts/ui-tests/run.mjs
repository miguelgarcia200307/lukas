// Corre las pruebas de navegador (scripts/ui-tests/*.html) en Chrome/Edge sin interfaz. Uso: npm run test:ui
// Sirve el repositorio en un puerto local, abre cada página y lee el bloque "RESULTS:" que deja la prueba.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const chrome = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && fs.existsSync(p));
if (!chrome) { console.error('No encontré Chrome/Edge. Define CHROME_PATH.'); process.exit(1); }

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let failed = 0;
const pages = fs.readdirSync(path.join(ROOT, 'scripts/ui-tests')).filter((f) => f.endsWith('.html'));
for (const page of pages) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lukas-ui-'));
  // Presupuesto de tiempo virtual por página (meta ui-test-budget); 6 s por defecto
  const budget = /<meta name="ui-test-budget" content="(\d+)">/.exec(fs.readFileSync(path.join(ROOT, 'scripts/ui-tests', page), 'utf8'))?.[1] ?? '6000';
  // spawn asíncrono: con spawnSync el servidor de este mismo proceso no podría responder
  const r = await new Promise((resolve) => {
    const p = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `--virtual-time-budget=${budget}`,
      '--window-size=390,900', '--dump-dom', `http://127.0.0.1:${port}/scripts/ui-tests/${page}`]);
    let stdout = '';
    const kill = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', (d) => { stdout += d; });
    p.on('close', () => { clearTimeout(kill); resolve({ stdout }); });
  });
  fs.rmSync(profile, { recursive: true, force: true });
  const m = /RESULTS:(\[.*?\])<\/pre>/s.exec(r.stdout ?? '');
  console.log(`\n▶ ${page}`);
  if (!m) { console.log('  ✘ la página no entregó resultados'); failed++; continue; }
  for (const t of JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))) {
    console.log(`  ${t.ok ? '✔' : '✘'} ${t.name}${t.ok || !t.extra ? '' : ` (${t.extra})`}`);
    if (!t.ok) failed++;
  }
}
server.close();
console.log(failed ? `\n${failed} fallaron` : '\nTodo bien');
process.exit(failed ? 1 : 0);
