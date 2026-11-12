// Apariencia de Lukas por cuenta: Supabase (tabla lukas_apariencia) + caché local por user_id.
// - Al cargar: valida contra el catálogo (IDs desconocidos y colores fuera de la paleta se descartan en silencio).
// - Guardado optimista: la UI cambia al instante; sin conexión queda pendiente y se reintenta al volver la red.
// - Conflictos: gana el updated_at más reciente (la RPC no pisa una fila más nueva y devuelve la vigente).
// - Dos cuentas en el mismo dispositivo nunca comparten caché; al cerrar sesión se borra la de esa cuenta.
import { sb } from '../supabase.js';
import { state, subscribe } from '../state.js';
import { setLook, getLook, isClassic } from './store.js';

export const LOOK_VERSION = 1;
const KEY = (uid) => `lukas.look.v${LOOK_VERSION}.${uid}`;
const SEEN = (uid) => `lukas.look.seen.${uid}`;
let uid = null;
let pulling = null;
const listeners = new Set();

const read = (id) => { try { return JSON.parse(localStorage.getItem(KEY(id)) ?? 'null'); } catch { return null; } };
const write = (id, v) => { try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const drop = (id) => { try { localStorage.removeItem(KEY(id)); } catch { /* nada */ } };
const time = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : 0; };

/** Valida (importa el catálogo solo si hay algo que validar) y publica la apariencia en todos los personajes. */
async function apply(raw) {
  if (isClassic(raw)) { setLook({}); return {}; }
  const { validateLook } = await import('./catalog.js');
  const cfg = validateLook(raw);
  setLook(cfg);
  return cfg;
}

/** Estado del guardado para el editor: 'ok' | 'pending' | 'saving' */
export const syncState = () => (uid && read(uid)?.pending ? 'pending' : 'ok');
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((f) => { try { f(syncState()); } catch (e) { console.error(e); } });

/** ¿Ya conoce la función? (una vez por cuenta: el aviso del Inicio no se repite) */
export function discovered() {
  if (!uid) return true;
  try { return localStorage.getItem(SEEN(uid)) === '1' || !!read(uid)?.server; } catch { return true; }
}
export function markDiscovered() { try { if (uid) localStorage.setItem(SEEN(uid), '1'); } catch { /* nada */ } }

export function initLookSync() {
  subscribe('session', (s) => switchUser(s?.user?.id ?? null));
  window.addEventListener('online', () => { if (uid) pull(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && uid && read(uid)?.pending) push(); });
  switchUser(state.session?.user?.id ?? null);
}

function switchUser(next) {
  if (next === uid) return;
  const prev = uid;
  uid = next;
  if (prev) drop(prev); // cerrar sesión (o cambiar de cuenta) limpia la caché de esa cuenta
  if (!next) { setLook({}); notify(); return; }
  const cached = read(next);
  apply(cached?.config ?? {}).catch((e) => console.error(e));
  pull();
}

/** Trae la fila del servidor y resuelve contra la caché (gana el updated_at más reciente). */
export function pull() {
  if (!uid || !navigator.onLine) return Promise.resolve();
  if (pulling) return pulling;
  const me = uid;
  pulling = (async () => {
    const { data, error } = await sb.from('lukas_apariencia').select('config, version, updated_at').eq('user_id', me).maybeSingle();
    if (me !== uid) return;
    if (error) throw error;
    const local = read(me);
    if (local?.pending && (!data || time(local.updated_at) > time(data.updated_at))) { await push(); return; }
    if (!data) {
      if (local && !local.pending) { write(me, { config: {}, updated_at: local.updated_at }); await apply({}); }
      return;
    }
    const cfg = await apply(data.config ?? {});
    write(me, { config: cfg, updated_at: data.updated_at, server: true });
    notify();
  })().catch((e) => console.warn('[lukas] no se pudo leer la apariencia', e?.message ?? e)).finally(() => { pulling = null; });
  return pulling;
}

let pushing = null;
async function push() {
  if (!uid || !navigator.onLine) return;
  if (pushing) return pushing;
  const me = uid;
  pushing = (async () => {
    const local = read(me);
    if (!local?.pending) return;
    const { data, error } = await sb.rpc('guardar_lukas_apariencia', { p_config: local.config ?? {}, p_version: LOOK_VERSION, p_updated_at: local.updated_at });
    if (me !== uid) return;
    if (error) throw error;
    const now = read(me);
    if (now?.pending && now.updated_at !== local.updated_at) return; // otro cambio llegó mientras tanto: se sube en la próxima
    const row = Array.isArray(data) ? data[0] : data;
    const serverNewer = row && time(row.updated_at) > time(local.updated_at);
    const cfg = serverNewer ? await apply(row.config ?? {}) : local.config;
    write(me, { config: cfg, updated_at: row?.updated_at ?? local.updated_at, server: true });
  })().catch((e) => console.warn('[lukas] apariencia pendiente de sincronizar', e?.message ?? e)).finally(() => { pushing = null; notify(); });
  return pushing;
}

/** Guardado optimista: refleja al instante en todos los Lukas y sincroniza en segundo plano (o al volver la red). */
export async function saveLook(cfg) {
  const clean = await apply(cfg);
  if (!uid) return clean;
  write(uid, { config: clean, updated_at: new Date().toISOString(), pending: true, server: read(uid)?.server });
  markDiscovered();
  notify();
  push();
  return clean;
}

/** Apariencia guardada (la que ven todos los Lukas fuera del editor). */
export const savedLook = () => getLook();
