// Diagnóstico: muestra la salida cruda del modelo (líneas JSONL) y lo que queda tras la validación/agrupación.
// Uso: node --use-system-ca scripts/ai-eval/raw.mjs "frase" [--model qwen/qwen3.8-27b] [--n 2]
import { readEnv } from '../env.mjs';
import { createLocal } from './local.mjs';
import { buildMessages } from '../../supabase/functions/_shared/brain.ts';
import { normalizeText } from '../../supabase/functions/_shared/normalize.ts';
import { streamChat } from '../../supabase/functions/_shared/llm.ts';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const text = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const env = readEnv();
const BASE = env.SUPABASE_URL.replace(/\/$/, '');
let tok = null;
const token = async () => tok ??= (await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.USER_EMAIL, password: env.USER_PASSWORD }),
})).json()).access_token;
const model = opt('model', env.GROQ_CHAT_MODEL || 'qwen/qwen3.8-27b');
const local = await createLocal({ env, token, model });
const names = Object.fromEntries([...local.built.cats.values()].map((c) => [c.id, c.name]));
const alias = Object.fromEntries(Object.entries(local.built.toId).map(([a, id]) => [a, names[id]]).filter(([, n]) => n));
for (let n = 0; n < Number(opt('n', 1)); n++) {
  const norm = normalizeText(text);
  const r = await streamChat({ apiKey: env.GROQ_API_KEY, model, messages: buildMessages(local.built, norm.text, null, { singleUser: model.startsWith('qwen/') }), effort: opt('effort', env.GROQ_REASONING_EFFORT || 'low'), timeoutMs: 15000, maxTokens: 1200 });
  console.log(`\n── salida cruda (${model}) ──\n${r.content.replace(/"(c\d+)"/g, (m, a) => `${m}/*${alias[a] ?? '?'}*/`)}`);
  const out = await local.run({ text }, null);
  console.log('── tras pipeline ──');
  for (const p of out.proposals) console.log(`  ${p.kind} ${p.type ?? ''} ${p.amount ?? '—'} ${names[p.category_id] ?? ''} «${p.description ?? ''}» ítems=${p.items?.length ?? 0}${p.pending ? ` pendiente: ${p.question}` : ''}`);
  console.log(`  pregunta: ${out.question ?? '—'} · respuesta: ${out.reply}`);
}
