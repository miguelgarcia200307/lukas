// Un turno del asistente: normalizar → LLM en streaming (JSON Lines) → validar línea por línea → emitir propuestas.
// Sin APIs de Deno: lo usan la Edge Function y el banco de pruebas en Node.
import { amountSupported, normalizeText } from "./normalize.ts";
import {
  amountQuestion, askedItem, type Built, buildMessages, canMerge, incomeFallback, mergeTransactions, OUT_OF_SCOPE, parseState, pendingFromQuestion,
  type Proposal, type QuerySpec, queryReply, recordReply, validateLine,
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
  /** Salida cruda del modelo (y del reintento), para diagnóstico en ai_logs */
  raw: string;
  pending: number;
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

  // Agrupación determinística: una transacción se retiene hasta saber si la siguiente es del mismo evento
  // (misma categoría Y mismo lugar, mismo tipo, día y medio de pago); si lo es, se fusionan con sus ítems y el
  // total sumado en código. Categorías distintas nunca se fusionan; las pendientes (sin monto) tampoco.
  let held: Proposal | null = null;
  const emitProposal = (p: Proposal) => { proposals.push(p); o.emit("proposal", p); };
  const flush = () => { if (held) { emitProposal(held); held = null; } };
  const accept = (p: Proposal) => {
    if (p.kind !== "transaction" || p.pending) { flush(); emitProposal(p); return; } // la fusión final une lo que quede separado
    if (held && canMerge(held, p, true)) { held = mergeTransactions(held, p); return; }
    flush();
    held = p;
  };

  const handle = (raw: string, final: boolean) => {
    // A veces el modelo junta dos objetos en una línea: {...}{...}
    const parts = raw.split(/(?<=})\s*(?=\{"k")/);
    if (parts.length > 1) { for (const p of parts) handleOne(p, final); return; }
    handleOne(raw, final);
  };
  const handleOne = (line: string, final: boolean) => {
    const r = validateLine(line, o.built, { now, said, strictAmounts: !final }, amountOk);
    if (r.type === "proposal") {
      const p = r.proposal;
      if (final && p.kind === "transaction" && !p.pending && !amountOk(p.amount, p.items.reduce((s, i) => s + Math.round(i.qty * i.unit_amount), 0) || undefined)) {
        // Monto que no sale de nada de lo que dijo (ni tras el reintento): nunca se propone un monto inventado.
        // La tarjeta queda pendiente preguntando el monto (antes quedaba con ese monto y confianza 0.4).
        r.proposal = { ...p, amount: 0, items: [], pending: true, confidence: Math.min(p.confidence, 0.4), question: amountQuestion(p.description, p.type) };
      }
      goodLines.push(r.line);
      accept(r.proposal);
      for (const x of r.extra ?? []) accept(x);
    } else if (r.type === "question") { if (!question) { question = r.text; goodLines.push(r.line); } } // se emite al final
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
  let retried = false, retryRaw = "";
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
      retryRaw = r.content;
      // Si el modelo reenvía líneas que ya se aceptaron (la lista completa en vez de solo las corregidas), no se
      // vuelven a sumar: antes "recibí 320.000" + reintento con la lista completa daba un ingreso de $640.000
      const canon = (l: string) => { try { return JSON.stringify(JSON.parse(l.trim().replace(/,\s*$/, ""))); } catch { return l.trim(); } };
      const accepted = new Set(goodLines.map(canon));
      for (const line of r.content.split("\n")) if (line.trim() && !accepted.has(canon(line))) handle(line, true);
    } catch (err) {
      console.error("retry", String(err).slice(0, 200));
      for (const f of failed) handle(f.line, true);
    }
  }

  flush();
  // Fusión final de transacciones del mismo evento que no llegaron seguidas (misma categoría y mismo lugar exacto)
  const merged: Proposal[] = [];
  for (const p of proposals) {
    const same = merged.find((m) => canMerge(m, p));
    if (same) merged[merged.indexOf(same)] = mergeTransactions(same, p); else merged.push(p);
  }
  if (merged.length !== proposals.length) {
    proposals.splice(0, proposals.length, ...merged);
    o.emit("replace", { proposals });
  }

  // Ingresos explícitos ("me entraron 50 mil", "me consignaron…") se registran sin preguntar
  if (!query && !proposals.length && question) {
    const inc = incomeFallback(norm.text, norm.amounts, o.built, now);
    if (inc) { question = null; emitProposal(inc); }
  }

  // Una pregunta suelta por un monto ("¿Cuánto te costó el foco?") nunca deja el ítem por fuera:
  // se vuelve una propuesta pendiente con esa pregunta (salvo que ya exista la pendiente de ese ítem)
  if (question && !query) {
    const item = askedItem(question);
    const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const covered = item && proposals.some((p) => p.kind === "transaction" && p.pending && fold(p.description).includes(fold(item).split(" ")[0]));
    if (covered) question = null;
    else if (item) {
      const pend = pendingFromQuestion(question, norm.text, o.built, now);
      if (pend) {
        question = null;
        emitProposal(pend);
        const alias = pend.kind === "transaction" ? o.built.toAlias[pend.category_id ?? ""] : null;
        goodLines.push(JSON.stringify({ k: "g", d: (pend as { description: string }).description, ...(alias ? { c: alias } : {}), q: (pend as { question: string }).question }));
      }
    }
  }
  if (question) o.emit("question", { text: question });
  const pendingQ = proposals.find((p) => p.kind === "transaction" && p.pending) as { question?: string } | undefined;

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
    raw: [content, retryRaw].filter(Boolean).join("\n--- reintento ---\n").slice(0, 4000),
    pending: proposals.filter((p) => p.kind === "transaction" && p.pending).length,
    state: JSON.stringify({ l: goodLines.filter((l) => !/"k":"(q|x)"/.test(l)).slice(0, 12), q: question ?? pendingQ?.question ?? null, s: said.slice(0, 20) }),
    metrics: { llm_ms: llmMs, llm_first_ms: firstMs, retry: retried, ...(queryMs != null ? { query_ms: queryMs } : {}) },
  };
}

export { GroqError };
