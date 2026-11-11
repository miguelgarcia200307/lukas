// Genera la instantánea de la geometría pura de lukas-orb.js (se corrió UNA vez con la v1.7.1, antes de extraer face-geometry.js).
import fs from 'node:fs';
import * as L from '../../../js/ui/lukas-orb.js';
export function sample(L) {
  const out = { eye: [], mouth: [], contour: [], curves: [], static: [] };
  const vals = [0, 0.3, 0.75, 1, 1.4];
  for (const h of [6, 12, 13, 15.6]) for (const open of [0, 0.5, 0.78, 1, 1.2]) for (const grow of [0, 0.4, 1])
    for (const happy of vals) for (const tired of [0, 0.5, 1]) for (const closed of [0, 0.6]) {
      out.eye.push(L.eyePath(50.5, 55, { h, open, grow, happy, tired, closed, gx: 1.3, gy: -0.7 }));
    }
  out.eye.push(L.eyePath(69.5, 52.5));
  for (const hw of [0, 0.004, 2, 3.2, 4.8, 8.5]) for (const c of [-3, 0, 0.4, 7.5]) out.mouth.push(L.mouthPath(60, 71, hw, c));
  for (const sc of [0.3, 1, 1.2]) for (const amp of [0, 0.018, 0.26]) for (const b of [0, 0.14]) out.contour.push(L.contourPath(sc, amp, 1.7, b, -2.3));
  for (let x = -0.2; x <= 1.6; x += 0.05) out.curves.push([L.spring(x), L.easeInOutCubic(Math.min(1, Math.max(0, x))), L.easeOutCubic(x), L.shakeX(x), L.nearestRest(x * 9)]);
  for (const simple of [true, false]) for (const mood of ['neutral', 'tired']) out.static.push(L.staticOrbSvg({ simple, mood, id: 'x' }));
  return out;
}
if (process.argv[2] === 'write') fs.writeFileSync(new URL('./lukas-geometry-v1.7.1.json', import.meta.url), JSON.stringify(sample(L)));
