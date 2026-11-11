// Tarjetas de crédito y su libro mayor
import { emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createCard(c) {
  const row = unwrap(await from('credit_cards').insert(c).select().single());
  await refresh('cards');
  return row;
}

export async function updateCard(id, patch) {
  unwrap(await from('credit_cards').update(patch).eq('id', id));
  await refresh('cards');
}

export async function deleteCard(id) {
  unwrap(await from('credit_cards').delete().eq('id', id));
  await refresh('cards');
}

export async function cardMovements(cardId, limit = 100) {
  return unwrap(await from('card_movements').select('*').eq('card_id', cardId).order('occurred_at', { ascending: false }).limit(limit));
}

/** Pago de tarjeta = transferencia desde una cuenta (no es gasto) + intereses opcionales (gasto) */
export async function payCard({ cardId, accountId, amount, date, interest = 0, note = null }) {
  const r = await rpc('pay_card', { p_card_id: cardId, p_account_id: accountId, p_amount: amount, p_date: date, p_interest: interest || 0, p_note: note });
  await refresh('cards', 'accounts');
  emitChanged('transactions');
  return r;
}

export async function extraCharge({ cardId, kind, amount, date, note = null }) {
  const r = await rpc('card_extra_charge', { p_card_id: cardId, p_kind: kind, p_amount: amount, p_date: date, p_note: note });
  await refresh('cards');
  emitChanged('transactions');
  return r;
}

export async function adjustBalance({ cardId, target, note = null }) {
  const r = await rpc('adjust_card_balance', { p_card_id: cardId, p_target_debt: target, p_note: note });
  await refresh('cards');
  return r;
}
