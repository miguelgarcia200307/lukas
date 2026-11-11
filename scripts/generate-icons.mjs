// Genera íconos PWA, favicon, apple-touch-icon, badge de notificaciones, shortcuts, splash de iOS y og-image
// a partir del personaje (versión simplificada, la misma geometría que js/ui/lukas-orb.js).
// Uso: npm run icons  (requiere devDependency "sharp"; la og-image usa Chrome/Edge sin interfaz si está instalado)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { ROOT } from './env.mjs';
import { staticOrbSvg, BODY_UNITS } from '../js/ui/lukas-orb.js';

const ICONS = path.join(ROOT, 'assets', 'icons');
const SPLASH = path.join(ROOT, 'assets', 'splash');
fs.mkdirSync(ICONS, { recursive: true });
fs.mkdirSync(SPLASH, { recursive: true });

const BG = '#F7F7F4'; // fondo de la app
const PAPER = '#F6F5F2'; // fondo de los íconos

/** Personaje simplificado centrado en un lienzo S×S. body = diámetro del cuerpo como fracción de S. */
function iconSvg(S, { body = 0.66, bg = PAPER, rx = 0, id = 'i' } = {}) {
  const inner = staticOrbSvg({ simple: true, id }).replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
  const box = S * body * (76 / BODY_UNITS); // el viewBox simple mide 76 u y el cuerpo 66 u
  const o = (S - box) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
    ${bg ? `<rect width="${S}" height="${S}" rx="${rx}" fill="${bg}"/>` : ''}
    <svg x="${o}" y="${o}" width="${box}" height="${box}" viewBox="22 22 76 76">${inner}</svg></svg>`;
}

// Badge monocromo (Android solo usa el canal alfa): silueta con ojos y moneda calados
function badgeSvg(S) {
  const face = staticOrbSvg({ simple: true, id: 'bd' });
  const body = face.match(/<path d="([^"]+)" fill="url\(#bdb\)"/)[1];
  const strokes = [...face.matchAll(/<path d="([^"]+)" stroke="[^"]+" stroke-width="([^"]+)"\/>/g)].map(([, d, w]) => `<path d="${d}" stroke="#000" stroke-width="${w}" fill="none" stroke-linecap="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="22 22 76 76">
    <defs><mask id="m"><rect x="0" y="0" width="120" height="120" fill="#fff"/>${strokes.replaceAll('#000', '#000')}</mask></defs>
    <path d="${body}" fill="#000" mask="url(#m)"/></svg>`;
}

const shortcut = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${BG}"/>
  <g transform="translate(24 24) scale(2)" fill="none" stroke="#4B3BF5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
const GLYPHS = {
  'shortcut-voice': '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  'shortcut-add': '<path d="M12 5v14M5 12h14"/>',
  'shortcut-reports': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);

// favicon.svg: el personaje solo, sin fondo (se lee en pestañas claras y oscuras)
const favicon = staticOrbSvg({ simple: true, id: 'fv' }).replace(/\n\s*/g, ' ');
await Promise.all([
  png(iconSvg(512, { body: 0.62, rx: 112 }), 192, path.join(ICONS, 'icon-192.png')),
  png(iconSvg(512, { body: 0.62, rx: 112 }), 512, path.join(ICONS, 'icon-512.png')),
  // Maskable: lienzo completo; el cuerpo (con su firma) queda dentro de la zona segura del 80 %
  png(iconSvg(512, { body: 0.56 }), 192, path.join(ICONS, 'maskable-192.png')),
  png(iconSvg(512, { body: 0.56 }), 512, path.join(ICONS, 'maskable-512.png')),
  // Apple: lienzo completo (iOS redondea las esquinas)
  png(iconSvg(180, { body: 0.66 }), 180, path.join(ICONS, 'apple-touch-icon.png')),
  png(iconSvg(64, { body: 0.92, bg: null }), 32, path.join(ICONS, 'favicon-32.png')),
  png(iconSvg(64, { body: 0.92, bg: null }), 16, path.join(ICONS, 'favicon-16.png')),
  png(badgeSvg(512), 96, path.join(ICONS, 'badge-96.png')),
  ...Object.entries(GLYPHS).map(([name, g]) => png(shortcut(g), 96, path.join(ICONS, `${name}.png`))),
]);
fs.writeFileSync(path.join(ICONS, 'favicon.svg'), favicon + '\n');
fs.rmSync(path.join(ICONS, 'logo.svg'), { force: true }); // logo anterior
console.log('✔ íconos');

// Splash screens de iOS (portrait): [ancho px, alto px, ancho CSS, alto CSS, dpr]
// Fondo liso: la intro del personaje (la moneda cae, el orbe se infla) empieza sin corte al cargar la app.
export const SPLASHES = [
  [1320, 2868, 440, 956, 3], [1206, 2622, 402, 874, 3], [1290, 2796, 430, 932, 3], [1179, 2556, 393, 852, 3],
  [1284, 2778, 428, 926, 3], [1170, 2532, 390, 844, 3], [1125, 2436, 375, 812, 3], [1242, 2688, 414, 896, 3],
  [828, 1792, 414, 896, 2], [1242, 2208, 414, 736, 3], [750, 1334, 375, 667, 2], [640, 1136, 320, 568, 2],
  [2048, 2732, 1024, 1366, 2], [1668, 2388, 834, 1194, 2], [1640, 2360, 820, 1180, 2], [1620, 2160, 810, 1080, 2],
];
for (const [w, h] of SPLASHES) {
  await sharp({ create: { width: w, height: h, channels: 3, background: BG } }).png({ compressionLevel: 9 }).toFile(path.join(SPLASH, `splash-${w}x${h}.png`));
}
console.log(`✔ ${SPLASHES.length} splash screens`);

const links = SPLASHES.map(([w, h, cw, ch, dpr]) =>
  `<link rel="apple-touch-startup-image" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="./assets/splash/splash-${w}x${h}.png">`).join('\n    ');
fs.writeFileSync(path.join(SPLASH, 'links.html'), links + '\n');
console.log('✔ assets/splash/links.html (pegado en index.html)');

// og-image 1200×630: lockup horizontal + eslogan, con la tipografía real (Plus Jakarta Sans) vía Chrome
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!chrome) console.warn('⚠ og-image: no encontré Chrome/Edge (define CHROME_PATH)');
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lukas-og-'));
  const page = path.join(tmp, 'og.html');
  const orb = staticOrbSvg({ simple: false, id: 'og' });
  fs.writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&display=block">
    <style>html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:${PAPER};font-family:"Plus Jakarta Sans",sans-serif;-webkit-font-smoothing:antialiased}
    main{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 112px;gap:44px;box-sizing:border-box}
    .lk{display:flex;align-items:center;gap:40px}.orb{width:150px;height:150px;position:relative}.orb svg{position:absolute;left:-40.9%;top:-40.9%;width:181.8%;height:181.8%}
    .w{font-size:112px;font-weight:700;letter-spacing:-0.02em;color:#141413;line-height:1}
    p{margin:0;font-size:46px;font-weight:600;letter-spacing:-0.02em;color:#4E4E49}b{color:#141413;font-weight:700}
    i{display:inline-block;width:.32em;height:.32em;border-radius:50%;background:#C8F35A;margin-left:.04em}</style></head>
    <body><main><div class="lk"><div class="orb">${orb}</div><span class="w">Lukas</span></div>
    <p><b>Tus lucas, en orden.</b> Solo dilo<i></i></p></main></body></html>`);
  const out = path.join(ICONS, 'og-image.png');
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${path.join(tmp, 'p')}`,
    '--window-size=1200,630', '--virtual-time-budget=6000', `--screenshot=${out}`, pathToFileURL(page).href], { timeout: 60000 });
  if (r.status === 0 && fs.existsSync(out)) console.log('✔ og-image 1200×630');
  else console.warn('⚠ og-image falló', r.stderr?.toString().slice(0, 300));
}
