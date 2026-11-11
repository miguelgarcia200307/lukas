// Orquestación del asistente (sin APIs de Deno): interpretar → validar → reintentar; y redactar respuestas a consultas.
import { chatJson, type ChatMessage } from "./groq.ts";
import { buildAliases, RESPONSE_SCHEMA, systemPrompt, validateAndNormalize, type AssistantResult, type Ctx } from "./prompt.ts";

export interface InterpretOptions {
  apiKey: string;
  models: string[];
  ctx: Ctx;
  text: string;
  history: ChatMessage[];
}

export interface InterpretOutput extends AssistantResult {
  model: string;
  memory: string; // JSON crudo con alias: el cliente lo reenvía como turno del asistente
}

export function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
}

export async function interpret(opts: InterpretOptions): Promise<InterpretOutput> {
  const al = buildAliases(opts.ctx);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.ctx, al) },
    ...opts.history,
    { role: "user", content: opts.text },
  ];
  const chatOpts = { apiKey: opts.apiKey, models: opts.models, schema: RESPONSE_SCHEMA, temperature: 0.1 };
  let { data, model, raw } = await chatJson(messages, chatOpts);
  let v = validateAndNormalize(data, opts.ctx, al);

  if (v.errors.length) {
    try {
      const retry = await chatJson([
        ...messages,
        { role: "assistant", content: raw },
        { role: "user", content: `Tu respuesta anterior tiene errores: ${v.errors.join("; ")}. Corrígela siguiendo las reglas y responde solo el JSON.` },
      ], chatOpts);
      const v2 = validateAndNormalize(retry.data, opts.ctx, al);
      if (v2.errors.length <= v.errors.length) {
        v = v2;
        raw = retry.raw;
        model = retry.model;
      }
    } catch (err) {
      console.error("retry failed", String(err));
    }
  }
  return { ...v.result, model, memory: raw };
}

/** Redacta la respuesta a una consulta usando SOLO los datos calculados. Si el LLM falla, usa el texto base. */
export async function composeAnswer(
  apiKey: string, models: string[], question: string, facts: string, fallback: string,
): Promise<string> {
  try {
    const { data } = await chatJson<{ reply?: string }>([
      {
        role: "system",
        content: "Eres Lukas, asistente de finanzas personales en Colombia. Responde la pregunta del usuario en 1 o 2 frases cortas, " +
          "cálidas y naturales en español colombiano (tutea, sin emojis), usando EXCLUSIVAMENTE los datos dados. " +
          "Copia las cifras tal cual vienen formateadas; no calcules ni inventes cifras nuevas. No escribas fechas en formato AAAA-MM-DD: " +
          "di \"esta semana\", \"este mes\" o la fecha en palabras. Si no hay datos, dilo con amabilidad. " +
          'Responde solo JSON: {"reply":"..."}',
      },
      { role: "user", content: `Pregunta: ${question}\n\nDatos reales:\n${facts}` },
    ], { apiKey, models, temperature: 0.2, maxTokens: 1024, timeoutMs: 20000 });
    const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
    return reply || fallback;
  } catch (err) {
    console.error("composeAnswer failed", String(err));
    return fallback;
  }
}
