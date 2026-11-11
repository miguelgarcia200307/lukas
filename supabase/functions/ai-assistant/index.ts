// ai-assistant: audio/texto → transcripción (Whisper) → interpretación (LLM) → propuestas validadas. NO escribe datos del usuario.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { errorResponse, HttpError, json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { GroqError, transcribe } from "../_shared/groq.ts";
import { composeAnswer, interpret, sanitizeHistory } from "../_shared/assistant.ts";
import { addDays, bogota, type Ctx, whisperPrompt } from "../_shared/prompt.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const MODELS = [...new Set([
  Deno.env.get("GROQ_CHAT_MODEL") || "openai/gpt-oss-120b",
  Deno.env.get("GROQ_CHAT_FALLBACK") || "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
])];
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;
const MAX_TEXT_CHARS = 1000;
const ALLOWED_AUDIO = ["audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav"];
const QUOTA_PER_MINUTE = 20;
const QUOTA_PER_DAY = 300;

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00-05:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });

async function loadContext(db: SupabaseClient): Promise<Ctx> {
  const [cats, accs, cards, debts, subs, goals, prof] = await Promise.all([
    db.from("categories").select("id,name,kind,parent_id,system_key").eq("archived", false).order("kind").order("sort_order"),
    db.from("account_balances").select("id,name,type,balance").eq("archived", false).order("sort_order"),
    db.from("card_status").select("id,name,bank,brand,last4,debt,next_cut_date,next_due_date").eq("archived", false),
    db.from("debt_status").select("id,name,lender,monthly_payment,balance").eq("archived", false),
    db.from("subscriptions").select("id,name,amount,frequency,next_charge_date").eq("active", true),
    db.from("goal_status").select("id,name,target_amount,saved").eq("archived", false),
    db.from("profiles").select("name, default_account_id").maybeSingle(),
  ]);
  for (const r of [cats, accs, cards, debts, subs, goals, prof]) if (r.error) throw r.error;
  return {
    now: new Date(),
    userName: prof.data?.name ?? null,
    categories: cats.data ?? [],
    accounts: accs.data ?? [],
    cards: cards.data ?? [],
    debts: debts.data ?? [],
    subscriptions: subs.data ?? [],
    goals: goals.data ?? [],
    defaultAccountId: prof.data?.default_account_id ?? accs.data?.[0]?.id ?? null,
  };
}

interface QuerySpec { topic: string; from: string; to: string; category_id: string | null; card_id: string | null }

