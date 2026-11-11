// budget-check: lo dispara el trigger de transactions (pg_net). Avisa al 80%, 100% y al sobrepasar, una vez por umbral y periodo.
import { errorResponse, HttpError, json, preflight } from "../_shared/cors.ts";
import { adminClient, requireInternal } from "../_shared/auth.ts";
import { notify } from "../_shared/push.ts";

interface BudgetRow {
  budget_id: string | null; category_id: string | null; name: string; period: "daily" | "weekly" | "monthly";
  amount: number; spent: number; pct: number; period_start: string; thresholds: number[];
}

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopeText(b: BudgetRow): string {
  const when = b.period === "daily" ? "hoy" : b.period === "weekly" ? "esta semana" : "este mes";
  return b.budget_id ? `tu presupuesto de ${b.name} ${when}` : `tu límite de ${when}`;
}

function message(b: BudgetRow, level: number | "over") {
  const figures = `${money(b.spent)} de ${money(b.amount)}`;
  const scope = scopeText(b);
  if (level === "over") return { title: `Te pasaste de ${scope}`, body: `Llevas ${figures}. Mañana es otro día para retomar.` };
  if (level >= 100) return { title: `Llegaste al 100% de ${scope}`, body: `Llevas ${figures}. Lo que sigas gastando ya sobrepasa el plan.` };
  return { title: `Ojo, ya vas en el ${level}% de ${scope}`, body: `Llevas ${figures}.` };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    requireInternal(req);
    const { user_id } = await req.json().catch(() => ({}));
    if (typeof user_id !== "string" || !UUID.test(user_id)) throw new HttpError(400, "user_id inválido");

    const admin = adminClient();
    const { data: profile } = await admin.from("profiles").select("notification_prefs").eq("user_id", user_id).maybeSingle();
    if (profile?.notification_prefs?.budget === false) return json(req, { ok: true, skipped: "disabled" });

    const { data, error } = await admin.rpc("budget_status", { p_user: user_id });
    if (error) throw error;

    const sent: string[] = [];
    for (const b of (data ?? []) as BudgetRow[]) {
      const pct = Number(b.pct);
      const thresholds = [...(b.thresholds?.length ? b.thresholds : [80, 100])].sort((x, y) => x - y);
      // Solo el nivel más alto alcanzado: si un gasto salta de 50% a 120%, llega un solo aviso
      let level: number | "over" | null = null;
      for (const t of thresholds) if (pct >= t) level = t;
      if (pct > 100 && Number(b.spent) > Number(b.amount)) level = "over";
      if (level === null) continue;

      const key = `budget:${b.budget_id ?? "daily"}:${b.period_start}:${level}`;
      const { title, body } = message(b, level);
      const created = await notify(admin, user_id, { type: "budget", title, body, url: "#/inicio" }, key);
      if (created) sent.push(key);
    }
    return json(req, { ok: true, sent });
  } catch (err) {
    return errorResponse(req, err);
  }
});
