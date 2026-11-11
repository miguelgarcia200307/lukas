import { emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createSubscription(s) {
  const row = unwrap(await from('subscriptions').insert(s).select().single());
  refresh('subscriptions'); // en segundo plano: actualiza la pantalla sin retener el botón
  return row;
}

export async function updateSubscription(id, patch) {
  unwrap(await from('subscriptions').update(patch).eq('id', id));
  refresh('subscriptions'); // en segundo plano: actualiza la pantalla sin retener el botón
}

export async function deleteSubscription(id) {
  unwrap(await from('subscriptions').delete().eq('id', id));
  refresh('subscriptions'); // en segundo plano: actualiza la pantalla sin retener el botón
}

/** Registra el cobro ahora y avanza la próxima fecha */
export async function chargeNow(id) {
  const r = await rpc('charge_subscription', { p_id: id });
  refresh('subscriptions', 'accounts', 'cards'); // en segundo plano: actualiza la pantalla sin retener el botón
  emitChanged('transactions');
  return r;
}
