// Banco de pruebas del asistente de Lukas.
// Ejecuta cases.json contra la Edge Function desplegada (o el pipeline local) y guarda resultados + report.md.
//
// Uso:
//   node --use-system-ca scripts/ai-eval/run.mjs --label final                 # función desplegada (ai-assistant)
//   node --use-system-ca scripts/ai-eval/run.mjs --label x --fn ai-assistant-next
//   node --use-system-ca scripts/ai-eval/run.mjs --label m --local --model openai/gpt-oss-20b --effort low
//   El banco gasta la misma cuota de Groq que la app: por defecto corre solo los casos que fallaron en la última
//   corrida más los casos nuevos. --all corre todo (úsalo poco). --sample 10 toma una muestra.
//   Filtros: --only spec-01,q-02   --group audio   --text-only   --audio-only   --pause 4000
//   node --use-system-ca scripts/ai-eval/run.mjs --report        # solo regenera report.md
//   node --use-system-ca scripts/ai-eval/run.mjs --cleanup       # borra los datos de prueba
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '../env.mjs';
import { writeReport } from './report.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(DIR, 'results');
const FIXTURES_FILE = path.join(DIR, '.fixtures.local.json');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = readEnv();
const BASE = env.SUPABASE_URL.replace(/\/$/, '');
const bank = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));
const manifest = fs.existsSync(path.join(DIR, 'audio', 'manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(DIR, 'audio', 'manifest.json'), 'utf8')) : {};

if (flag('report')) { writeReport(RESULTS, path.join(DIR, 'report.md')); process.exit(0); }

// ───────────────────────── sesión y REST ─────────────────────────
let session = null;
async function login() {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.USER_EMAIL, password: env.USER_PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Login falló: ${JSON.stringify(j)}`);
  session = { token: j.access_token, at: Date.now() };
}
async function token() {
  if (!session || Date.now() - session.at > 40 * 60e3) await login();
  return session.token;
}
const H = async (extra = {}) => ({ apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${await token()}`, ...extra });
async function rest(p, opts = {}) {
  const r = await fetch(`${BASE}/rest/v1/${p}`, { ...opts, headers: { ...(await H({ 'Content-Type': 'application/json', Prefer: 'return=representation' })), ...(opts.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${p} → ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

// ───────────────────────── datos de prueba ─────────────────────────
async function ensureFixtures() {
  const created = fs.existsSync(FIXTURES_FILE) ? JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8')) : {};
  const fx = bank.fixtures;
  const ensure = async (table, rows, key = 'name') => {
    const existing = await rest(`${table}?select=id,${key}`, { method: 'GET' });
    for (const row of rows) {
      if (existing.some((e) => e[key].toLowerCase() === row[key].toLowerCase())) continue;
      const [ins] = await rest(table, { method: 'POST', body: JSON.stringify(row) });
      (created[table] ??= []).push(ins.id);
      console.log(`  + ${table}: ${row[key]}`);
    }
  };
  await ensure('accounts', fx.accounts);
  await ensure('credit_cards', fx.cards);
  await ensure('debts', fx.debts);
  const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  await ensure('subscriptions', fx.subscriptions.map((s) => ({ ...s, next_charge_date: today })));
  await ensure('savings_goals', fx.goals);
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(created, null, 2));
}
async function cleanupFixtures() {
  if (!fs.existsSync(FIXTURES_FILE)) return;
  const created = JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
  for (const table of ['subscriptions', 'savings_goals', 'debts', 'credit_cards', 'accounts']) {
    for (const id of created[table] ?? []) await rest(`${table}?id=eq.${id}`, { method: 'DELETE' }).catch((e) => console.error(e.message));
  }
  fs.rmSync(FIXTURES_FILE);
  console.log('Datos de prueba borrados');
}
if (flag('cleanup')) { await cleanupFixtures(); process.exit(0); }

async function loadNames() {
  const [cats, accs, cards, debts, goals, prof] = await Promise.all([
    rest('categories?select=id,name', { method: 'GET' }), rest('accounts?select=id,name', { method: 'GET' }),
    rest('credit_cards?select=id,name', { method: 'GET' }), rest('debts?select=id,name', { method: 'GET' }),
    rest('savings_goals?select=id,name', { method: 'GET' }), rest('profiles?select=default_account_id', { method: 'GET' }),
  ]);
  const m = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.name]));
  return { cat: m(cats), acc: m(accs), card: m(cards), debt: m(debts), goal: m(goals), defaultAccount: prof[0]?.default_account_id };
}

// ───────────────────────── llamada a la función ─────────────────────────
function parseSSE(buffer, onEvent) {
  let idx;
  while ((idx = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let event = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) onEvent(event, JSON.parse(data));
  }
  return buffer;
}

async function callDeployed(fn, turn, prev) {
  const headers = await H();
  let body;
  if (turn.audio) {
    const meta = manifest[turn.audio];
    const file = path.join(DIR, 'audio', meta.file);
    const type = meta.file.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm';
    body = new FormData();
    body.append('audio', new Blob([fs.readFileSync(file)], { type }), meta.file);
    body.append('duration', String(meta.seconds));
    if (prev?.history) body.append('history', JSON.stringify(prev.history));
    if (prev?.state) body.append('state', prev.state);
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ text: turn.text, ...(prev?.history ? { history: prev.history } : {}), ...(prev?.state ? { state: prev.state } : {}) });
  }
  const t0 = performance.now();
  const res = await fetch(`${BASE}/functions/v1/${fn}`, { method: 'POST', headers, body });
  const timing = { headers_ms: performance.now() - t0 };
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(`HTTP ${res.status} ${j?.error?.message ?? ''}`); e.status = res.status; e.retry = j?.error?.retry_after; throw e;
  }
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const out = { proposals: [], events: [] };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = parseSSE(buf + dec.decode(value, { stream: true }), (ev, data) => {
        const ms = performance.now() - t0;
        out.events.push([ev, Math.round(ms)]);
        if (ev === 'transcript') { out.transcript = data.text; timing.transcript_ms ??= ms; }
        else if (ev === 'proposal') { out.proposals.push(data); timing.first_proposal_ms ??= ms; }
        else if (ev === 'replace') { out.proposals = [...data.proposals]; }
        else if (ev === 'question') { out.question = data.text; timing.first_proposal_ms ??= ms; }
        else if (ev === 'reply') { out.reply = data.text; }
        else if (ev === 'done') { Object.assign(out, data); timing.done_ms = ms; }
        else if (ev === 'error') { out.error = data; }
      });
    }
    if (out.error) { const e = new Error(out.error.message); e.status = out.error.status; e.retry = out.error.retry_after; throw e; }
    timing.total_ms = performance.now() - t0;
    timing.first_proposal_ms ??= timing.done_ms;
    return normalizeNew(out, timing);
  }
  const j = await res.json();
  timing.total_ms = performance.now() - t0;
  timing.first_proposal_ms = timing.total_ms;
  return {
    transcript: j.transcript, intent: j.intent, reply: j.reply, ask: !!j.needs_clarification, question: j.question,
    proposals: j.proposals ?? [], query: j.query ? { metric: j.query.topic, from: j.query.from, to: j.query.to, category_id: j.query.category_id, card_id: j.query.card_id } : null,
    model: j.model, timing, server: { total_ms: j.latency_ms }, usage: null,
    next: { history: [...(prev?.history ?? []), { role: 'user', content: j.transcript }, ...(j.memory ? [{ role: 'assistant', content: j.memory }] : [])] },
  };
}

