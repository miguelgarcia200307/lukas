// Verificación con un usuario temporal (se crea y se borra con todos sus datos). Uso: node --use-system-ca scripts/verify-temp.mjs
import crypto from 'node:crypto';
import { readEnv } from './env.mjs';
import { verify } from './verify.mjs';

const env = readEnv();
const base = env.SUPABASE_URL.replace(/\/$/, '');
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const email = `verify-${Date.now()}@lukas.test`;
const password = crypto.randomBytes(18).toString('base64url');

const res = await fetch(`${base}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) });
const user = await res.json();
if (!res.ok) { console.error('No se pudo crear el usuario temporal', res.status, user); process.exit(1); }
console.log('Usuario temporal creado');
let failures = 1;
try {
  failures = await verify({ ...env, USER_EMAIL: email, USER_PASSWORD: password });
  console.log('fallos:', failures);
} catch (e) {
  console.error('✘', e.stack ?? e);
} finally {
  const del = await fetch(`${base}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: H });
  console.log(del.ok ? 'Usuario temporal eliminado' : `⚠ No se pudo borrar el usuario temporal (${del.status})`);
}
process.exit(failures ? 1 : 0);
