import { from, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createAccount(a) {
  const row = unwrap(await from('accounts').insert(a).select().single());
  await refresh('accounts');
  return row;
}

export async function updateAccount(id, patch) {
  unwrap(await from('accounts').update(patch).eq('id', id));
  await refresh('accounts');
}

export async function deleteAccount(id) {
  unwrap(await from('accounts').delete().eq('id', id));
  await refresh('accounts');
}
