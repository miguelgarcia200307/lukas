// daily-reminders: lo invoca pg_cron cada hora. Decide qué avisos enviar según la hora de Bogotá y las preferencias.
// Prueba manual: POST {"slot":"all"} (o "morning" | "weekly" | "evening") con el header x-cron-secret.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { errorResponse, HttpError, json, preflight } from "../_shared/cors.ts";
import { adminClient, requireInternal } from "../_shared/auth.ts";
import { notify } from "../_shared/push.ts";
import { addDays, bogota } from "../_shared/brain.ts";
import * as voice from "../_shared/lukas-voice.ts";

type Slot = "morning" | "weekly" | "evening";
interface Profile { user_id: string; name: string | null; reminder_time: string; notification_prefs: Record<string, boolean> }

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const on = (prefs: Record<string, boolean>, key: string) => prefs?.[key] !== false;

// Cada aviso se redacta con la voz de Lukas (lukas-voice.ts): variantes con semilla = usuario + clave del aviso
const rngFor = (p: Profile, key: string) => voice.seeded(`${p.user_id}:${key}`);

async function morning(admin: SupabaseClient, p: Profile, today: string, log: string[]) {
  const uid = p.user_id;
  const prefs = p.notification_prefs ?? {};
  const name = p.name;

  // Tarjetas: corte (el mismo día y los días antes que elija el usuario por tarjeta; 1 por defecto) y pago
  // (el mismo día, 1 día antes y los días que elija; 3 por defecto). remind_*_days = null apaga ese aviso de la tarjeta.
  // Sin la migración de Tarjetas 2.0 las columnas no existen (undefined) y se usan los valores de siempre.
  const { data: cards, error: cErr } = await admin.from("card_status").select("*").eq("user_id", uid).eq("archived", false);
  if (cErr) throw cErr;
  for (const c of cards ?? []) {
    const label = [c.name, c.bank].filter(Boolean).join(" ");
    const dCut = daysBetween(today, c.next_cut_date);
    const cutDays = c.remind_cut_days === undefined ? 1 : c.remind_cut_days;
    const dueDays = c.remind_due_days === undefined ? 3 : c.remind_due_days;
    if (on(prefs, "card_cut") && cutDays !== null && (dCut === 0 || dCut === Number(cutDays))) {
      const key = `cut:${c.id}:${c.next_cut_date}:${dCut}`;
      const msg = voice.cardCut({ rng: rngFor(p, key), name, label, days: dCut, debt: Number(c.debt), usagePct: Number(c.usage_pct) });
      const ok = await notify(admin, uid, { type: "card_cut", ...msg, url: `#/tarjetas/${c.id}` }, key);
      if (ok) log.push(`cut ${c.name} ${dCut}`);
    }
    const dDue = daysBetween(today, c.next_due_date);
    if (on(prefs, "card_due") && dueDays !== null && [0, 1, Number(dueDays)].includes(dDue) && Number(c.debt) > 0) {
      const key = `due:${c.id}:${c.next_due_date}:${dDue}`;
      const msg = voice.cardDue({ rng: rngFor(p, key), name, label, days: dDue, debt: Number(c.debt), estInterest: c.est_interest == null ? null : Number(c.est_interest) });
      const ok = await notify(admin, uid, { type: "card_due", ...msg, url: `#/tarjetas/${c.id}` }, key);
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
      const key = `debt:${d.id}:${d.next_due_date}:${days}`;
      const msg = voice.debtDue({
        rng: rngFor(p, key), name, debt: d.name, days, payment: Number(d.monthly_payment), balance: Number(d.balance), progressPct: Number(d.progress_pct),
      });
      const ok = await notify(admin, uid, { type: "debt_due", ...msg, url: "#/creditos" }, key);
      if (ok) log.push(`debt ${d.name} ${days}`);
    }
  }

  // Suscripciones: aviso 1 día antes; auto-registro el día del cobro (y pone al día cobros atrasados)
  const { data: subs, error: sErr } = await admin.from("subscriptions").select("*").eq("user_id", uid).eq("active", true);
  if (sErr) throw sErr;
  for (const s of subs ?? []) {
    const days = daysBetween(today, s.next_charge_date);
    if (days === 1 && on(prefs, "subscriptions")) {
      const key = `sub:${s.id}:${s.next_charge_date}:1`;
      const msg = voice.subscriptionSoon({ rng: rngFor(p, key), name, sub: s.name, amount: Number(s.amount), frequency: s.frequency, auto: !!s.auto_register });
      const ok = await notify(admin, uid, { type: "subscription", ...msg, url: "#/suscripciones" }, key);
      if (ok) log.push(`sub ${s.name}`);
    }
    if (s.auto_register && days <= 0) {
      let next = s.next_charge_date as string;
      for (let i = 0; i < 12 && next <= today; i++) {
        const { error } = await admin.rpc("charge_subscription", { p_id: s.id });
        if (error) { console.error("charge_subscription", s.id, error); break; }
        const { data: fresh } = await admin.from("subscriptions").select("next_charge_date").eq("id", s.id).single();
        if (on(prefs, "subscriptions")) {
          const key = `sub-charged:${s.id}:${next}`;
          const msg = voice.subscriptionCharged({ rng: rngFor(p, key), name, sub: s.name, amount: Number(s.amount) });
          await notify(admin, uid, { type: "subscription", ...msg, url: "#/movimientos" }, key);
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
  let cur = 0, prev = 0, count = 0;
  const byCat = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const t of data ?? []) {
    const d = bogota(new Date(t.occurred_at)).date;
    if (d >= monday) {
      cur += Number(t.amount);
      count++;
      byDay.set(d, (byDay.get(d) ?? 0) + Number(t.amount));
      // deno-lint-ignore no-explicit-any
      const name = (t as any).categories?.name ?? "Sin categoría";
      byCat.set(name, (byCat.get(name) ?? 0) + Number(t.amount));
    } else prev += Number(t.amount);
  }
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const day = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const busiest = day ? { weekday: new Date(`${day[0]}T12:00:00Z`).getUTCDay(), amount: day[1] } : null;
  const key = `weekly:${monday}`;
  const msg = voice.weekly({ rng: rngFor(p, key), name: p.name, cur, prev, count, top, busiest });
  const ok = await notify(admin, p.user_id, { type: "weekly_summary", ...msg, url: "#/reportes" }, key);
  if (ok) log.push("weekly");
}

async function evening(admin: SupabaseClient, p: Profile, today: string, log: string[]) {
  if (!on(p.notification_prefs, "no_activity")) return;
  const { count, error } = await admin.from("transactions").select("id", { count: "exact", head: true })
    .eq("user_id", p.user_id).gte("created_at", `${today}T00:00:00-05:00`);
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  // ¿Hace cuánto no registra nada? (para hablarle distinto si lleva varios días)
  const { data: last } = await admin.from("transactions").select("created_at")
    .eq("user_id", p.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lastDate = last?.created_at ? bogota(new Date(last.created_at)).date : null;
  const d = new Date(`${today}T12:00:00Z`);
  const key = `noact:${today}`;
  const msg = voice.evening({
    rng: rngFor(p, key), name: p.name, weekday: d.getUTCDay(), day: d.getUTCDate(),
    lastDay: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(),
    daysSince: lastDate ? daysBetween(lastDate, today) : null,
  });
  const ok = await notify(admin, p.user_id, { type: "no_activity", ...msg, url: "#/inicio?voz=1" }, key);
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