function normalizeNew(out, timing) {
  return {
    transcript: out.transcript, intent: out.intent, reply: out.reply, ask: !!out.question, question: out.question ?? null,
    proposals: out.proposals, query: out.query ?? null, model: out.model, timing, server: out.metrics ?? {}, usage: out.metrics?.usage ?? null,
    next: { state: out.state },
  };
}

let localPipeline = null;
async function callLocal(turn, prev) {
  if (!localPipeline) {
    const mod = await import('./local.mjs');
    localPipeline = await mod.createLocal({ env, token, model: opt('model'), effort: opt('effort'), fewshot: opt('fewshot'), stt: opt('stt') });
  }
  const t0 = performance.now();
  const out = await localPipeline.run(turn, prev?.state ?? null);
  const total = performance.now() - t0;
  const timing = { total_ms: total, first_proposal_ms: out.first_ms ?? total, ...(out.transcript_ms != null ? { transcript_ms: out.transcript_ms } : {}) };
  return normalizeNew(out, timing);
}

// ───────────────────────── calificación ─────────────────────────
function bogotaDate(iso) { return new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const sameList = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

export function grade(c, r, names) {
  const e = c.expect;
  const today = bogotaDate(new Date().toISOString());
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const checks = {};
  // Las propuestas pendientes (sin monto, con su pregunta) se califican aparte con expect.pending
  const pend = r.proposals.filter((p) => p.kind === 'transaction' && p.pending);
  const done = r.proposals.filter((p) => !(p.kind === 'transaction' && p.pending));
  const txs = done.filter((p) => p.kind === 'transaction');
  const amounts = done.map((p) => p.amount).filter((a) => a != null);

  // montos
  const expAmounts = e.amountsAny ?? [[
    ...(e.tx ?? []).map((t) => t.amount).filter((a) => a !== '*'),
    ...['card_payment', 'debt_payment', 'subscription', 'goal_contribution'].filter((k) => e[k]?.amount).map((k) => e[k].amount),
  ]];
  if (e.intent !== 'query' && !(e.intent === 'unknown')) checks.amounts = expAmounts.some((list) => sameList(list, amounts));
  else checks.amounts = amounts.length === 0;

  // intención
  checks.intent = e.intent === '*' || r.intent === e.intent;
  // pregunta
  // Preguntar por un monto ahora puede ser una pregunta suelta o una tarjeta pendiente con su pregunta
  const asked = [r.question, ...pend.map((p) => p.question)].filter(Boolean);
  checks.ask = (asked.length > 0) === e.ask && (!e.askAbout || asked.some((q) => new RegExp(e.askAbout, 'i').test(q)));
  if (e.pending || pend.length) {
    const want = e.pending ?? [];
    checks.pending = pend.length === want.length && want.every((w) => pend.some((p) =>
      new RegExp(w.about, 'i').test(`${p.description} ${p.question ?? ''}`) && (!w.category || w.category.includes(names.cat[p.category_id]))));
  }

  // transacciones: categoría, tipo, pago, fecha, ítems
  const catStrict = [], catLenient = [], extra = [];
  let structure = true;
  if (e.tx) {
    const fixedCount = !e.amountsAny || e.amountsAny.length === 1;
    if (fixedCount && e.tx.every((t) => t.amount !== '*')) structure = txs.length === e.tx.length;
    for (const t of e.tx) {
      const matches = t.amount === '*' ? txs : txs.filter((p) => p.amount === t.amount).slice(0, 1);
      if (!matches.length) { catStrict.push(false); catLenient.push(false); continue; }
      for (const p of matches) {
        const sug = names.cat[p.category_id];
        const alts = (p.category_alternatives ?? []).map((id) => names.cat[id]);
        catStrict.push(t.category.includes(sug));
        catLenient.push(t.category.includes(sug) || alts.some((a) => t.category.includes(a)));
        if (t.type) extra.push(['type', p.type === t.type]);
        if (t.items != null) structure &&= (p.items?.length ?? 0) === t.items;
        if (t.payment) {
          const want = [].concat(t.payment);
          const got = p.payment?.kind === 'card' ? `card:${names.card[p.payment.id]}`
            : p.payment?.id === names.defaultAccount && p.payment?.inferred ? 'default' : `account:${names.acc[p.payment?.id]}`;
          const gotAlt = p.payment?.kind === 'account' && p.payment?.id === names.defaultAccount ? `account:${names.acc[p.payment.id]}` : got;
          extra.push(['payment', want.includes(got) || want.includes(gotAlt) || (want.includes('default') && p.payment?.id === names.defaultAccount)]);
        }
        if (t.date) {
          const d = bogotaDate(p.date);
          let ok = true;
          if (t.date.rel != null) ok = d === addDays(today, t.date.rel);
          if (t.date.weekday != null) ok = d === addDays(today, -(((wd - t.date.weekday + 7) % 7) || 7));
          if (t.date.lastWeek) { const mon = addDays(today, -((wd + 6) % 7)); ok = d >= addDays(mon, -7) && d <= addDays(mon, -1); }
          extra.push(['date', ok]);
        }
      }
    }
  }
  if (catStrict.length) { checks.category_strict = catStrict.every(Boolean); checks.category = catLenient.every(Boolean); }
  if (e.tx) checks.structure = structure;
  for (const k of ['type', 'payment', 'date']) { const v = extra.filter(([n]) => n === k); if (v.length) checks[k] = v.every(([, ok]) => ok); }

  // otras intenciones
  if (e.card_payment) {
    const p = r.proposals.find((x) => x.kind === 'card_payment');
    checks.fields = !!p && names.card[p.card_id] === e.card_payment.card && names.acc[p.account_id] === e.card_payment.account;
  }
  if (e.debt_payment) { const p = r.proposals.find((x) => x.kind === 'debt_payment'); checks.fields = !!p && names.debt[p.debt_id] === e.debt_payment.debt; }
  if (e.subscription) { const p = r.proposals.find((x) => x.kind === 'subscription'); checks.fields = !!p && new RegExp(e.subscription.name, 'i').test(p.name) && p.frequency === e.subscription.frequency; }
  if (e.goal_contribution) { const p = r.proposals.find((x) => x.kind === 'goal_contribution'); checks.fields = !!p && names.goal[p.goal_id] === e.goal_contribution.goal; }
  if (e.query) {
    const q = r.query ?? {};
    let ok = q.metric === e.query.metric;
    if (e.query.card) ok &&= !q.card_id || names.card[q.card_id] === e.query.card;
    if (e.query.category) ok &&= names.cat[q.category_id] === e.query.category;
    if (e.query.period === 'today') ok &&= q.from === today && q.to === today;
    if (e.query.period === 'week') ok &&= q.from === addDays(today, -((wd + 6) % 7));
    if (e.query.period === 'month') ok &&= q.from === `${today.slice(0, 8)}01`;
    checks.fields = ok;
    checks.answer = (r.reply ?? '').trim().length > 8 && !/no pude|no encontré datos|algo salió mal/i.test(r.reply);
  }
  const pass = Object.values(checks).every(Boolean);
  return { checks, pass };
}

// ───────────────────────── ejecución ─────────────────────────
async function main() {
  const label = opt('label', `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`);
  const fn = opt('fn', 'ai-assistant');
  const local = flag('local');
  const pause = Number(opt('pause', local ? 2500 : 3000));
  let cases = bank.cases;
  if (opt('only')) { const ids = opt('only').split(','); cases = cases.filter((c) => ids.includes(c.id)); }
  if (opt('group')) cases = cases.filter((c) => c.group === opt('group'));
  if (!flag('all') && !opt('only') && !opt('group')) {
    const runs = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'))).filter((r) => !r.meta.label.startsWith('0-'))
      .sort((a, b) => b.meta.at.localeCompare(a.meta.at)) : [];
    const last = runs[0];
    if (last) {
      const failed = new Set(last.results.filter((r) => !r.pass).map((r) => r.id));
      const seen = new Set(last.results.map((r) => r.id));
      cases = cases.filter((c) => failed.has(c.id) || !seen.has(c.id));
      console.log(`Solo fallidos de "${last.meta.label}" + casos nuevos (${cases.length}). Usa --all para el banco completo.`);
    } else cases = cases.sort(() => Math.random() - 0.5).slice(0, 12);
  }
  if (opt('sample')) cases = cases.sort(() => Math.random() - 0.5).slice(0, Number(opt('sample')));
  if (flag('text-only')) cases = cases.filter((c) => !c.audio);
  if (flag('audio-only')) cases = cases.filter((c) => c.audio);

  await login();
  await ensureFixtures();
  const names = await loadNames();
  console.log(`\n▶ ${label}: ${cases.length} casos · ${local ? `local ${opt('model') ?? ''} ${opt('effort') ?? ''}` : fn}\n`);

  // Calentamiento (no se mide): evita contar el arranque en frío en todos los casos
  if (!local) await callDeployed(fn, { text: 'hola' }).catch(() => {});

  const results = [];
  for (const c of cases) {
    const turns = c.turns ? c.turns.map((t) => ({ text: t })) : [c.audio ? { audio: c.audio } : { text: c.text }];
    let prev = null, r = null, err = null;
    const turnUsage = [];
    for (const turn of turns) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = local ? await callLocal(turn, prev) : await callDeployed(fn, turn, prev);
          err = null;
          break;
        } catch (e) {
          err = e;
          if (e.status === 429 && attempt < 2) { const w = (e.retry ?? 20) * 1000 + 500; console.log(`   … 429, espero ${Math.round(w / 1000)} s`); await sleep(w); continue; }
          break;
        }
      }
      if (err) break;
      turnUsage.push(r.usage);
      prev = r.next;
      if (turns.length > 1) await sleep(pause);
    }
    let row;
    if (err) row = { id: c.id, group: c.group, audio: !!c.audio, error: err.message, pass: false, checks: {} };
    else {
      const g = grade(c, r, names);
      row = {
        id: c.id, group: c.group, audio: !!c.audio, pass: g.pass, checks: g.checks, transcript: r.transcript, intent: r.intent,
        reply: r.reply, question: r.question, model: r.model, timing: r.timing, server: r.server, usage: r.usage, usage_turns: turnUsage,
        proposals: r.proposals.map((p) => ({
          kind: p.kind, type: p.type, amount: p.amount, category: names.cat[p.category_id] ?? null, ...(p.pending ? { pending: true, question: p.question, description: p.description } : {}),
          alts: (p.category_alternatives ?? []).map((id) => names.cat[id]), items: p.items?.length ?? 0,
          payment: p.payment ? `${p.payment.kind}:${names.acc[p.payment.id] ?? names.card[p.payment.id] ?? p.payment.id}${p.payment.inferred ? '*' : ''}` : null,
          date: p.date ? bogotaDate(p.date) : null, card: names.card[p.card_id], account: names.acc[p.account_id], name: p.name,
        })),
        query: r.query,
      };
    }
    results.push(row);
    const fails = Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k);
    console.log(`${row.pass ? '✔' : '✘'} ${c.id.padEnd(9)} ${row.error ? row.error : `${Math.round(row.timing.total_ms)} ms · ${row.model ?? ''} · ${row.proposals.map((p) => `${p.kind === 'transaction' ? p.type[0] : p.kind} ${p.pending ? `¿${p.description}?` : p.amount ?? ''} ${p.category ?? ''}`).join(' | ')}${row.question ? ` · ¿${row.question}` : ''}${fails.length ? `  ✘ ${fails.join(',')}` : ''}`}`);
    if (!row.pass && row.transcript && c.audio) console.log(`            «${row.transcript}»`);
    await sleep(pause);
  }

  fs.mkdirSync(RESULTS, { recursive: true });
  const meta = { label, fn: local ? null : fn, local, model: opt('model'), effort: opt('effort'), fewshot: opt('fewshot'), at: new Date().toISOString(), cases: results.length };
  fs.writeFileSync(path.join(RESULTS, `${label}.json`), JSON.stringify({ meta, results }, null, 2));
  writeReport(RESULTS, path.join(DIR, 'report.md'));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} casos correctos · resultados en results/${label}.json · report.md actualizado`);
  if (!flag('keep-fixtures') && flag('cleanup-after')) await cleanupFixtures();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error('✘', e); process.exit(1); });
}
