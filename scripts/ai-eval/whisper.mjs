// Compara modelos de Whisper en los audios del banco: montos y nombres correctos tras normalizar, y latencia.
// Uso: node --use-system-ca scripts/ai-eval/whisper.mjs [--models whisper-large-v3-turbo,whisper-large-v3] [--rounds 2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '../env.mjs';
import { createLocal } from './local.mjs';
import { normalizeText } from '../../supabase/functions/_shared/normalize.ts';
import { transcribe } from '../../supabase/functions/_shared/llm.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const models = opt('models', 'whisper-large-v3-turbo,whisper-large-v3').split(',');
const rounds = Number(opt('rounds', '2'));
const env = readEnv();
const base = env.SUPABASE_URL.replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tok = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.USER_EMAIL, password: env.USER_PASSWORD }),
}).then((r) => r.json());
const { built } = await createLocal({ env, token: async () => tok.access_token });
console.log(`Prompt de Whisper (${built.whisper.length} caracteres):\n${built.whisper}\n`);

const { cases } = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'audio', 'manifest.json'), 'utf8'));
const audioCases = cases.filter((c) => c.audio);
const NAMES = ['Visa', 'Master', 'Nequi', 'Bancolombia', 'D1', 'Uber', 'salchipapa', 'ferretería', 'TransMilenio'];

const rows = [];
for (let round = 0; round < rounds; round++) {
  for (const c of audioCases) {
    const meta = manifest[c.audio];
    const file = fs.readFileSync(path.join(DIR, 'audio', meta.file));
    const blob = new Blob([file], { type: meta.file.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm' });
    // Montos esperados = los que dice la frase (normalizando el texto original)
    const expected = normalizeText(c.say).amounts.sort((a, b) => a - b);
    const names = NAMES.filter((n) => c.say.toLowerCase().includes(n.toLowerCase()));
    for (const model of models) {
      try {
        const r = await transcribe({ apiKey: env.GROQ_API_KEY, audio: blob, filename: meta.file, prompt: built.whisper, model });
        const got = normalizeText(r.text).amounts.sort((a, b) => a - b);
        const amountsOk = JSON.stringify(got) === JSON.stringify(expected);
        const namesOk = names.every((n) => r.text.toLowerCase().includes(n.toLowerCase()));
        rows.push({ round, id: c.id, model, ms: r.ms, amountsOk, namesOk, text: r.text, expected, got });
        console.log(`${amountsOk && namesOk ? '✔' : '✘'} ${c.id} ${model.padEnd(24)} ${String(r.ms).padStart(5)} ms  ${r.text}${amountsOk ? '' : `  [montos ${got} ≠ ${expected}]`}`);
      } catch (e) {
        rows.push({ round, id: c.id, model, error: e.message });
        console.log(`✘ ${c.id} ${model} error ${e.message}`);
      }
      await sleep(3500); // 20 solicitudes/min por modelo
    }
  }
}

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const summary = models.map((m) => {
  const r = rows.filter((x) => x.model === m && !x.error);
  return {
    model: m, n: r.length, errors: rows.filter((x) => x.model === m && x.error).length,
    amounts: `${((r.filter((x) => x.amountsOk).length / r.length) * 100).toFixed(1)}%`,
    names: `${((r.filter((x) => x.namesOk).length / r.length) * 100).toFixed(1)}%`,
    p50: q(r.map((x) => x.ms), 50), p95: q(r.map((x) => x.ms), 95),
  };
});
console.table(summary);
fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'whisper-results.json'), JSON.stringify({ at: new Date().toISOString(), prompt: built.whisper, summary, rows }, null, 2));
