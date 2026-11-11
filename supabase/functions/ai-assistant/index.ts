// ai-assistant: audio/texto → (Whisper ∥ contexto) → LLM en streaming (JSON Lines) → propuestas por SSE. NO escribe datos del usuario.
// Eventos SSE en orden: transcript → proposal* → question? → reply? → done (o error).
// Liviana a propósito: sin supabase-js ni otras dependencias (arranque en frío mínimo).
import { corsHeaders, errorResponse, HttpError, json, preflight } from "../_shared/cors.ts";
import { insertRow, rpc, verifyUser, warmJwks } from "../_shared/jwt.ts";
import { type Built, buildContext, type RawCtx } from "../_shared/brain.ts";
import { GroqError, orderModels, quotaSnapshot, shouldFallback, transcribe } from "../_shared/llm.ts";
import { runTurn } from "../_shared/pipeline.ts";
import { normalizeText } from "../_shared/normalize.ts";
import { type Expect, parseExpect, quickIntent } from "../_shared/quick.ts";

const env = (k: string, d = "") => Deno.env.get(k) || d;
const GROQ_API_KEY = env("GROQ_API_KEY");
// Elegidos con el banco de pruebas (scripts/ai-eval/report.md): Qwen 3.8 27B sin razonamiento + gpt-oss-120b (cuota separada)
const CHAT_MODELS = [...new Set([env("GROQ_CHAT_MODEL", "qwen/qwen3.8-27b"), env("GROQ_CHAT_FALLBACK", "openai/gpt-oss-120b")])];
const EFFORT = env("GROQ_REASONING_EFFORT", "low");
const STT_MODELS = [...new Set([env("GROQ_STT_MODEL", "whisper-large-v3-turbo"), env("GROQ_STT_FALLBACK", "whisper-large-v3")])];
const FEWSHOT = env("AI_FEWSHOT", "off") === "on";
// Reparto justo: 2 usuarios comparten la cuenta de Groq → por defecto, la mitad de la capacidad diaria estimada
const DAILY_CAPACITY = Number(env("AI_DAILY_CAPACITY", "290"));
const PER_DAY = Number(env("AI_USER_DAILY_QUOTA", String(Math.floor(DAILY_CAPACITY / 2))));
const PER_MINUTE = Number(env("AI_USER_PER_MINUTE", "20"));
const STT_TIMEOUT = 12_000, LLM_TIMEOUT = 15_000, TOTAL_TIMEOUT = 25_000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024, MAX_AUDIO_SECONDS = 60, MAX_TEXT_CHARS = 1000;
const ALLOWED_AUDIO = ["audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav"];
// Lo que Whisper "escucha" en un audio en silencio
const SILENCE = /^(gracias\.?|¡?gracias por ver( el video)?!?|subt[ií]tulos.*amara\.org.*|suscr[ií]bete.*|\.+|…)$/i;

