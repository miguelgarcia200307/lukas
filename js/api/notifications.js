import { state } from '../state.js';
import { from, rpc, unwrap } from './base.js';

export async function listNotifications(limit = 60) {
  return unwrap(await from('notifications').select('*').order('created_at', { ascending: false }).limit(limit));
}

export async function refreshUnread() {
  const { count, error } = await from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (!error) state.unread = count ?? 0;
  return state.unread;
}

export async function markRead(ids = null) {
  await rpc('mark_notifications_read', { p_ids: ids });
  await refreshUnread();
}

export async function clearAll() {
  unwrap(await from('notifications').delete().not('id', 'is', null));
  state.unread = 0;
}
