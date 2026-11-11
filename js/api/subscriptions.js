import { emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createSubscription(s) {
  const row = unwrap(await from('subscriptions').insert(s).select().single());
  await refresh('subscriptions');
  return row;
}

export async function updateSubscription(id, patch) {
  unwrap(await from('subscriptions').update(patch).eq('id', id));
  await refresh('subscriptions');
}

export async function deleteSubscription(id) {
  unwrap(await from('subscriptions').delete().eq('id', id));
  await refresh('subscriptions');
}

/** Registra el cobro ahora y avanza la próxima fecha */
export async function chargeNow(id) {
  const r = await rpc('charge_subscription', { p_id: id });
  await refresh('subscriptions', 'accounts', 'cards');
  emitChanged('transactions');
  return r;
}
