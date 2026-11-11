// Carga y cachea los catálogos del usuario (categorías, cuentas, tarjetas, créditos, suscripciones, metas, presupuestos)
import { state, emitChanged } from '../state.js';
import { from, unwrap } from './base.js';

const loaders = {
  categories: async () => unwrap(await from('categories').select('*').order('kind').order('sort_order').order('name')),
  accounts: async () => unwrap(await from('account_balances').select('*').order('sort_order').order('name')),
  cards: async () => unwrap(await from('card_status').select('*').order('created_at')),
  debts: async () => unwrap(await from('debt_status').select('*').order('created_at')),
  subscriptions: async () => unwrap(await from('subscription_status').select('*').order('next_charge_date')),
  goals: async () => unwrap(await from('goal_status').select('*').order('created_at')),
  budgets: async () => unwrap(await from('budgets').select('*, categories(name, color, icon)').order('created_at')),
};

export async function refresh(...keys) {
  const list = keys.length ? keys : Object.keys(loaders);
  const results = await Promise.allSettled(list.map((k) => loaders[k]()));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') state[list[i]] = r.value;
    else console.error(`[catalog] ${list[i]}`, r.reason);
  });
  emitChanged(...list);
}

/** Guarda en caché local para arrancar rápido y funcionar offline */
const CACHE_KEY = 'lukas-catalog-v1';
export function persistCatalog() {
  try {
    const snap = Object.fromEntries(Object.keys(loaders).map((k) => [k, state[k]]));
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), snap, profile: state.profile }));
  } catch { /* cuota llena o modo privado */ }
}
export function restoreCatalog() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!raw) return false;
    Object.entries(raw.snap).forEach(([k, v]) => { if (Array.isArray(v)) state[k] = v; });
    if (raw.profile) state.profile = raw.profile;
    return true;
  } catch { return false; }
}
export function clearCatalog() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* nada */ }
}
