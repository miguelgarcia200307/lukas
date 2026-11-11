// Mecanismo ÚNICO de guardado para todos los formularios y botones "Guardar" de la app.
// Garantías:
// - El estado de carga es local a ESE botón (cada apertura de un formulario crea su propio botón): nunca global.
// - Se libera SIEMPRE en finally (éxito, error o timeout). Doble clic mientras guarda: se ignora; al terminar, se libera.
// - El botón depende solo de la escritura: las recargas de datos posteriores corren en segundo plano (api/*).
// - Red de seguridad: si la acción no termina en SAVE_TIMEOUT_MS, se libera el botón y se muestra un error
//   (además, cada petición HTTP se cancela a los 20 s en js/supabase.js).
// - Error visible con el toast de la app; los datos del formulario no se tocan, para poder reintentar.
// - Si el formulario se cerró mientras guardaba, no se toca un botón que ya no está en pantalla.

export const SAVE_TIMEOUT_MS = 25_000;
export const TIMEOUT_MESSAGE = 'Se demoró demasiado en guardar. Revisa tu conexión e intenta de nuevo.';

export class SaveTimeoutError extends Error {
  constructor() { super(TIMEOUT_MESSAGE); this.name = 'SaveTimeoutError'; }
}

let defaultNotify = null;
/** La app registra su toast (así este módulo no depende del DOM y se puede probar en Node) */
export const setSaveNotifier = (fn) => { defaultNotify = fn; };

function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.saving = '1';
    button.classList.add('loading');
    button.setAttribute('aria-busy', 'true');
  } else {
    delete button.dataset.saving;
    button.classList.remove('loading');
    button.removeAttribute('aria-busy');
  }
}

/**
 * Ejecuta un guardado.
 * action: () => Promise<valor>   ·   button: el botón que muestra la carga (opcional)
 * → { ok: true, value } | { ok: false, error } | { ok: false, skipped: true } (ya estaba guardando)
 */
export async function runSave(action, { button = null, timeoutMs = SAVE_TIMEOUT_MS, notify = defaultNotify, fallbackMessage = 'No se pudo guardar. Intenta de nuevo.' } = {}) {
  if (button?.dataset?.saving === '1') return { ok: false, skipped: true };
  setBusy(button, true);
  let timer = null;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new SaveTimeoutError()), timeoutMs); });
    const value = await Promise.race([Promise.resolve().then(action), timeout]);
    return { ok: true, value };
  } catch (error) {
    console.error('[guardar]', error);
    notify?.(error?.message || fallbackMessage, { type: 'err' });
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
    setBusy(button, false);
  }
}
