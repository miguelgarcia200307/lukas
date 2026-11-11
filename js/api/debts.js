import { emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createDebt(d) {
  const row = unwrap(await from('debts').insert(d).select().single());
  refresh('debts'); // en segundo plano: actualiza la pantalla sin retener el botón
  return row;
}

export async function updateDebt(id, patch) {
  unwrap(await from('debts').update(patch).eq('id', id));
  refresh('debts'); // en segundo plano: actualiza la pantalla sin retener el botón
}

export async function deleteDebt(id) {
  unwrap(await from('debts').delete().eq('id', id));
  refresh('debts'); // en segundo plano: actualiza la pantalla sin retener el botón
}

export async function debtPayments(debtId) {
  return unwrap(await from('debt_payments').select('*').eq('debt_id', debtId).order('paid_at', { ascending: false }));
}

/** mode: 'expense' (cuenta como gasto en Gastos financieros) | 'transfer' (solo mueve plata) */
export async function payDebt({ debtId, amount, accountId, mode = 'expense', date, note = null }) {
  const r = await rpc('pay_debt', { p_debt_id: debtId, p_amount: amount, p_account_id: accountId, p_mode: mode, p_date: date, p_note: note });
  refresh('debts', 'accounts'); // en segundo plano: actualiza la pantalla sin retener el botón
  emitChanged('transactions');
  return r;
}
