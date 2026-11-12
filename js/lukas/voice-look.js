// El estilo de Lukas también en la hoja de voz. La hoja (js/voice/voice-sheet.js, que no se toca) monta su propio
// orbe de canvas en document.body; aquí se detecta al aparecer, se toma su orbe desde la lista pública de caras
// (faceList(), solo lectura) y se le ponen las mismas capas del Inicio (hero-look.js): siguen cada frame su
// centro, estiramiento, inclinación, ondulación al escuchar y al hablar, el modo compacto y las partículas.
// Con Lukas clásico no se carga nada.
import { getLook, isClassic, onLook } from './store.js';

const attached = new Map(); // canvas → { destroy }

async function attach(sheet) {
  const canvas = sheet.querySelector('.orb-canvas');
  if (!canvas || attached.has(canvas)) return;
  attached.set(canvas, null); // reservado mientras carga
  try {
    const [{ faceList }, { attachHeroLook }] = await Promise.all([import('../voice/orb-face.js'), import('./hero-look.js')]);
    // El orbe nace justo después de abrir la hoja: se espera a que su cara exista (máx. ~1 s)
    let face = null;
    for (let i = 0; i < 60 && canvas.isConnected; i++) {
      face = faceList().find((f) => f.canvas === canvas) ?? null;
      if (face) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (!face || !canvas.isConnected) { attached.delete(canvas); return; }
    attached.set(canvas, attachHeroLook(face.orb, canvas.parentElement));
  } catch (e) {
    attached.delete(canvas);
    console.error(e);
  }
}

function sweep() {
  for (const [canvas, ctl] of attached) {
    if (canvas.isConnected) continue;
    ctl?.destroy();
    attached.delete(canvas);
  }
}

const sheetsIn = (nodes) => [...nodes].flatMap((n) => (n.nodeType !== 1 ? [] : n.matches('.voice-sheet') ? [n] : [...n.querySelectorAll?.('.voice-sheet') ?? []]));

export function initVoiceLook() {
  if (typeof MutationObserver !== 'function') return;
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.removedNodes.length) sweep();
      if (!isClassic(getLook())) for (const s of sheetsIn(r.addedNodes)) attach(s);
    }
  }).observe(document.body, { childList: true });
  // Si el look cambia con la hoja abierta (raro), también se monta
  onLook((cfg) => { if (!isClassic(cfg)) document.querySelectorAll('.voice-sheet').forEach(attach); });
}
