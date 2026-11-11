// Crea (o actualiza) el único usuario de la app con la Admin API. Lee .env.local.
// Uso: node --use-system-ca scripts/create-user.mjs
import { readEnv, requireVars } from './env.mjs';

export async function createUser(env = readEnv()) {
  requireVars(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'USER_EMAIL', 'USER_PASSWORD']);
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const name = env.USER_NAME || '';

  let res = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: env.USER_EMAIL, password: env.USER_PASSWORD, email_confirm: true, user_metadata: { name } }),
  });
  let user;
  if (res.ok) {
    user = await res.json();
    console.log('✔ Usuario creado');
  } else {
    const err = await res.json().catch(() => ({}));
    if (res.status !== 422 && err.error_code !== 'email_exists') throw new Error(`Auth admin ${res.status}: ${JSON.stringify(err)}`);
    // Ya existe: buscarlo y actualizar la contraseña
    const list = await fetch(`${base}/auth/v1/admin/users?per_page=1000`, { headers }).then((r) => r.json());
    user = (list.users ?? []).find((u) => u.email?.toLowerCase() === env.USER_EMAIL.toLowerCase());
    if (!user) throw new Error('El usuario existe pero no se pudo encontrar');
    res = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ password: env.USER_PASSWORD, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`No se pudo actualizar el usuario: ${res.status} ${await res.text()}`);
    console.log('✔ Usuario existente actualizado');
  }

  if (name) {
    const r = await fetch(`${base}/rest/v1/profiles?user_id=eq.${user.id}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ name }),
    });
    if (!r.ok) console.warn('⚠ No se pudo guardar el nombre en el perfil:', r.status, await r.text());
  }
  return user;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('create-user.mjs')) {
  createUser().catch((e) => { console.error('✘', e.message); process.exit(1); });
}