/** Calcula los datos reales para una consulta. Devuelve hechos en texto + respuesta de respaldo. */
async function runQuery(db: SupabaseClient, q: QuerySpec, ctx: Ctx): Promise<{ facts: string; fallback: string }> {
  const range = q.from === q.to ? `Periodo: ${longDate(q.from)}` : `Periodo: del ${longDate(q.from)} al ${longDate(q.to)}`;
  switch (q.topic) {
    case "spending":
    case "income": {
      const type = q.topic === "spending" ? "expense" : "income";
      const days = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86400000) + 1;
      const prevFrom = addDays(q.from, -days);
      const { data, error } = await db.from("transactions").select("amount, category_id, occurred_at")
        .eq("type", type).gte("occurred_at", `${prevFrom}T00:00:00-05:00`).lt("occurred_at", `${addDays(q.to, 1)}T00:00:00-05:00`)
        .limit(10000);
      if (error) throw error;
      const cats = new Map(ctx.categories.map((c) => [c.id, c]));
      const top = (id: string | null) => (id && cats.get(id)?.parent_id) || id;
      const inScope = (id: string | null) => !q.category_id || id === q.category_id || top(id) === q.category_id;
      const cur = (data ?? []).filter((t) => bogota(new Date(t.occurred_at)).date >= q.from && inScope(t.category_id));
      const prev = (data ?? []).filter((t) => bogota(new Date(t.occurred_at)).date < q.from && inScope(t.category_id));
      const total = cur.reduce((s, t) => s + Number(t.amount), 0);
      const prevTotal = prev.reduce((s, t) => s + Number(t.amount), 0);
      const byCat = new Map<string, number>();
      cur.forEach((t) => {
        const name = cats.get(top(t.category_id) ?? "")?.name ?? "Sin categoría";
        byCat.set(name, (byCat.get(name) ?? 0) + Number(t.amount));
      });
      const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${n} ${money(v)}`).join("; ");
      const label = type === "expense" ? "Total gastado" : "Total recibido";
      const scope = q.category_id ? ` en ${cats.get(q.category_id)?.name}` : "";
      return {
        facts: `${range}\n${label}${scope}: ${money(total)} en ${cur.length} movimientos\nPeriodo anterior de igual duración: ${money(prevTotal)}` +
          (topCats && !q.category_id ? `\nPrincipales categorías: ${topCats}` : ""),
        fallback: `${label}${scope}: ${money(total)} entre el ${longDate(q.from)} y el ${longDate(q.to)}.`,
      };
    }
    case "balance": {
      const lines = ctx.accounts.map((a) => `${a.name}: ${money(a.balance ?? 0)}`);
      const total = ctx.accounts.reduce((s, a) => s + Number(a.balance ?? 0), 0);
      return { facts: `Saldos de cuentas:\n${lines.join("\n")}\nTotal: ${money(total)}`, fallback: `Tienes ${money(total)} en tus cuentas.` };
    }
    case "card_debt":
    case "card_dates": {
      const { data, error } = await db.from("card_status").select("*").eq("archived", false);
      if (error) throw error;
      const cards = (data ?? []).filter((c) => !q.card_id || c.id === q.card_id);
      if (!cards.length) return { facts: "No hay tarjetas registradas.", fallback: "Aún no tienes tarjetas registradas." };
      const lines = cards.map((c) =>
        `${c.name}${c.bank ? ` (${c.bank})` : ""}: deuda ${money(c.debt)}, cupo ${money(c.credit_limit)}, disponible ${money(c.available)}, ` +
        `próximo corte ${longDate(c.next_cut_date)}, próximo pago ${longDate(c.next_due_date)}`);
      const total = cards.reduce((s, c) => s + Math.max(0, Number(c.debt)), 0);
      return {
        facts: `Tarjetas:\n${lines.join("\n")}\nDeuda total en tarjetas: ${money(total)}`,
        fallback: q.topic === "card_debt" ? `Debes ${money(total)} en tarjetas.` : lines[0],
      };
    }
    case "debts": {
      const { data, error } = await db.from("debt_status").select("*").eq("archived", false);
      if (error) throw error;
      if (!data?.length) return { facts: "No hay créditos registrados.", fallback: "No tienes créditos registrados." };
      const lines = data.map((d) => `${d.name}: saldo ${money(d.balance)}, cuota ${money(d.monthly_payment)}` +
        (d.next_due_date ? `, próxima cuota ${longDate(d.next_due_date)}` : ""));
      const total = data.reduce((s, d) => s + Number(d.balance), 0);
      return { facts: `Créditos:\n${lines.join("\n")}\nSaldo total: ${money(total)}`, fallback: `Debes ${money(total)} en créditos.` };
    }
    case "subscriptions": {
      const { data, error } = await db.from("subscription_status").select("*").eq("active", true);
      if (error) throw error;
      if (!data?.length) return { facts: "No hay suscripciones activas.", fallback: "No tienes suscripciones activas." };
      const monthly = data.reduce((s, x) => s + Number(x.monthly_equivalent), 0);
      const lines = data.map((s) => `${s.name}: ${money(s.amount)} (${s.frequency}), próximo cobro ${longDate(s.next_charge_date)}`);
      return {
        facts: `Suscripciones:\n${lines.join("\n")}\nTotal mensual equivalente: ${money(monthly)}; al año: ${money(monthly * 12)}`,
        fallback: `Pagas ${money(monthly)} al mes en suscripciones.`,
      };
    }
    case "budget": {
      const { data, error } = await db.rpc("budget_status");
      if (error) throw error;
      if (!data?.length) return { facts: "No hay presupuestos.", fallback: "No tienes presupuestos configurados." };
      const lines = data.map((b: { name: string; period: string; spent: number; amount: number; pct: number }) =>
        `${b.name} (${b.period}): ${money(b.spent)} de ${money(b.amount)} (${b.pct}%)`);
      return { facts: `Presupuestos:\n${lines.join("\n")}`, fallback: lines[0] };
    }
    case "goals": {
      if (!ctx.goals.length) return { facts: "No hay metas.", fallback: "Aún no tienes metas de ahorro." };
      const lines = ctx.goals.map((g) => `${g.name}: ahorrado ${money(g.saved ?? 0)} de ${money(g.target_amount)}`);
      return { facts: `Metas:\n${lines.join("\n")}`, fallback: lines[0] };
    }
  }
  return { facts: "Sin datos.", fallback: "No encontré datos para esa pregunta." };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const started = Date.now();
  let transcript = "";
  let logDb: SupabaseClient | null = null;

  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    if (!GROQ_API_KEY) throw new HttpError(500, "Falta configurar GROQ_API_KEY", "config");
    const { db } = await requireUser(req);
    logDb = db;

    // Cuota por usuario (tabla ai_requests con RLS) antes de gastar tokens de Groq
    const { data: quota, error: quotaErr } = await db.rpc("consume_ai_quota", { p_per_minute: QUOTA_PER_MINUTE, p_per_day: QUOTA_PER_DAY });
    if (quotaErr) throw quotaErr;
    if (!quota?.allowed) {
      throw new HttpError(429, quota?.scope === "day"
        ? "Llegaste al límite de hoy del asistente. Puedes seguir registrando a mano y mañana vuelvo a escucharte."
        : "Vas muy rápido. Espera unos segundos y vuelve a intentarlo.", "rate_limited", quota?.retry_after ?? 30);
    }

    let text = "";
    let history: unknown = [];
    let audio: File | null = null;
    const type = req.headers.get("Content-Type") ?? "";
    const declared = Number(req.headers.get("Content-Length") ?? 0);
    if (declared > MAX_AUDIO_BYTES + 256 * 1024) throw new HttpError(413, "El audio es muy largo. Intenta con menos de un minuto.", "too_large");
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const a = form.get("audio");
      if (a instanceof File && a.size > 0) audio = a;
      const duration = Number(form.get("duration") ?? 0);
      if (audio) {
        const mime = (audio.type || "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_AUDIO.includes(mime)) throw new HttpError(415, "Ese formato de audio no lo puedo leer. Intenta de nuevo o escríbelo.", "bad_audio_type");
        if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS + 2) {
          throw new HttpError(413, "La grabación puede durar máximo un minuto.", "too_long");
        }
      }
      text = String(form.get("text") ?? "");
      try { history = JSON.parse(String(form.get("history") ?? "[]")); } catch { history = []; }
    } else {
      const body = await req.json().catch(() => ({}));
      text = String(body.text ?? "");
      history = body.history ?? [];
    }
    if (audio && audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "El audio es muy largo. Intenta con menos de un minuto.", "too_large");
    if (!audio && text.trim().length > MAX_TEXT_CHARS) throw new HttpError(413, "El texto es muy largo. Cuéntamelo en pocas frases.", "too_long");

    const ctx = await loadContext(db);

    if (audio) {
      const ext = audio.type.includes("mp4") || audio.type.includes("m4a") ? "m4a"
        : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
      const r = await transcribe(GROQ_API_KEY, audio, `audio.${ext}`, whisperPrompt(ctx));
      transcript = r.text;
    } else {
      transcript = text.trim().slice(0, MAX_TEXT_CHARS);
    }

    if (!transcript || transcript.length < 2) {
      return json(req, {
        transcript, intent: "unknown", reply: "No te alcancé a escuchar bien. ¿Me lo repites?",
        needs_clarification: true, question: "No te alcancé a escuchar bien. ¿Me lo repites?", proposals: [], memory: null,
      });
    }

    const out = await interpret({ apiKey: GROQ_API_KEY, models: MODELS, ctx, text: transcript, history: sanitizeHistory(history) });
    let reply = out.reply;
    let queryData: { facts: string } | null = null;
    if (out.intent === "query" && out.query) {
      const { facts, fallback } = await runQuery(db, out.query, ctx);
      reply = await composeAnswer(GROQ_API_KEY, MODELS, transcript, facts, fallback);
      queryData = { facts };
    }

    const response = {
      transcript,
      intent: out.intent,
      reply,
      needs_clarification: out.needs_clarification,
      question: out.question,
      proposals: out.proposals,
      query: out.query ? { ...out.query, facts: queryData?.facts ?? null } : null,
      memory: out.memory,
      model: out.model,
      latency_ms: Date.now() - started,
    };
    await db.from("ai_logs").insert({ transcript, response, model: out.model, latency_ms: response.latency_ms });
    return json(req, response);
  } catch (err) {
    if (logDb) {
      await logDb.from("ai_logs").insert({ transcript, error: String((err as Error)?.message ?? err).slice(0, 2000), latency_ms: Date.now() - started })
        .then(() => {}, () => {});
    }
    if (err instanceof GroqError) {
      return errorResponse(req, err.status === 429
        ? new HttpError(429, "El asistente está ocupado en este momento. Intenta en unos segundos o escríbelo a mano.", "ai_busy", 20)
        : new HttpError(502, "No pude entenderte en este momento. Intenta de nuevo o regístralo a mano.", "ai_unavailable"));
    }
    return errorResponse(req, err);
  }
});
