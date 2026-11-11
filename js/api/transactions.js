// Movimientos: lectura con filtros y escrituras atómicas vía RPC
import { emitChanged } from '../state.js';
import { from, rpc, unwrap, AppError } from './base.js';
import { refresh } from './catalog.js';
import { enqueue } from '../offline-queue.js';
import { addDays } from '../utils/dates.js';

const SELECT = '*, transaction_items(id, name, qty, unit_amount, sort_order)';

/**
 * filtros: { from, to (YYYY-MM-DD), type, categoryIds[], accountId, cardId, search, limit, offset }
 */
export async function listTransactions(f = {}) {
  let q = from('transactions').select(SELECT).order('occurred_at', { ascending: false }).order('created_at', { ascending: false });
  if (f.from) q = q.gte('occurred_at', `${f.from}T00:00:00-05:00`);
  if (f.to) q = q.lt('occurred_at', `${addDays(f.to, 1)}T00:00:00-05:00`);
  if (f.type) q = q.eq('type', f.type);
  if (f.categoryIds?.length) q = q.in('category_id', f.categoryIds);
  if (f.accountId) q = q.or(`account_id.eq.${f.accountId},to_account_id.eq.${f.accountId}`);
  if (f.cardId) q = q.or(`card_id.eq.${f.cardId},to_card_id.eq.${f.cardId}`);
  if (f.search) {
    const s = f.search.replace(/[%,()]/g, ' ').trim();
    if (s) q = q.or(`description.ilike.%${s}%,notes.ilike.%${s}%`);
  }
  q = q.range(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 60) - 1);
  return unwrap(await q);
}

function afterWrite() {
  emitChanged('transactions');
  refresh('accounts', 'cards', 'debts', 'goals', 'subscriptions').catch(() => {});
}

/**
 * rows: [{ id?, type, amount, occurred_at, description, category_id, account_id|card_id, to_account_id, notes, source, transcript, group_id, items }]
 * Si no hay conexión y allowOffline, se encola (los ids se generan en el cliente para que el reintento sea idempotente).
 */
export async function createTransactions(rows, { allowOffline = false } = {}) {
  const withIds = rows.map((r) => ({ id: r.id ?? crypto.randomUUID(), ...r }));
  if (!navigator.onLine && allowOffline) {
    await enqueue('create_transactions', withIds);
    return { ids: withIds.map((r) => r.id), queued: true };
  }
  try {
    const ids = await rpc('create_transactions', { p_rows: withIds });
    afterWrite();
    return { ids, queued: false };
  } catch (err) {
    if (allowOffline && (!navigator.onLine || /Sin conexión/.test(err.message))) {
      await enqueue('create_transactions', withIds);
      return { ids: withIds.map((r) => r.id), queued: true };
    }
    throw err;
  }
}

export async function syncCreate(rows) {
  await rpc('create_transactions', { p_rows: rows });
  afterWrite();
}

export async function updateTransaction(id, row) {
  await rpc('update_transaction', { p_id: id, p_row: row });
  afterWrite();
}

export async function deleteTransactions(ids) {
  if (!ids.length) return 0;
  const n = await rpc('delete_transactions', { p_ids: ids });
  afterWrite();
  return n;
}

/** Restaura movimientos borrados (deshacer) recreándolos con el mismo id */
export async function restoreTransactions(txs) {
  // Los pagos de créditos y aportes a metas tienen registros ligados que no se pueden recrear aquí
  const rows = txs.filter((t) => !t.debt_id && !t.goal_id).map((t) => ({
    id: t.id, type: t.type, amount: t.amount, occurred_at: t.occurred_at, description: t.description,
    category_id: t.category_id, account_id: t.account_id, card_id: t.card_id, to_account_id: t.to_account_id, to_card_id: t.to_card_id,
    notes: t.notes, source: t.source, transcript: t.transcript, group_id: t.group_id, card_movement_kind: t.card_movement_kind,
    items: (t.transaction_items ?? []).map((i) => ({ name: i.name, qty: i.qty, unit_amount: i.unit_amount })),
  }));
  if (!rows.length) throw new AppError('Este movimiento no se puede restaurar');
  await rpc('create_transactions', { p_rows: rows });
  afterWrite();
}
