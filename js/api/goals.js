import { emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createGoal(g) {
  const row = unwrap(await from('savings_goals').insert(g).select().single());
  refresh('goals'); // en segundo plano: actualiza la pantalla sin retener el botón
  return row;
}

export async function updateGoal(id, patch) {
  unwrap(await from('savings_goals').update(patch).eq('id', id));
  refresh('goals'); // en segundo plano: actualiza la pantalla sin retener el botón
}

export async function deleteGoal(id) {
  unwrap(await from('savings_goals').delete().eq('id', id));
  refresh('goals'); // en segundo plano: actualiza la pantalla sin retener el botón
}

/** amount negativo = retiro de la meta */
export async function contribute({ goalId, amount, accountId = null, date, note = null }) {
  await rpc('contribute_goal', { p_goal_id: goalId, p_amount: amount, p_account_id: accountId, p_date: date, p_note: note });
  refresh('goals', 'accounts'); // en segundo plano: actualiza la pantalla sin retener el botón
  emitChanged('transactions');
}
