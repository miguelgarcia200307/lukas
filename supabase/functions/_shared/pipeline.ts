// Un turno del asistente: normalizar → LLM en streaming (JSON Lines) → validar línea por línea → emitir propuestas.
// Sin APIs de Deno: lo usan la Edge Function y el banco de pruebas en Node.
import { amountSupported, normalizeText } from "./normalize.ts";
import {
  type Built, buildMessages, OUT_OF_SCOPE, parseState, type Proposal, type QuerySpec, queryReply, recordReply, validateLine,
} from "./brain.ts";
import { type ChatMsg, GroqError, orderModels, shouldFallback, streamChat, type Usage } from "./llm.ts";

export type Emit = (event: string, data: unknown) => void;

export interface TurnOptions {
  text: string;
  state?: string | null;
  built: Built;
  now?: Date;
  apiKey: string;
  models: string[]; // principal, respaldo…
  effort?: string | null;
  fewshot?: boolean;
  llmTimeoutMs?: number;
  signal?: AbortSignal;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  emit: Emit;
}

export interface TurnResult {
  intent: string;
  reply: string;
  question: string | null;
  proposals: Proposal[];
  query: QuerySpec | null;
  state: string;
  model: string | null;
  usage: Usage | null;
  normalized: string;
  metrics: { llm_ms: number; llm_first_ms: number | null; retry: boolean; query_ms?: number };
}

const RECORD_INTENTS: Record<string, string> = {
  card_payment: "card_payment", debt_payment: "debt_payment", subscription: "add_subscription", goal_contribution: "goal_contribution",
};

function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return { in: a.in + b.in, out: a.out + b.out, reasoning: a.reasoning + b.reasoning, cached: a.cached + b.cached };
}

