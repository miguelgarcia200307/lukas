// Cliente de Groq (API compatible con OpenAI) sin dependencias ni APIs de Deno: streaming, Whisper y
// gestión de cuota con los headers x-ratelimit-* (si el principal está cerca del límite, se va directo al respaldo).
const BASE = "https://api.groq.com/openai/v1";

export class GroqError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// ───────────────────────── cuota en memoria del isolate ─────────────────────────
interface Limit { remTok: number; tokResetAt: number; remReq: number; reqLimit: number; blockedUntil: number; at: number }
const limits = new Map<string, Limit>();

/** "1m26.4s" | "2.047s" | "500ms" → ms */
function dur(s: string | null): number {
  if (!s) return 0;
  let ms = 0;
  for (const [, n, u] of s.matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * (u === "h" ? 3600e3 : u === "m" ? 60e3 : u === "s" ? 1e3 : 1);
  return ms;
}
export function noteHeaders(model: string, h: Headers): void {
  const remTok = Number(h.get("x-ratelimit-remaining-tokens"));
  const remReq = Number(h.get("x-ratelimit-remaining-requests"));
  if (!Number.isFinite(remTok) && !Number.isFinite(remReq)) return;
  const prev = limits.get(model);
  limits.set(model, {
    remTok: Number.isFinite(remTok) ? remTok : prev?.remTok ?? Infinity,
    tokResetAt: Date.now() + dur(h.get("x-ratelimit-reset-tokens")),
    remReq: Number.isFinite(remReq) ? remReq : prev?.remReq ?? Infinity,
    reqLimit: Number(h.get("x-ratelimit-limit-requests")) || prev?.reqLimit || 1000,
    blockedUntil: prev?.blockedUntil ?? 0,
    at: Date.now(),
  });
}
function block(model: string, seconds: number) {
  const l = limits.get(model) ?? { remTok: 0, tokResetAt: 0, remReq: Infinity, reqLimit: 1000, blockedUntil: 0, at: Date.now() };
  l.blockedUntil = Date.now() + seconds * 1000;
  limits.set(model, l);
}
/** ¿Conviene saltarse este modelo? (bloqueado por 429, sin tokens este minuto o casi sin solicitudes del día) */
export function nearLimit(model: string, estTokens: number): boolean {
  const l = limits.get(model);
  if (!l) return false;
  const now = Date.now();
  if (l.blockedUntil > now) return true;
  if (l.remReq < 3) return true;
  // tokens por minuto: si no alcanzan y el reinicio tarda más de 1,5 s
  return l.remTok < estTokens && l.tokResetAt - now > 1500;
}
export function orderModels(models: string[], estTokens: number): string[] {
  const ok = models.filter((m) => !nearLimit(m, estTokens));
  return ok.length ? [...ok, ...models.filter((m) => !ok.includes(m))] : models;
}
export function quotaSnapshot(): Record<string, { remaining_tokens_min: number; remaining_requests_day: number; blocked: boolean }> {
  return Object.fromEntries([...limits].map(([m, l]) => [m, { remaining_tokens_min: l.remTok, remaining_requests_day: l.remReq, blocked: l.blockedUntil > Date.now() }]));
}

async function errorFrom(res: Response, label: string): Promise<GroqError> {
  const text = (await res.text().catch(() => "")).slice(0, 400);
  const ra = Number(res.headers.get("retry-after"));
  let retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
  const hint = /try again in (?:(\d+)m)?([\d.]+)s/.exec(text);
  if (hint) retryAfter = Number(hint[1] ?? 0) * 60 + Number(hint[2]);
  return new GroqError(res.status, `${label}: ${res.status} ${text}`, retryAfter);
}

// ───────────────────────── chat con streaming ─────────────────────────
export interface Usage { in: number; out: number; reasoning: number; cached: number }
export interface ChatMsg { role: "system" | "user" | "assistant"; content: string }
export interface StreamOpts {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  effort?: string | null;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
}
export interface StreamResult { content: string; usage: Usage | null; model: string; firstTokenMs: number | null; ms: number }

function requestBody(o: StreamOpts, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: o.model, messages: o.messages, temperature: o.temperature ?? 0.1,
    max_completion_tokens: o.maxTokens ?? 1024, stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (o.model.startsWith("openai/gpt-oss")) { body.reasoning_effort = o.effort || "low"; body.include_reasoning = false; }
  else if (o.model.startsWith("qwen/")) body.reasoning_effort = "none"; // sin razonamiento: medido igual de preciso y más rápido
  return body;
}
function toUsage(u: any): Usage | null {
  if (!u) return null;
  return {
    in: Number(u.prompt_tokens ?? 0), out: Number(u.completion_tokens ?? 0),
    reasoning: Number(u.completion_tokens_details?.reasoning_tokens ?? 0),
    cached: Number(u.prompt_tokens_details?.cached_tokens ?? 0),
  };
}
function linkAbort(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const ctrl = new AbortController();
  let to = false;
  const t = setTimeout(() => { to = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort);
  return { signal: ctrl.signal, done: () => { clearTimeout(t); outer?.removeEventListener("abort", onAbort); }, timedOut: () => to };
}

export async function streamChat(o: StreamOpts): Promise<StreamResult> {
  const t0 = Date.now();
  const ab = linkAbort(o.timeoutMs ?? 15000, o.signal);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(o, true)),
      signal: ab.signal,
    });
    noteHeaders(o.model, res.headers);
    if (!res.ok || !res.body) {
      const err = await errorFrom(res, o.model);
      if (err.status === 429) block(o.model, err.retryAfter ?? 20);
      throw err;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", usage: Usage | null = null, firstTokenMs: number | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j: any;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new GroqError(500, `${o.model}: ${JSON.stringify(j.error).slice(0, 300)}`);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          firstTokenMs ??= Date.now() - t0;
          content += delta;
          o.onText?.(delta);
        }
        usage = toUsage(j.x_groq?.usage ?? j.usage) ?? usage;
      }
    }
    return { content, usage, model: o.model, firstTokenMs, ms: Date.now() - t0 };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new GroqError(504, ab.timedOut() ? `${o.model}: tiempo agotado` : `${o.model}: cancelado`);
    if (err instanceof GroqError) throw err;
    throw new GroqError(503, `${o.model}: ${String(err).slice(0, 200)}`);
  } finally {
    ab.done();
  }
}

