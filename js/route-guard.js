// Reglas puras del arranque (sin DOM): qué hace el router según el estado de la sesión y cuándo recargar por el
// service worker. Se prueban en scripts/tests/boot.test.mjs.

/** Estado de autenticación: se resuelve UNA vez en el arranque (getSession) y luego lo actualiza onAuthStateChange */
export const AUTH = { LOADING: 'loading', AUTHENTICATED: 'authenticated', UNAUTHENTICATED: 'unauthenticated' };

/**
 * Decide qué hacer con una ruta. Mientras la sesión carga no se decide ninguna redirección (se espera).
 * route: la ruta encontrada (o null si el hash no coincide con ninguna)
 * → { wait: true } | { redirect: 'login' | 'inicio' } | { ok: true }
 */
export function guardRoute(route, status) {
  if (status === AUTH.LOADING) return { wait: true };
  const signedIn = status === AUTH.AUTHENTICATED;
  if (!route) return { redirect: signedIn ? 'inicio' : 'login' };
  if (!route.public && !signedIn) return { redirect: 'login' };
  if (route.path === 'login' && signedIn) return { redirect: 'inicio' };
  return { ok: true };
}

/**
 * ¿Recargar cuando cambia el service worker que controla la página?
 * - Primera instalación (la página no estaba controlada): clients.claim() dispara controllerchange y NO hay que
 *   recargar (esa recarga era la "doble carga" al entrar por primera vez).
 * - Reemplazo de una versión que ya controlaba la página, o el usuario tocó "Actualizar ahora": sí.
 */
export const shouldReloadOnControllerChange = ({ wasControlled, userRequested }) => !!(userRequested || wasControlled);
