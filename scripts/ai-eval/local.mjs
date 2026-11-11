// Ejecuta el mismo pipeline de la Edge Function directamente desde Node (para comparar modelos sin redesplegar).
// El contexto y las consultas salen de la base real vía REST con la sesión del usuario. Si las RPC nuevas
// (ai_context / ai_query) aún no están desplegadas, se emulan con las tablas y vistas existentes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../../supabase/functions/_shared/brain.ts';
import { runTurn } from '../../supabase/functions/_shared/pipeline.ts';
import { orderModels, shouldFallback, transcribe } from '../../supabase/functions/_shared/llm.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export async function createLocal({ env, token, model, effort, fewshot, stt }) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = async () => ({ apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' });
  const get = async (p) => {
    const r = await fetch(`${base}/rest/v1/${p}`, { headers: await headers() });
    const t = await r.text();
    if (!r.ok) throw new Error(`${p} → ${r.status} ${t}`);
    return JSON.parse(t);
  };
  const rawRpc = async (fn, args) => {
    const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: await headers(), body: JSON.stringify(args) });
    const t = await r.text();
    if (!r.ok) { const e = new Error(`${fn} → ${r.status} ${t}`); e.status = r.status; throw e; }
    return t ? JSON.parse(t) : null;
  };
  const missing = (e) => e.status === 404 || /PGRST202|Could not find the function/.test(e.message);

  // ── contexto (RPC si existe; si no, desde las tablas con el mismo formato y orden)
  async function context() {
    try { return await rawRpc('ai_context', { p_version: null }); } catch (e) { if (!missing(e)) throw e; }
    const [prof, cats, accs, cards, debts, subs, goals] = await Promise.all([
      get('profiles?select=name,default_account_id'),
      get('categories?select=id,name,kind,parent_id,system_key,sort_order,archived&archived=eq.false'),
      get('accounts?select=id,name,type,sort_order,created_at&archived=eq.false&order=sort_order,created_at'),
      get('credit_cards?select=id,name,bank,brand,last4&archived=eq.false&order=created_at'),
      get('debts?select=id,name,lender,monthly_payment&archived=eq.false&order=created_at'),
      get('subscriptions?select=id,name,amount,frequency&active=eq.true&order=created_at'),
      get('savings_goals?select=id,name,target_amount&archived=eq.false&order=created_at'),
    ]);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const key = (c) => [c.kind, byId.get(c.parent_id)?.sort_order ?? c.sort_order, c.parent_id ? 1 : 0, c.sort_order, c.name];
    cats.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1; return 0; });
    return {
      v: 'local',
      ctx: {
        name: prof[0]?.name ?? null, def: prof[0]?.default_account_id ?? null,
        cats: cats.map((c) => [c.id, c.name, c.kind, c.parent_id, c.system_key]),
        accs: accs.map((a) => [a.id, a.name, a.type]), cards: cards.map((c) => [c.id, c.name, c.bank, c.brand, c.last4]),
        debts: debts.map((d) => [d.id, d.name, d.lender, d.monthly_payment]), subs: subs.map((s) => [s.id, s.name, s.amount, s.frequency]),
        goals: goals.map((g) => [g.id, g.name, g.target_amount]), hints: [],
      },
    };
  }

  // ── ai_query emulada (mismo formato que la RPC)
  async function emulateQuery({ p_metric: m, p_from: from, p_to: to, p_category: cat, p_card: card, p_account: acc }) {
    const out = { from, to };
    if (m === 'spending' || m === 'income') {
      const len = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
      const prevFrom = new Date(Date.parse(`${from}T12:00:00Z`) - len * 864e5).toISOString().slice(0, 10);
      const next = new Date(Date.parse(`${to}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
      const tx = await get(`transactions?select=amount,occurred_at,category_id&type=eq.${m === 'spending' ? 'expense' : 'income'}&occurred_at=gte.${prevFrom}T00:00:00-05:00&occurred_at=lt.${next}T00:00:00-05:00`);
      const cats = await get('categories?select=id,name,parent_id');
      const cmap = new Map(cats.map((c) => [c.id, c]));
      const inScope = (t) => !cat || t.category_id === cat || cmap.get(t.category_id)?.parent_id === cat;
      const d = (t) => new Date(Date.parse(t.occurred_at) - 5 * 3600e3).toISOString().slice(0, 10);
      const cur = tx.filter((t) => inScope(t) && d(t) >= from), prev = tx.filter((t) => inScope(t) && d(t) < from);
      const top = new Map();
      cur.forEach((t) => { const c = cmap.get(t.category_id); const n = cmap.get(c?.parent_id)?.name ?? c?.name; if (n) top.set(n, (top.get(n) ?? 0) + Number(t.amount)); });
      return { ...out, total: cur.reduce((s, t) => s + Number(t.amount), 0), count: cur.length, prev_total: prev.reduce((s, t) => s + Number(t.amount), 0),
        top: [...top].sort((a, b) => b[1] - a[1]).slice(0, 3) };
    }
    if (m === 'balance') return { ...out, rows: (await get(`account_balances?select=name,balance&archived=eq.false${acc ? `&id=eq.${acc}` : ''}&order=sort_order`)).map((r) => [r.name, r.balance]) };
    if (m === 'card_debt' || m === 'card_dates') return { ...out, rows: (await get(`card_status?select=*&archived=eq.false${card ? `&id=eq.${card}` : ''}&order=created_at`)).map((c) => [c.name, c.bank, Math.max(0, c.debt), c.available, c.credit_limit, c.next_cut_date, c.next_due_date]) };
    if (m === 'debts') return { ...out, rows: (await get('debt_status?select=*&archived=eq.false')).map((d) => [d.name, d.balance, d.monthly_payment, d.next_due_date]) };
    if (m === 'subscriptions') return { ...out, rows: (await get('subscription_status?select=*&active=eq.true&order=next_charge_date')).map((s) => [s.name, s.amount, s.frequency, s.next_charge_date, s.monthly_equivalent]) };
    if (m === 'budget') return { ...out, rows: (await rawRpc('budget_status', {})).map((b) => [b.name, b.period, b.spent, b.amount, b.pct]) };
    if (m === 'goals') return { ...out, rows: (await get('goal_status?select=*&archived=eq.false')).map((g) => [g.name, g.saved, g.target_amount]) };
    return out;
  }
  let hasQueryRpc = true;
  const rpc = async (fn, args) => {
    if (fn === 'ai_query' && hasQueryRpc) {
      try { return await rawRpc(fn, args); } catch (e) { if (!missing(e)) throw e; hasQueryRpc = false; }
    }
    if (fn === 'ai_query') return emulateQuery(args);
    return rawRpc(fn, args);
  };

  const { v, ctx } = await context();
  const built = buildContext(ctx, v);
  const models = (model || env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b').split(',');
  const sttModels = (stt || 'whisper-large-v3-turbo,whisper-large-v3').split(',');
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'audio', 'manifest.json'), 'utf8'));

  return {
    built,
    async run({ text, audio }, state) {
      const t0 = performance.now();
      let first = null, transcriptMs = null, sttMs = null, sttModel = null;
      if (audio) {
        const meta = manifest[audio];
        const blob = new Blob([fs.readFileSync(path.join(DIR, 'audio', meta.file))], { type: meta.file.endsWith('.m4a') ? 'audio/mp4' : 'audio/webm' });
        const order = orderModels(sttModels, 0);
        let r;
        try { r = await transcribe({ apiKey: env.GROQ_API_KEY, audio: blob, filename: meta.file, prompt: built.whisper, model: order[0] }); }
        catch (e) { if (!shouldFallback(e) || !order[1]) throw e; r = await transcribe({ apiKey: env.GROQ_API_KEY, audio: blob, filename: meta.file, prompt: built.whisper, model: order[1] }); }
        text = r.text; sttMs = r.ms; sttModel = r.model; transcriptMs = performance.now() - t0;
      }
      const out = await runTurn({
        text, state, built, apiKey: env.GROQ_API_KEY, models, effort: effort || null, fewshot: fewshot === 'on', rpc,
        emit: (ev) => { if ((ev === 'proposal' || ev === 'question') && first == null) first = performance.now() - t0; },
      });
      return {
        transcript: text, intent: out.intent, reply: out.reply, question: out.question, proposals: out.proposals,
        query: out.query, model: out.model, state: out.state, first_ms: first, transcript_ms: transcriptMs,
        metrics: { ...out.metrics, stt_ms: sttMs, stt_model: sttModel, usage: out.usage, normalized: out.normalized },
      };
    },
  };
}
