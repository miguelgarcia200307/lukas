// daily-reminders: lo invoca pg_cron cada hora. Decide qué avisos enviar según la hora de Bogotá y las preferencias.
// Prueba manual: POST {"slot":"all"} (o "morning" | "weekly" | "evening") con el header x-cron-secret.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { errorResponse, HttpError, json, preflight } from "../_shared/cors.ts";
import { adminClient, requireInternal } from "../_shared/auth.ts";
import { notify } from "../_shared/push.ts";
import { addDays, bogota } from "../_shared/prompt.ts";

type Slot = "morning" | "weekly" | "evening";
interface Profile { user_id: string; name: string | null; reminder_time: string; notification_prefs: Record<string, boolean> }

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const whenText = (d: number) => d === 0 ? "Hoy" : d === 1 ? "Mañana" : `En ${d} días`;
const on = (prefs: Record<string, boolean>, key: string) => prefs?.[key] !== false;

async function morning(admin: SupabaseClient, p: Profile, today: string, log: string[]) {
  const uid = p.user_id;
  const prefs = p.notification_prefs ?? {};

  // Tarjetas: corte (1 día antes y el mismo día) y pago (3, 1 y 0 días)
  const { data: cards, error: cErr } = await admin.from("card_status").select("*").eq("user_id", uid).eq("archived", false);
  if (cErr) throw cErr;
  for (const c of cards ?? []) {
    const label = [c.name, c.bank].filter(Boolean).join(" ");
    const dCut = daysBetween(today, c.next_cut_date);
    if (on(prefs, "card_cut") && (dCut === 0 || dCut === 1)) {
      const ok = await notify(admin, uid, {
        type: "card_cut", title: `${whenText(dCut)} es el corte de tu ${label}`,
        body: `Llevas ${money(c.debt)} en esta tarjeta. Lo que compres después del corte pasa al siguiente extracto.`,
        url: `#/tarjetas/${c.id}`,
      }, `cut:${c.id}:${c.next_cut_date}:${dCut}`);
      if (ok) log.push(`cut ${c.name} ${dCut}`);
    }
    const dDue = daysBetween(today, c.next_due_date);
    if (on(prefs, "card_due") && [0, 1, 3].includes(dDue) && Number(c.debt) > 0) {
      const ok = await notify(admin, uid, {
        type: "card_due",
        title: dDue === 0 ? `Hoy vence el pago de tu ${label}` : `${whenText(dDue)} vence el pago de tu ${label}`,
        body: `Deuda actual: ${money(c.debt)}. Paga a tiempo y evita intereses de mora.`,
        url: `#/tarjetas/${c.id}`,
      }, `due:${c.id}:${c.next_due_date}:${dDue}`);
      if (ok) log.push(`due ${c.name} ${dDue}`);
    }
  }

  // Créditos: 1 día antes y el mismo día
  if (on(prefs, "debts")) {
    const { data: debts, error } = await admin.from("debt_status").select("*").eq("user_id", uid).eq("archived", false).gt("balance", 0);
    if (error) throw error;
    for (const d of debts ?? []) {
      if (!d.next_due_date) continue;
      const days = daysBetween(today, d.next_due_date);
      if (days !== 0 && days !== 1) continue;
      const ok = await notify(admin, uid, {
        type: "debt_due", title: `${whenText(days)} pagas la cuota de ${d.name}`,
        body: `Cuota: ${money(d.monthly_payment)} · Saldo pendiente: ${money(d.balance)}`, url: "#/creditos",
      }, `debt:${d.id}:${d.next_due_date}:${days}`);
      if (ok) log.push(`debt ${d.name} ${days}`);
    }
  }

  // Suscripciones: aviso 1 día antes; auto-registro el día del cobro (y pone al día cobros atrasados)
  const { data: subs, error: sErr } = await admin.from("subscriptions").select("*").eq("user_id", uid).eq("active", true);
  if (sErr) throw sErr;
  for (const s of subs ?? []) {
    const days = daysBetween(today, s.next_charge_date);
    if (days === 1 && on(prefs, "subscriptions")) {
      const ok = await notify(admin, uid, {
        type: "subscription", title: `Mañana se cobra ${s.name}`,
        body: `${money(s.amount)}${s.auto_register ? " · Lo registro automáticamente." : ""}`, url: "#/suscripciones",
      }, `sub:${s.id}:${s.next_charge_date}:1`);
      if (ok) log.push(`sub ${s.name}`);
    }
    if (s.auto_register && days <= 0) {
      let next = s.next_charge_date as string;
      for (let i = 0; i < 12 && next <= today; i++) {
        const { error } = await admin.rpc("charge_subscription", { p_id: s.id });
        if (error) { console.error("charge_subscription", s.id, error); break; }
        const { data: fresh } = await admin.from("subscriptions").select("next_charge_date").eq("id", s.id).single();
        if (on(prefs, "subscriptions")) {
          await notify(admin, uid, {
            type: "subscription", title: `Registré el cobro de ${s.name}`,
            body: `${money(s.amount)} quedó en tus movimientos.`, url: "#/movimientos",
          }, `sub-charged:${s.id}:${next}`);
        }
        log.push(`charged ${s.name} ${next}`);
        next = fresh?.next_charge_date ?? "9999-12-31";
      }
    }
  }
}

