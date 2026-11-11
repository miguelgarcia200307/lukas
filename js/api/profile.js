import { state, emitChanged } from '../state.js';
import { from, rpc, unwrap } from './base.js';

export async function loadProfile() {
  const p = await rpc('ensure_profile');
  state.profile = p;
  return p;
}

export async function updateProfile(patch) {
  const p = unwrap(await from('profiles').update(patch).eq('user_id', state.profile.user_id).select().single());
  state.profile = p;
  emitChanged('profile');
  return p;
}
