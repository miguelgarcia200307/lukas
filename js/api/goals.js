import { emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createGoal(g) {
  const row = unwrap(await from('savings_goals').insert(g).select().single());
  await refresh('goals');
  return row;
}

export async function updateGoal(id, patch) {
  unwrap(await from('savings_goals').update(patch).eq('id', id));
  await refresh('goals');
}

export async function deleteGoal(id) {
  unwrap(await from('savings_goals').delete().eq('id', id));
  await refresh('goals');
}

/** amount negativo = retiro de la meta */
export async function contribute({ goalId, amount, accountId = null, date, note = null }) {
  await rpc('contribute_goal', { p_goal_id: goalId, p_amount: amount, p_account_id: accountId, p_date: date, p_note: note });
  await refresh('goals', 'accounts');
  emitChanged('transactions');
}
