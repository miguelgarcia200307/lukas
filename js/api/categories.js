import { from, unwrap } from './base.js';
import { refresh } from './catalog.js';

export async function createCategory(c) {
  const row = unwrap(await from('categories').insert(c).select().single());
  await refresh('categories');
  return row;
}

export async function updateCategory(id, patch) {
  const row = unwrap(await from('categories').update(patch).eq('id', id).select().single());
  await refresh('categories');
  return row;
}

/** Guarda el nuevo orden (lista de ids) */
export async function reorderCategories(ids) {
  await Promise.all(ids.map((id, i) => from('categories').update({ sort_order: (i + 1) * 10 }).eq('id', id)));
  await refresh('categories');
}
