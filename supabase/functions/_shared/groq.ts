// Cliente mínimo de Groq (API compatible con OpenAI). Sin APIs de Deno: también corre en Node para pruebas.
// Resiliencia: reintento con backoff exponencial ante 429/5xx/red, y modelo de respaldo.
const BASE = "https://api.groq.com/openai/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  apiKey: string;
  models: string[]; // en orden de preferencia (principal, respaldo…)
  temperature?: number;
  schema?: Record<string, unknown>;
  timeoutMs?: number;
  maxTokens?: number;
}

export class GroqError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (err: unknown) => !(err instanceof GroqError) || err.status === 429 || err.status >= 500;

/** Espera sugerida por Groq ("try again in 3.2s") o backoff exponencial con jitter */
function backoffMs(err: unknown, attempt: number): number {
  const hinted = err instanceof GroqError ? Number(/try again in ([\d.]+)s/.exec(err.message)?.[1]) : NaN;
  if (Number.isFinite(hinted)) return hinted * 1000 + 250;
  return Math.round(400 * 2 ** attempt + Math.random() * 250);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new GroqError(504, "Groq tardó demasiado");
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ejecuta fn con reintentos. Espera solo si la pausa es corta (≤ maxWaitMs); si no, deja que el llamador
 * pase al siguiente modelo (cada modelo de Groq tiene su propia cuota).
 */
async function withRetry<T>(fn: () => Promise<T>, { tries = 3, maxWaitMs = 6000 } = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err instanceof GroqError && err.status === 401) throw err;
      if (!retryable(err) || attempt === tries - 1) break;
      const wait = backoffMs(err, attempt);
      if (wait > maxWaitMs) break;
      await sleep(wait);
    }
  }
  throw last;
}

export async function transcribe(
  apiKey: string, audio: Blob, filename: string, prompt: string,
): Promise<{ text: string; model: string }> {
  let lastErr: unknown;
  for (const model of ["whisper-large-v3-turbo", "whisper-large-v3"]) {
    try {
      return await withRetry(async () => {
        const form = new FormData();
        form.append("file", audio, filename);
        form.append("model", model);
        form.append("language", "es");
        form.append("temperature", "0");
        form.append("response_format", "json");
        if (prompt) form.append("prompt", prompt.slice(0, 850));
        const res = await fetchWithTimeout(`${BASE}/audio/transcriptions`, {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form,
        }, 30000);
        if (!res.ok) throw new GroqError(res.status, `Whisper ${model}: ${res.status} ${(await res.text()).slice(0, 300)}`);
        const data = await res.json();
        return { text: String(data.text ?? "").trim(), model };
      });
    } catch (err) {
      lastErr = err;
      console.error("transcribe failed", model, String(err).slice(0, 200));
      if (err instanceof GroqError && err.status === 401) throw err;
    }
  }
  throw lastErr;
}

/** Chat con salida JSON. Prueba cada modelo en orden (json_schema y luego json_object), con reintentos. */
export async function chatJson<T = unknown>(
  messages: ChatMessage[], opts: ChatOptions,
): Promise<{ data: T; model: string; raw: string }> {
  let lastErr: unknown;
  for (const model of opts.models.filter(Boolean)) {
    for (const mode of opts.schema ? ["json_schema", "json_object"] : ["json_object"]) {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: opts.temperature ?? 0.1,
        max_completion_tokens: opts.maxTokens ?? 4096,
        response_format: mode === "json_schema"
          ? { type: "json_schema", json_schema: { name: "lukas_response", schema: opts.schema, strict: false } }
          : { type: "json_object" },
      };
      if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "medium";
      try {
        return await withRetry(async () => {
          const res = await fetchWithTimeout(`${BASE}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }, opts.timeoutMs ?? 45000);
          const text = await res.text();
          if (!res.ok) throw new GroqError(res.status, `${model} (${mode}): ${res.status} ${text.slice(0, 400)}`);
          const raw = JSON.parse(text).choices?.[0]?.message?.content ?? "";
          return { data: JSON.parse(raw) as T, model, raw };
        });
      } catch (err) {
        lastErr = err;
        console.error("chat failed", model, mode, String(err).slice(0, 200));
        if (err instanceof GroqError && err.status === 401) throw err;
        // Límite o caída del modelo: no insistir con otro modo, pasar al modelo de respaldo
        if (retryable(err)) break;
      }
    }
  }
  throw lastErr ?? new Error("Sin modelos disponibles");
}
