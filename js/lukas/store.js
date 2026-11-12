// Apariencia vigente de Lukas (ya validada contra el catálogo). Sin DOM ni red: lo leen todos los personajes y
// el renderizador; lo escribe sync.js (cuenta) y el editor (vista previa). Corre también en Node.
export const SLOTS = ['cabello', 'cabeza', 'gafas', 'vello', 'cuello', 'cara', 'extras'];

let current = Object.freeze({});
const subs = new Set();

/** ¿Lukas clásico? (ningún accesorio) */
export const isClassic = (cfg) => !cfg || !SLOTS.some((s) => typeof cfg[s] === 'string' && cfg[s]);

export const getLook = () => current;

/** Reemplaza la apariencia y avisa a todos los personajes (sin recargar). */
export function setLook(cfg) {
  const next = Object.freeze(cfg && typeof cfg === 'object' ? { ...cfg } : {});
  if (sameLook(next, current)) return;
  current = next;
  for (const fn of [...subs]) { try { fn(current); } catch (e) { console.error(e); } }
}

/** Suscribe y entrega de una vez la apariencia actual. Devuelve la función para quitar la suscripción. */
export function onLook(fn) {
  subs.add(fn);
  try { fn(current); } catch (e) { console.error(e); }
  return () => subs.delete(fn);
}

export function sameLook(a, b) {
  if (a === b) return true;
  for (const s of SLOTS) if ((a?.[s] || null) !== (b?.[s] || null)) return false;
  const ca = a?.colores ?? {}, cb = b?.colores ?? {};
  for (const s of SLOTS) if ((ca[s] || null) !== (cb[s] || null)) return false;
  return true;
}