// Caché de contexto por usuario en memoria del isolate (se invalida por versión md5 desde la RPC)
const ctxCache = new Map<string, Built>();
const waitUntil = (p: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil?.(p) ?? p;

function cacheCtx(userId: string, r: { v: string; ctx: RawCtx | null }): Built | null {
  if (r.ctx) {
    const b = buildContext(r.ctx, r.v);
    ctxCache.set(userId, b);
    return b;
  }
  const cached = ctxCache.get(userId);
  return cached && cached.v === r.v ? cached : null;
}

async function transcribeWithFallback(audio: Blob, filename: string, prompt: string, signal: AbortSignal) {
  const order = orderModels(STT_MODELS, 0);
  try {
    return await transcribe({ apiKey: GROQ_API_KEY, audio, filename, prompt, model: order[0], timeoutMs: STT_TIMEOUT, signal });
  } catch (err) {
    if (!shouldFallback(err) || order.length < 2 || signal.aborted) throw err;
    return await transcribe({ apiKey: GROQ_API_KEY, audio, filename, prompt, model: order[1], timeoutMs: STT_TIMEOUT, signal });
  }
}

function friendly(err: unknown): { status: number; code: string; message: string; retry_after?: number } {
  if (err instanceof HttpError) return { status: err.status, code: err.code, message: err.message, retry_after: err.retryAfter };
  if (err instanceof GroqError) {
    if (err.status === 429) return { status: 429, code: "ai_busy", message: "El asistente está ocupado en este momento. Intenta en unos segundos o escríbelo.", retry_after: Math.ceil(err.retryAfter ?? 20) };
    if (err.status === 504) return { status: 504, code: "timeout", message: "Me demoré más de la cuenta. Intenta de nuevo o escríbelo." };
    return { status: 502, code: "ai_unavailable", message: "No pude entenderte en este momento. Intenta de nuevo o escríbelo." };
  }
  console.error(err);
  return { status: 500, code: "internal", message: "Algo salió mal. Intenta de nuevo o escríbelo." };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const t0 = Date.now();
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    if (!GROQ_API_KEY) throw new HttpError(500, "Falta configurar GROQ_API_KEY", "config");
    const type = req.headers.get("Content-Type") ?? "";

    // ── Ping de calentamiento / uso de IA (JSON pequeño)
    if (!type.includes("multipart/form-data")) {
      const declared = Number(req.headers.get("Content-Length") ?? 0);
      if (declared > 64 * 1024) throw new HttpError(413, "El texto es muy largo. Cuéntamelo en pocas frases.", "too_long");
    }
    const body = type.includes("multipart/form-data") ? null : await req.json().catch(() => ({}));
    if (body?.ping) {
      // Responde de inmediato; en segundo plano deja lista la JWKS y el contexto del usuario
      waitUntil((async () => {
        await warmJwks();
        if (!req.headers.get("Authorization")) return;
        const user = await verifyUser(req).catch(() => null);
        if (!user) return;
        const r = await rpc(user.token, "ai_context", { p_version: ctxCache.get(user.id)?.v ?? null }).catch(() => null);
        if (r) cacheCtx(user.id, r);
      })());
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    const user = await verifyUser(req);
    if (body?.usage) {
      const u = await rpc(user.token, "ai_usage", {});
      const used = Number(u.audio_today) + Number(u.text_today);
      const active = orderModels(CHAT_MODELS, 1800)[0];
      return json(req, {
        ...u, used_today: used, quota_day: PER_DAY, pct: Math.min(100, Math.round((used / PER_DAY) * 100)),
        model: active, fallback: active === CHAT_MODELS[0] ? CHAT_MODELS[1] ?? null : CHAT_MODELS[0], stt_model: STT_MODELS[0], limits: quotaSnapshot(),
      });
    }

    // ── Entrada
    let text = "", state: string | null = null, audio: File | null = null, mode = "turn", expect: Expect[] = [];
    if (body) {
      text = String(body.text ?? "").trim();
      if (body.mode === "amount") mode = "amount";
      expect = parseExpect(body.expect);
      state = typeof body.state === "string" ? body.state : null;
      if (text.length > MAX_TEXT_CHARS) throw new HttpError(413, "El texto es muy largo. Cuéntamelo en pocas frases.", "too_long");
      if (!text) throw new HttpError(400, "Cuéntame qué gastaste o qué quieres saber.", "empty");
    } else {
      if (Number(req.headers.get("Content-Length") ?? 0) > MAX_AUDIO_BYTES + 256 * 1024) throw new HttpError(413, "El audio es muy largo. Intenta con menos de un minuto.", "too_large");
      const form = await req.formData();
      const a = form.get("audio");
      if (a instanceof File && a.size > 0) audio = a;
      state = typeof form.get("state") === "string" ? String(form.get("state")) : null;
      if (form.get("mode") === "amount") mode = "amount";
      expect = parseExpect(form.get("expect"));
      text = String(form.get("text") ?? "").trim();
      if (audio) {
        const mime = (audio.type || "").split(";")[0].trim().toLowerCase();
        const duration = Number(form.get("duration") ?? 0);
        if (!ALLOWED_AUDIO.includes(mime)) throw new HttpError(415, "Ese formato de audio no lo puedo leer. Intenta de nuevo o escríbelo.", "bad_audio_type");
        if (audio.size > MAX_AUDIO_BYTES || !Number.isFinite(duration) || duration > MAX_AUDIO_SECONDS + 2) throw new HttpError(413, "La grabación puede durar máximo un minuto.", "too_long");
      } else if (!text) throw new HttpError(400, "No te escuché. Intenta de nuevo.", "empty");
    }
    const tParsed = Date.now();

    // ── Cuota + contexto (una RPC) en paralelo con Whisper
    const cached = ctxCache.get(user.id);
    const sttAbort = new AbortController();
    const beginP = rpc(user.token, "ai_begin", { p_version: cached?.v ?? null, p_kind: audio ? "audio" : "text", p_per_minute: PER_MINUTE, p_per_day: PER_DAY });
    const stt: { p: ReturnType<typeof transcribeWithFallback> | null; t: number } = { p: null, t: 0 };
    const startStt = (prompt: string) => {
      stt.t = Date.now();
      const ext = /mp4|m4a|aac/.test(audio!.type) ? "m4a" : /ogg/.test(audio!.type) ? "ogg" : /wav/.test(audio!.type) ? "wav" : /mpeg/.test(audio!.type) ? "mp3" : "webm";
      stt.p = transcribeWithFallback(audio!, `audio.${ext}`, prompt, sttAbort.signal);
      stt.p.catch(() => {}); // se maneja abajo
    };
    if (audio && cached) startStt(cached.whisper); // vocabulario del usuario desde la caché: Whisper arranca ya

    const begin = await beginP;
    const tCtx = Date.now();
    if (!begin?.quota?.allowed) {
      sttAbort.abort();
      throw new HttpError(429, begin?.quota?.scope === "day"
        ? "Llegaste a tu límite de hoy del asistente. Puedes seguir registrando a mano y mañana vuelvo a escucharte."
        : "Vas muy rápido. Espera unos segundos y vuelve a intentarlo.", "rate_limited", begin?.quota?.retry_after ?? 30);
    }
    const built = cacheCtx(user.id, begin) ?? buildContext((await rpc(user.token, "ai_context", { p_version: null })).ctx, begin.v);
    if (audio && !stt.p) startStt(built.whisper);

    // ── Respuesta en streaming (SSE)
    const enc = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let closed = false;
    const send = (event: string, data: unknown) => {
      if (closed) return;
      writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => { closed = true; });
    };
    writer.write(enc.encode(": ok\n\n")).catch(() => {});

    const work = (async () => {
      const turnAbort = new AbortController();
      const total = setTimeout(() => { turnAbort.abort(); sttAbort.abort(); }, TOTAL_TIMEOUT - (Date.now() - t0));
      let transcript = text;
      let sttMs: number | null = null, sttModel: string | null = null;
      try {
        if (audio) {
          const r = await stt.p!;
          transcript = r.text.trim();
          sttMs = Date.now() - stt.t; sttModel = r.model;
        }
        send("transcript", { text: transcript });
        if (!transcript || transcript.length < 2 || SILENCE.test(transcript)) {
          send("question", { text: "No te escuché bien, ¿me lo repites?" });
          send("done", { intent: "unknown", question: "No te escuché bien, ¿me lo repites?", reply: "No te escuché bien, ¿me lo repites?", state: state ?? "", empty: true,
            metrics: { upload_ms: tParsed - t0, ctx_ms: tCtx - tParsed, stt_ms: sttMs, total_ms: Date.now() - t0, stt_model: sttModel } });
          return;
        }
        // Respuestas cortas de la conversación ("sí", "cancela", "8 lucas") y la respuesta a una tarjeta pendiente:
        // se resuelven en código, sin llamar al LLM (cero tokens)
        if (mode === "amount" || expect.length) {
          const q = quickIntent(transcript, mode === "amount" ? ["amount"] : expect)
            ?? (mode === "amount" ? { intent: "amount" as const, amount: normalizeText(transcript).amounts[0] } : null);
          if (q) {
            send("done", { intent: q.intent, amount: q.amount ?? null, quick: true, transcript, reply: "", question: null, state: state ?? "",
              metrics: { upload_ms: tParsed - t0, ctx_ms: tCtx - tParsed, stt_ms: sttMs, stt_model: sttModel, total_ms: Date.now() - t0 } });
            await insertRow(user.token, "ai_logs", { transcript, model: sttModel, latency_ms: Date.now() - t0, response: { intent: q.intent, amount: q.amount ?? null, quick: true } });
            return;
          }
        }
        const out = await runTurn({
          text: transcript, state, built, apiKey: GROQ_API_KEY, models: CHAT_MODELS, effort: EFFORT, fewshot: FEWSHOT,
          llmTimeoutMs: Math.min(LLM_TIMEOUT, TOTAL_TIMEOUT - (Date.now() - t0) - 500), signal: turnAbort.signal,
          rpc: (fn, args) => rpc(user.token, fn, args), emit: send,
        });
        const metrics = {
          upload_ms: tParsed - t0, ctx_ms: tCtx - tParsed, ctx_cached: !begin.ctx, stt_ms: sttMs, stt_model: sttModel,
          ...out.metrics, total_ms: Date.now() - t0, usage: out.usage, quota: { used: begin.quota.used, limit: begin.quota.limit },
        };
        send("done", { intent: out.intent, reply: out.reply, question: out.question, pending: out.pending, query: out.query, state: out.state, model: out.model, metrics });
        await insertRow(user.token, "ai_logs", {
          transcript, model: out.model, latency_ms: metrics.total_ms,
          response: { intent: out.intent, normalized: out.normalized, proposals: out.proposals.length, pending: out.pending, question: out.question, reply: out.reply, raw: out.raw, metrics },
        });
      } catch (err) {
        const f = friendly(turnAbort.signal.aborted ? new GroqError(504, "total") : err);
        send("error", f);
        await insertRow(user.token, "ai_logs", { transcript, error: String((err as Error)?.message ?? err).slice(0, 2000), latency_ms: Date.now() - t0 });
      } finally {
        clearTimeout(total);
        closed = true;
        await writer.close().catch(() => {});
      }
    })();
    waitUntil(work);

    return new Response(readable, {
      headers: { ...corsHeaders(req), "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    const f = friendly(err);
    if (f.status >= 500 && !(err instanceof HttpError)) return errorResponse(req, err);
    return errorResponse(req, err instanceof HttpError ? err : new HttpError(f.status, f.message, f.code, f.retry_after));
  }
});