async function weekly(admin: SupabaseClient, p: Profile, today: string, log: string[]) {
  if (!on(p.notification_prefs, "weekly_summary")) return;
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((wd + 6) % 7));
  const prevMonday = addDays(monday, -7);
  const { data, error } = await admin.from("transactions").select("amount, occurred_at, category_id, categories(name, parent_id)")
    .eq("user_id", p.user_id).eq("type", "expense")
    .gte("occurred_at", `${prevMonday}T00:00:00-05:00`).lt("occurred_at", `${addDays(monday, 7)}T00:00:00-05:00`);
  if (error) throw error;
  let cur = 0, prev = 0;
  const byCat = new Map<string, number>();
  for (const t of data ?? []) {
    const d = bogota(new Date(t.occurred_at)).date;
    if (d >= monday) {
      cur += Number(t.amount);
      // deno-lint-ignore no-explicit-any
      const name = (t as any).categories?.name ?? "Sin categoría";
      byCat.set(name, (byCat.get(name) ?? 0) + Number(t.amount));
    } else prev += Number(t.amount);
  }
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  const diff = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  const cmp = diff === null ? "" : diff === 0 ? " Igual que la semana pasada." :
    diff > 0 ? ` ${diff}% más que la semana pasada.` : ` ${Math.abs(diff)}% menos que la semana pasada.`;
  const ok = await notify(admin, p.user_id, {
    type: "weekly_summary", title: `Tu semana: ${money(cur)} en gastos`,
    body: (top ? `Donde más gastaste: ${top[0]} (${money(top[1])}).` : "No registraste gastos esta semana.") + cmp,
    url: "#/reportes",
  }, `weekly:${monday}`);
  if (ok) log.push("weekly");
}

async function evening(admin: SupabaseClient, p: Profile, today: string, log: string[]) {
  if (!on(p.notification_prefs, "no_activity")) return;
  const { count, error } = await admin.from("transactions").select("id", { count: "exact", head: true })
    .eq("user_id", p.user_id).gte("created_at", `${today}T00:00:00-05:00`);
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  const ok = await notify(admin, p.user_id, {
    type: "no_activity", title: "¿Gastaste algo hoy?",
    body: `${p.name ? p.name + ", c" : "C"}uéntamelo en 10 segundos y mantén tus cuentas al día.`, url: "#/inicio?voz=1",
  }, `noact:${today}`);
  if (ok) log.push("evening");
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    requireInternal(req);
    const body = await req.json().catch(() => ({}));
    const requested = String(body.slot ?? "auto");
    const admin = adminClient();
    const now = bogota(new Date());
    const hour = Number(now.time.slice(0, 2));

    let q = admin.from("profiles").select("user_id, name, reminder_time, notification_prefs");
    if (body.user_id) q = q.eq("user_id", body.user_id);
    const { data: profiles, error } = await q;
    if (error) throw error;

    const results: Record<string, string[]> = {};
    for (const p of (profiles ?? []) as Profile[]) {
      const slots: Slot[] = [];
      if (requested === "auto") {
        if (hour === Number(String(p.reminder_time ?? "08:00").slice(0, 2))) slots.push("morning");
        if (now.weekday === 0 && hour === 19) slots.push("weekly");
        if (hour === 21) slots.push("evening");
      } else if (requested === "all") slots.push("morning", "weekly", "evening");
      else if (["morning", "weekly", "evening"].includes(requested)) slots.push(requested as Slot);

      const log: string[] = [];
      for (const slot of slots) {
        try {
          if (slot === "morning") await morning(admin, p, now.date, log);
          if (slot === "weekly") await weekly(admin, p, now.date, log);
          if (slot === "evening") await evening(admin, p, now.date, log);
        } catch (err) {
          console.error(`slot ${slot} failed for ${p.user_id}`, err);
          log.push(`error ${slot}: ${(err as Error).message ?? err}`);
        }
      }
      results[p.user_id] = log;
    }
    return json(req, { ok: true, bogota: `${now.date} ${now.time}`, requested, results });
  } catch (err) {
    return errorResponse(req, err);
  }
});
