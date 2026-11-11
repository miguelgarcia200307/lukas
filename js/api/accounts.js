import { from, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createAccount(a) {
  const row = unwrap(await from('accounts').insert(a).select().single());
  refresh('accounts'); // en segundo plano: actualiza la pantalla sin retener el botón
  return row;
}

export async function updateAccount(id, patch) {
  unwrap(await from('accounts').update(patch).eq('id', id));
  refresh('accounts'); // en segundo plano: actualiza la pantalla sin retener el botón
}

export async function deleteAccount(id) {
  unwrap(await from('accounts').delete().eq('id', id));
  refresh('accounts'); // en segundo plano: actualiza la pantalla sin retener el botón
}
