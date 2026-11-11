// Store mínimo con suscripciones por clave + bus de eventos de datos
const data = {
  session: null,
  authStatus: 'loading', // 'loading' | 'authenticated' | 'unauthenticated' (ver route-guard.js)
  profile: null,
  categories: [],
  accounts: [],
  cards: [],
  debts: [],
  subscriptions: [],
  goals: [],
  budgets: [],
  unread: 0,
  online: navigator.onLine,
  pendingSync: 0,
};
const listeners = new Map();

export const state = new Proxy(data, {
  set(target, key, value) {
    target[key] = value;
    (listeners.get(key) ?? []).forEach((fn) => { try { fn(value); } catch (e) { console.error(e); } });
    (listeners.get('*') ?? []).forEach((fn) => fn(key, value));
    return true;
  },
});

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

/** Eventos: 'data:changed' (detail: { entities: [...] }) */
const bus = new EventTarget();
export function emitChanged(...entities) {
  bus.dispatchEvent(new CustomEvent('data:changed', { detail: { entities } }));
}
export function onChanged(fn) {
  const h = (e) => fn(e.detail.entities);
  bus.addEventListener('data:changed', h);
  return () => bus.removeEventListener('data:changed', h);
}

// Atajos de lectura
export const categoryById = (id) => data.categories.find((c) => c.id === id);
export const accountById = (id) => data.accounts.find((a) => a.id === id);
export const cardById = (id) => data.cards.find((c) => c.id === id);
export const activeCategories = (kind) =>
  data.categories.filter((c) => !c.archived && (!kind || c.kind === kind));
export const topCategories = (kind) => activeCategories(kind).filter((c) => !c.parent_id);
export const childCategories = (parentId) => data.categories.filter((c) => c.parent_id === parentId && !c.archived);
