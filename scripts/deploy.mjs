// Despliegue completo del backend de Lukas en Supabase. Idempotente: se puede correr varias veces.
// Requiere en .env.local: SUPABASE_ACCESS_TOKEN. SUPABASE_DB_PASSWORD es opcional (la CLI usa un rol temporal si falta).
// Uso: node --use-system-ca scripts/deploy.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEnv, requireVars, ROOT } from './env.mjs';
import { createUser } from './create-user.mjs';
import { verify } from './verify.mjs';

const env = readEnv();
requireVars(env, ['SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN', 'GROQ_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'CRON_SECRET']);
const REF = env.SUPABASE_PROJECT_REF;
const API = `https://api.supabase.com/v1/projects/${REF}`;
const childEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, ...(env.SUPABASE_DB_PASSWORD ? { SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD } : {}) };

const hasCli = spawnSync('supabase', ['--version'], { shell: true, stdio: 'ignore' }).status === 0;
const CLI = hasCli ? 'supabase' : 'npx --yes supabase';

function step(title) { console.log(`\n━━ ${title}`); }
function sh(args, { allowFail = false } = {}) {
  console.log(`$ ${CLI} ${args}`);
  const r = spawnSync(`${CLI} ${args}`, { cwd: ROOT, env: childEnv, stdio: 'inherit', shell: true });
  if (r.status !== 0 && !allowFail) throw new Error(`Falló: supabase ${args}`);
  return r.status === 0;
}
async function mgmt(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
const sqlQuery = (query) => mgmt('POST', `${API}/database/query`, { query });
const dollar = (v) => `$v$${String(v).replace(/\$v\$/g, '')}$v$`;

async function pickChatModel() {
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` } });
  if (!res.ok) throw new Error(`Groq /models → ${res.status}`);
  const ids = (await res.json()).data.map((m) => m.id);
  const prefs = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-20b'];
  const main = prefs.find((m) => ids.includes(m)) ?? ids.find((m) => !/whisper|guard|tts|orpheus|allam/i.test(m));
  const fallback = prefs.find((m) => ids.includes(m) && m !== main) ?? main;
  return { main, fallback };
}

try {
  step('1. Vincular proyecto');
  sh(`link --project-ref ${REF}`);

  step('2. Migraciones + seed (pg_cron, pg_net, Vault, tablas, RLS, RPC, cron jobs)');
  sh('db push --linked --include-seed --yes');

  step('3. Auth: registro público desactivado');
  await mgmt('PATCH', `${API}/config/auth`, { disable_signup: true, external_anonymous_users_enabled: false });
  console.log('✔ disable_signup = true');

  step('4. Vault: URL del proyecto y secreto interno para pg_cron / pg_net');
  await sqlQuery(`do $$
declare v uuid;
begin
  select id into v from vault.secrets where name = 'lukas_project_url';
  if v is null then perform vault.create_secret(${dollar(env.SUPABASE_URL)}, 'lukas_project_url');
  else perform vault.update_secret(v, ${dollar(env.SUPABASE_URL)}); end if;
  select id into v from vault.secrets where name = 'lukas_cron_secret';
  if v is null then perform vault.create_secret(${dollar(env.CRON_SECRET)}, 'lukas_cron_secret');
  else perform vault.update_secret(v, ${dollar(env.CRON_SECRET)}); end if;
end $$;`);
  console.log('✔ Secretos en Vault');

  step('5. Secrets de Edge Functions');
  const { main, fallback } = await pickChatModel();
  console.log(`Modelo de chat: ${main} (respaldo: ${fallback})`);
  const secrets = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_CHAT_MODEL: main,
    GROQ_CHAT_FALLBACK: fallback,
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT || 'mailto:dazamiguel95@gmail.com',
    CRON_SECRET: env.CRON_SECRET,
    SB_PUBLISHABLE_KEY: env.SUPABASE_ANON_KEY,
    SB_SECRET_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    ...(env.ALLOWED_ORIGINS ? { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS } : {}),
  };
  const tmp = path.join(os.tmpdir(), `lukas-secrets-${Date.now()}.env`);
  fs.writeFileSync(tmp, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
  try { sh(`secrets set --project-ref ${REF} --env-file "${tmp}"`); } finally { fs.rmSync(tmp, { force: true }); }

  step('6. Edge Functions');
  for (const fn of ['ai-assistant', 'daily-reminders', 'budget-check', 'send-test-push']) {
    sh(`functions deploy ${fn} --project-ref ${REF} --no-verify-jwt --use-api`);
  }

  step('7. Usuario');
  if (env.USER_EMAIL && env.USER_PASSWORD) await createUser(env);
  else console.log('⚠ USER_EMAIL / USER_PASSWORD vacíos en .env.local: corre luego `npm run user`.');

  step('8. Verificación');
  const jobs = await sqlQuery(`select jobname, schedule, active from cron.job where jobname like 'lukas-%' order by 1`);
  console.log('Cron jobs:', jobs);
  if (env.USER_EMAIL && env.USER_PASSWORD) await verify(env);

  console.log('\n✔ Backend desplegado.');
} catch (err) {
  console.error(`\n✘ ${err.message}`);
  process.exit(1);
}
