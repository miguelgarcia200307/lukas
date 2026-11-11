// Cola offline en IndexedDB para registros manuales. Se sincroniza al volver la conexión y al abrir la app.
import { state } from './state.js';

const DB = 'lukas-offline';
const STORE = 'queue';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export async function enqueue(kind, payload) {
  const item = { id: crypto.randomUUID(), kind, payload, created_at: Date.now() };
  await tx('readwrite', (s) => s.put(item));
  await updateCount();
  return item;
}

async function all() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.created_at - b.created_at));
    req.onerror = () => reject(req.error);
  });
}

async function remove(id) {
  await tx('readwrite', (s) => s.delete(id));
  await updateCount();
}

export async function updateCount() {
  try { state.pendingSync = (await all()).length; } catch { state.pendingSync = 0; }
}

let syncing = false;
/** handlers: { [kind]: async (payload) => void } */
export async function flush(handlers) {
  if (syncing || !navigator.onLine) return 0;
  syncing = true;
  let done = 0;
  try {
    for (const item of await all()) {
      const h = handlers[item.kind];
      if (!h) { await remove(item.id); continue; }
      try {
        await h(item.payload);
        await remove(item.id);
        done++;
      } catch (err) {
        console.warn('[offline] no se pudo sincronizar', item, err);
        if (!navigator.onLine) break;
        // Error de datos (no de red): se descarta para no bloquear la cola
        if (!/Sin conexión/.test(err?.message ?? '')) await remove(item.id);
      }
    }
  } finally {
    syncing = false;
  }
  return done;
}
