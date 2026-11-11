import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export const budgetStatus = () => rpc('budget_status');

export async function saveBudget({ id, category_id, period, amount, alert_thresholds = [80, 100] }) {
  const row = { category_id: category_id || null, period, amount, alert_thresholds };
  if (id) unwrap(await from('budgets').update(row).eq('id', id));
  else unwrap(await from('budgets').insert(row));
  await refresh('budgets');
}

export async function deleteBudget(id) {
  unwrap(await from('budgets').delete().eq('id', id));
  await refresh('budgets');
}