export async function runTurn(o: TurnOptions): Promise<TurnResult> {
  const now = o.now ?? new Date();
  const norm = normalizeText(o.text);
  const prev = parseState(o.state);
  const said = [...norm.numbers, ...(prev?.said ?? [])];
  const singleUser = (m: string) => m.startsWith("qwen/");
  const amountOk = (a: number, itemsTotal?: number) => amountSupported(a, said, itemsTotal);

  const proposals: Proposal[] = [];
  const goodLines: string[] = [];
  const failed: { line: string; error: string }[] = [];
  let question: string | null = null;
  let reply: string | null = null;
  let query: QuerySpec | null = null;

  const handle = (raw: string, final: boolean) => {
    // A veces el modelo junta dos objetos en una línea: {...}{...}
    const parts = raw.split(/(?<=})\s*(?=\{"k")/);
    if (parts.length > 1) { for (const p of parts) handleOne(p, final); return; }
    handleOne(raw, final);
  };
  const handleOne = (line: string, final: boolean) => {
    const r = validateLine(line, o.built, { now, said, strictAmounts: !final }, amountOk);
    if (r.type === "proposal") {
      if (final && !amountOk(r.proposal.amount, r.proposal.kind === "transaction" ? r.proposal.items.reduce((s, i) => s + Math.round(i.qty * i.unit_amount), 0) || undefined : undefined) && r.proposal.kind === "transaction") {
        r.proposal.confidence = Math.min(r.proposal.confidence, 0.4); // no se pudo verificar: la tarjeta pide revisar
      }
      proposals.push(r.proposal);
      goodLines.push(r.line);
      o.emit("proposal", r.proposal);
    } else if (r.type === "question") { if (!question) { question = r.text; goodLines.push(r.line); o.emit("question", { text: r.text }); } }
    else if (r.type === "query") { query = r.query; goodLines.push(r.line); }
    else if (r.type === "reply") reply = r.text;
    else if (r.type === "invalid") { if (final) console.error("línea descartada", r.error, r.line); else failed.push({ line: r.line, error: r.error }); }
  };

  // ── LLM en streaming: cada línea completa se valida y se emite al instante
  const est = 1800;
  const order = orderModels(o.models, est);
  let model: string | null = null, usage: Usage | null = null, content = "", firstMs: number | null = null;
  const t0 = Date.now();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < Math.min(2, order.length); attempt++) {
    const m = order[attempt];
    let buf = "", emitted = 0;
    const messages = buildMessages(o.built, norm.text, prev, { fewshot: o.fewshot, singleUser: singleUser(m) });
    try {
      const r = await streamChat({
        apiKey: o.apiKey, model: m, messages, effort: o.effort, timeoutMs: o.llmTimeoutMs ?? 15000, signal: o.signal,
        maxTokens: 1200,
        onText: (chunk) => {
          buf += chunk;
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) { emitted++; handle(line, false); } }
        },
      });
      if (buf.trim()) { emitted++; handle(buf, false); }
      model = m; usage = r.usage; content = r.content; firstMs = r.firstTokenMs;
      lastErr = null;
      void emitted;
      break;
    } catch (err) {
      lastErr = err;
      console.error("llm", m, String(err).slice(0, 200));
      // Un solo intento extra y solo si el error lo amerita y no se emitió nada aún
      if (!shouldFallback(err) || proposals.length || question) break;
    }
  }
  if (lastErr) throw lastErr;
  const llmMs = Date.now() - t0;

  // ── Reintento solo de las líneas que fallaron (una vez)
  let retried = false;
  if (failed.length && model) {
    retried = true;
    try {
      const messages: ChatMsg[] = [
        ...buildMessages(o.built, norm.text, prev, { fewshot: o.fewshot, singleUser: singleUser(model) }),
        { role: "assistant", content },
        { role: "user", content: `Estas líneas tienen errores:\n${failed.map((f) => `${f.line}  ← ${f.error}`).join("\n")}\nResponde SOLO esas líneas corregidas (o una línea "?" si falta un dato).` },
      ];
      const r = await streamChat({ apiKey: o.apiKey, model, messages, effort: o.effort, timeoutMs: 8000, signal: o.signal, maxTokens: 600 });
      usage = addUsage(usage, r.usage);
      for (const line of r.content.split("\n")) if (line.trim()) handle(line, true);
    } catch (err) {
      console.error("retry", String(err).slice(0, 200));
      for (const f of failed) handle(f.line, true);
    }
  }

  // ── Consulta: SQL + plantilla (sin segunda llamada al LLM)
  let queryMs: number | undefined;
  if (query) {
    const tq = Date.now();
    const q = query as QuerySpec;
    try {
      const data = await o.rpc("ai_query", { p_metric: q.metric, p_from: q.from, p_to: q.to, p_category: q.category_id, p_card: q.card_id, p_account: q.account_id });
      reply = queryReply(q, data, o.built);
    } catch (err) {
      console.error("ai_query", String(err).slice(0, 200));
      reply = "No pude revisar tus datos en este momento. Intenta de nuevo en un momento.";
    }
    queryMs = Date.now() - tq;
  }

  // ── Intención y respuesta final
  let intent: string;
  if (query) intent = "query";
  else if (proposals.length) {
    const kinds = new Set(proposals.map((p) => p.kind));
    intent = kinds.size === 1 && RECORD_INTENTS[[...kinds][0]] ? RECORD_INTENTS[[...kinds][0]] : "create_transactions";
  } else if (question) intent = "create_transactions";
  else intent = "unknown";

  if (!query && !proposals.length && !question && !reply) reply = OUT_OF_SCOPE;
  if (!question && !query && proposals.length) reply = recordReply(proposals, o.built, norm.text);
  if (question) reply = question;
  if (reply && !question) o.emit("reply", { text: reply });

  return {
    intent, reply: reply ?? "", question, proposals, query, model, usage, normalized: norm.text,
    state: JSON.stringify({ l: goodLines.filter((l) => !/"k":"(q|x)"/.test(l)).slice(0, 12), q: question, s: said.slice(0, 20) }),
    metrics: { llm_ms: llmMs, llm_first_ms: firstMs, retry: retried, ...(queryMs != null ? { query_ms: queryMs } : {}) },
  };
}

export { GroqError };
