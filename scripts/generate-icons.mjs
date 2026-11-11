// Genera íconos PWA, apple-touch-icon, badge de notificaciones, íconos de shortcuts y splash screens de iOS
// a partir del logo SVG. Uso: npm run icons  (requiere devDependency "sharp")
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './env.mjs';

const ICONS = path.join(ROOT, 'assets', 'icons');
const SPLASH = path.join(ROOT, 'assets', 'splash');
fs.mkdirSync(ICONS, { recursive: true });
fs.mkdirSync(SPLASH, { recursive: true });

const BG = '#F7F7F4';
const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6C5DFF"/><stop offset="1" stop-color="#3A2BD9"/></linearGradient></defs>';
const MARK = (color = '#fff') => `
  <path d="M150 128V380H369" fill="none" stroke="${color}" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="233" y1="300" x2="233" y2="252" stroke="${color}" stroke-width="40" stroke-linecap="round"/>
  <line x1="301" y1="300" x2="301" y2="180" stroke="${color}" stroke-width="40" stroke-linecap="round"/>
  <line x1="369" y1="300" x2="369" y2="236" stroke="${color}" stroke-width="40" stroke-linecap="round"/>`;

// Ícono con esquinas redondeadas (para "any")
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRAD}<rect width="512" height="512" rx="128" fill="url(#g)"/>${MARK()}</svg>`;
// Sin esquinas (maskable / apple: el sistema recorta)
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRAD}<rect width="512" height="512" fill="url(#g)"/>${MARK()}</svg>`;
// Maskable: marca dentro de la zona segura (80%)
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRAD}<rect width="512" height="512" fill="url(#g)"/><g transform="translate(51.2 51.2) scale(0.8)">${MARK()}</g></svg>`;
// Badge monocromo (Android usa solo el canal alfa)
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(25.6 25.6) scale(0.9)">${MARK('#000')}</g></svg>`;

const shortcut = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="${BG}"/>
  <g transform="translate(24 24) scale(2)" fill="none" stroke="#4B3BF5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
const GLYPHS = {
  'shortcut-voice': '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  'shortcut-add': '<path d="M12 5v14M5 12h14"/>',
  'shortcut-reports': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);

await Promise.all([
  png(rounded, 192, path.join(ICONS, 'icon-192.png')),
  png(rounded, 512, path.join(ICONS, 'icon-512.png')),
  png(maskable, 192, path.join(ICONS, 'maskable-192.png')),
  png(maskable, 512, path.join(ICONS, 'maskable-512.png')),
  png(fullBleed, 180, path.join(ICONS, 'apple-touch-icon.png')),
  png(rounded, 32, path.join(ICONS, 'favicon-32.png')),
  png(badge, 96, path.join(ICONS, 'badge-96.png')),
  ...Object.entries(GLYPHS).map(([name, g]) => png(shortcut(g), 96, path.join(ICONS, `${name}.png`))),
]);
fs.writeFileSync(path.join(ICONS, 'logo.svg'), rounded);
console.log('✔ íconos');

// Splash screens de iOS (portrait): [ancho px, alto px, ancho CSS, alto CSS, dpr]
export const SPLASHES = [
  [1320, 2868, 440, 956, 3], [1206, 2622, 402, 874, 3], [1290, 2796, 430, 932, 3], [1179, 2556, 393, 852, 3],
  [1284, 2778, 428, 926, 3], [1170, 2532, 390, 844, 3], [1125, 2436, 375, 812, 3], [1242, 2688, 414, 896, 3],
  [828, 1792, 414, 896, 2], [1242, 2208, 414, 736, 3], [750, 1334, 375, 667, 2], [640, 1136, 320, 568, 2],
  [2048, 2732, 1024, 1366, 2], [1668, 2388, 834, 1194, 2], [1640, 2360, 820, 1180, 2], [1620, 2160, 810, 1080, 2],
];

for (const [w, h] of SPLASHES) {
  const s = Math.round(Math.min(w, h) * 0.24);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${BG}"/>
    <g transform="translate(${(w - s) / 2} ${(h - s) / 2 - s * 0.12}) scale(${s / 512})">${GRAD}<rect width="512" height="512" rx="128" fill="url(#g)"/>${MARK()}</g>
    <text x="${w / 2}" y="${(h + s) / 2 + s * 0.3}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="${Math.round(s * 0.28)}" fill="#141413" letter-spacing="-1">Lukas</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(SPLASH, `splash-${w}x${h}.png`));
}
console.log(`✔ ${SPLASHES.length} splash screens`);

// Etiquetas <link> para index.html
const links = SPLASHES.map(([w, h, cw, ch, dpr]) =>
  `<link rel="apple-touch-startup-image" media="(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" href="./assets/splash/splash-${w}x${h}.png">`).join('\n    ');
fs.writeFileSync(path.join(SPLASH, 'links.html'), links + '\n');
console.log('✔ assets/splash/links.html (pegado en index.html)');