/** Errores que ameritan pasar al respaldo (un solo intento extra) */
export const shouldFallback = (err: unknown) => err instanceof GroqError && (err.status === 429 || err.status >= 500);

// ───────────────────────── Whisper ─────────────────────────
export interface SttResult { text: string; model: string; ms: number }
export async function transcribe(o: {
  apiKey: string; audio: Blob; filename: string; prompt: string; model: string; timeoutMs?: number; signal?: AbortSignal;
}): Promise<SttResult> {
  const t0 = Date.now();
  const ab = linkAbort(o.timeoutMs ?? 12000, o.signal);
  try {
    const form = new FormData();
    form.append("file", o.audio, o.filename);
    form.append("model", o.model);
    form.append("language", "es");
    form.append("temperature", "0");
    form.append("response_format", "text");
    if (o.prompt) form.append("prompt", o.prompt);
    const res = await fetch(`${BASE}/audio/transcriptions`, {
      method: "POST", headers: { Authorization: `Bearer ${o.apiKey}` }, body: form, signal: ab.signal,
    });
    noteHeaders(o.model, res.headers);
    if (!res.ok) {
      const err = await errorFrom(res, o.model);
      if (err.status === 429) block(o.model, err.retryAfter ?? 20);
      throw err;
    }
    const raw = await res.text();
    let text = raw;
    if (raw.trim().startsWith("{")) { try { text = JSON.parse(raw).text ?? ""; } catch { /* texto plano */ } }
    return { text: text.trim(), model: o.model, ms: Date.now() - t0 };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new GroqError(504, ab.timedOut() ? `${o.model}: tiempo agotado` : `${o.model}: cancelado`);
    if (err instanceof GroqError) throw err;
    throw new GroqError(503, `${o.model}: ${String(err).slice(0, 200)}`);
  } finally {
    ab.done();
  }
}
