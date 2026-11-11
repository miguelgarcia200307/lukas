// Cliente ÚNICO de Supabase para toda la app (singleton de módulo: no crear otro en ningún lugar).
// supabase-js ≥ 2.107 coordina la sesión sin `navigator.locks` (lockless). La 2.49.4 esperaba ese lock sin límite
// antes de cada petición y en iOS Safari podía quedar tomado: desde ahí ninguna petición salía y "Guardar" se
// quedaba cargando para siempre. No pasar la opción `lock` (devolvería el comportamiento con lock).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/** Ninguna petición al backend puede quedar pendiente para siempre: se cancela a los 20 s */
export const REQUEST_TIMEOUT_MS = 20_000;
function fetchWithTimeout(input, init = {}) {
  const timeout = AbortSignal.timeout?.(REQUEST_TIMEOUT_MS);
  const signal = timeout && init.signal && AbortSignal.any ? AbortSignal.any([init.signal, timeout]) : (init.signal ?? timeout);
  return fetch(input, { ...init, signal });
}

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'lukas-auth',
  },
  global: { fetch: fetchWithTimeout },
});
