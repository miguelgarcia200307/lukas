// Cerebro del asistente (sin APIs de Deno: también corre en Node para el banco de pruebas):
// contexto compacto con ids cortos, prompt en bloques cacheables, validación de líneas JSONL → propuestas,
// fechas y respuestas calculadas en código (plantillas), vocabulario para Whisper.

// ───────────────────────── tipos ─────────────────────────
export type Kind = "expense" | "income";
/** Contexto crudo de la RPC ai_begin/ai_context (arreglos posicionales) */
export interface RawCtx {
  name: string | null;
  def: string | null;
  cats: [string, string, Kind, string | null, string | null][];
  accs: [string, string, string][];
  cards: [string, string, string | null, string, string | null][];
  debts: [string, string, string | null, number][];
  subs: [string, string, number, string][];
  goals: [string, string, number][];
  hints: [string, string, number][];
}
export interface Cat { id: string; name: string; kind: Kind; parent: string | null; key: string | null }
export interface Built {
  v: string;
  userName: string | null;
  defAccount: string | null;
  toId: Record<string, string>;
  toAlias: Record<string, string>;
  cats: Map<string, Cat>;
  accounts: { id: string; name: string; type: string }[];
  cards: { id: string; name: string; bank: string | null }[];
  debts: { id: string; name: string; monthly: number }[];
  goals: { id: string; name: string }[];
  block: string; // contexto del usuario para el prompt (estable → cacheable)
  whisper: string; // vocabulario para Whisper
  hints: { kw: string; alias: string; uses: number }[];
}

export interface Payment { kind: "account" | "card"; id: string | null; inferred: boolean }
export interface Item { name: string; qty: number; unit_amount: number }
export type Proposal =
  | { kind: "transaction"; type: Kind; amount: number; date: string; description: string; category_id: string | null;
      category_alternatives: string[]; payment: Payment; items: Item[]; group_id: string; confidence: number }
  | { kind: "card_payment"; card_id: string | null; account_id: string | null; amount: number; interest: number | null; date: string }
  | { kind: "debt_payment"; debt_id: string | null; account_id: string | null; amount: number; mode: "expense" | "transfer"; date: string }
  | { kind: "subscription"; name: string; amount: number; frequency: "weekly" | "monthly" | "yearly"; next_charge_date: string;
      category_id: string | null; payment: Payment }
  | { kind: "goal_contribution"; goal_id: string | null; account_id: string | null; amount: number; date: string };

export interface QuerySpec { metric: string; from: string; to: string; label: string; category_id: string | null; card_id: string | null; account_id: string | null }

// ───────────────────────── fechas (Bogotá, UTC-5 fijo) ─────────────────────────
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function bogota(d: Date) {
  const b = new Date(d.getTime() - 5 * 3600 * 1000);
  const iso = b.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: b.getUTCDay(), hour: b.getUTCHours() };
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS_ES[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

/** Expresión de tiempo dicha por el usuario ("ayer", "el sábado", "hace 3 días"…) → fecha y hora. Nunca en el futuro. */
export function resolveWhen(expr: string | null | undefined, now: Date): { date: string; time: string | null } {
  const t = bogota(now);
  const e = fold(String(expr ?? ""));
  if (!e || /^(hoy|ahora|ahorita|hace un rato|manana)$/.test(e)) return { date: t.date, time: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return { date: e <= t.date ? e : t.date, time: null };
  let date = t.date, time: string | null = null;
  const hm = /(\d{1,2}):(\d{2})/.exec(e);
  if (/antenoche|anteanoche/.test(e)) { date = addDays(t.date, -2); time = "21:00"; }
  else if (/antier|anteayer|antes de ayer/.test(e)) date = addDays(t.date, -2);
  else if (/anoche/.test(e)) { date = addDays(t.date, -1); time = "21:00"; }
  else if (/ayer/.test(e)) date = addDays(t.date, -1);
  else if (/semana pasada/.test(e)) date = addDays(t.date, -7);
  else if (/mes pasado/.test(e)) date = addDays(t.date, -30);
  else if (/hace (\d+) dias?/.test(e)) date = addDays(t.date, -Number(/hace (\d+) dias?/.exec(e)![1]));
  else if (/hace (una|1) semana/.test(e)) date = addDays(t.date, -7);
  else if (/fin de semana/.test(e)) date = addDays(t.date, -(((t.weekday - 6 + 7) % 7) || 7));
  else {
    const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(e));
    const dm = /\b(\d{1,2})(?: de ([a-z]+))?\b/.exec(e);
    if (wd >= 0) date = addDays(t.date, -(((t.weekday - wd + 7) % 7) || 7));
    else if (dm && !hm) {
      const day = Number(dm[1]);
      const mi = dm[2] ? MONTHS.indexOf(dm[2]) : -1;
      let y = Number(t.date.slice(0, 4)), m = mi >= 0 ? mi : Number(t.date.slice(5, 7)) - 1;
      let iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso > t.date) { if (mi >= 0) y--; else { m--; if (m < 0) { m = 11; y--; } } iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
      if (day >= 1 && day <= 31 && !Number.isNaN(Date.parse(iso))) date = iso;
    }
  }
  if (/esta manana|en la manana|desayuno/.test(e)) time = "09:00";
  else if (/almuerzo|mediodia/.test(e)) time = "13:00";
  else if (/esta tarde|en la tarde/.test(e)) time = "15:00";
  else if (/esta noche|en la noche|cena/.test(e)) time = "20:00";
  if (hm) time = `${hm[1].padStart(2, "0")}:${hm[2]}`;
  if (date > t.date) date = t.date;
  return { date, time };
}
export function toTimestamp(date: string, time: string | null, now: Date): string {
  const t = bogota(now);
  const hm = time ?? (date === t.date ? t.time : "12:00");
  return `${date}T${hm}:00-05:00`;
}

/** Periodo de una consulta ("hoy", "semana", "mes_pasado", "7d"…) → rango y etiqueta */
export function resolvePeriod(per: string | null | undefined, now: Date, def = "mes"): { from: string; to: string; label: string } {
  const t = bogota(now);
  const p = fold(String(per || def)).replace(/\s+/g, "_");
  const monday = addDays(t.date, -((t.weekday + 6) % 7));
  const monthStart = `${t.date.slice(0, 8)}01`;
  const nd = /^(\d+)d$/.exec(p);
  if (nd) return { from: addDays(t.date, -(Number(nd[1]) - 1)), to: t.date, label: `en los últimos ${nd[1]} días` };
  switch (p) {
    case "hoy": return { from: t.date, to: t.date, label: "hoy" };
    case "ayer": return { from: addDays(t.date, -1), to: addDays(t.date, -1), label: "ayer" };
    case "semana": return { from: monday, to: t.date, label: "esta semana" };
    case "semana_pasada": return { from: addDays(monday, -7), to: addDays(monday, -1), label: "la semana pasada" };
    case "mes_pasado": {
      const prevEnd = addDays(monthStart, -1);
      return { from: `${prevEnd.slice(0, 8)}01`, to: prevEnd, label: "el mes pasado" };
    }
    case "ano": case "año": return { from: `${t.date.slice(0, 4)}-01-01`, to: t.date, label: "este año" };
    default: return { from: monthStart, to: t.date, label: "este mes" };
  }
}

// ───────────────────────── formato ─────────────────────────
export const money = (n: number) => "$" + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// ───────────────────────── contexto ─────────────────────────
export function buildContext(raw: RawCtx, v: string): Built {
  const toId: Record<string, string> = {}, toAlias: Record<string, string> = {};
  const alias = (prefix: string, ids: string[]) => ids.forEach((id, i) => { const a = `${prefix}${i + 1}`; toId[a] = id; toAlias[id] = a; });
  const cats = new Map<string, Cat>(raw.cats.map(([id, name, kind, parent, key]) => [id, { id, name, kind, parent, key }]));
  alias("c", raw.cats.map((c) => c[0]));
  alias("a", raw.accs.map((a) => a[0]));
  alias("t", raw.cards.map((c) => c[0]));
  alias("d", raw.debts.map((d) => d[0]));
  alias("m", raw.goals.map((g) => g[0]));

  const catLine = (kind: Kind) => raw.cats.filter((c) => c[2] === kind)
    .map(([id, name, , parent]) => `${toAlias[id]}:${name}${parent && cats.get(parent) ? ` (${cats.get(parent)!.name})` : ""}`).join(", ");
  const list = (items: string[]) => items.join(", ") || "ninguna";
  const block = [
    `Categorías de gasto: ${catLine("expense")}`,
    `Categorías de ingreso: ${catLine("income")}`,
    `Cuentas: ${list(raw.accs.map(([id, name]) => `${toAlias[id]}:${name}${id === raw.def ? " (por defecto)" : ""}`))}`,
    `Tarjetas de crédito: ${list(raw.cards.map(([id, name, bank, brand]) => `${toAlias[id]}:${name}${bank && !fold(name).includes(fold(bank)) ? ` ${bank}` : ""}${brand && brand !== "other" && !fold(name).includes(brand) ? ` (${brand})` : ""}`))}`,
    `Créditos: ${list(raw.debts.map(([id, name, lender, monthly]) => `${toAlias[id]}:${name}${lender ? ` ${lender}` : ""} cuota ${monthly}`))}`,
    `Metas de ahorro: ${list(raw.goals.map(([id, name]) => `${toAlias[id]}:${name}`))}`,
    `Suscripciones activas: ${list(raw.subs.map(([, name]) => name))}`,
  ].join("\n");

  // Vocabulario para Whisper: estilo + nombres propios del usuario (≤ ~224 tokens)
  const names = [...new Set([
    ...raw.accs.map((a) => a[1]), ...raw.cards.flatMap((c) => [c[1], c[2] ?? ""]), ...raw.debts.map((d) => d[1]),
    ...raw.subs.map((s) => s[1]), ...raw.goals.map((g) => g[1]),
  ].filter(Boolean))];
  const catNames = raw.cats.filter((c) => c[3]).map((c) => c[1]); // subcategorías (Taxi, Gasolina…)
  let whisper = "Gastos en pesos colombianos. Me gasté 30 lucas en el almuerzo, 5.000 de bus, medio palo de arriendo y 2 gaseosas de 3.500. " +
    "Pagué con la Visa, por Nequi, en efectivo. Uber, DiDi, D1, Ara, Éxito, Rappi, TransMilenio, tinto, empanada. ";
  for (const n of [...names, ...catNames]) { if (whisper.length + n.length > 520) break; whisper += `${n}, `; }

  return {
    v, userName: raw.name, defAccount: raw.def, toId, toAlias, cats,
    accounts: raw.accs.map(([id, name, type]) => ({ id, name, type })),
    cards: raw.cards.map(([id, name, bank]) => ({ id, name, bank })),
    debts: raw.debts.map(([id, name, , monthly]) => ({ id, name, monthly: Number(monthly) })),
    goals: raw.goals.map(([id, name]) => ({ id, name })),
    block, whisper: whisper.replace(/,\s*$/, "."),
    hints: raw.hints.filter((h) => toAlias[h[1]]).map(([kw, cat, uses]) => ({ kw, alias: toAlias[cat], uses })),
  };
}

/** Pistas aprendidas cuyas palabras aparecen en lo que dijo el usuario (máximo 8) */
export function hintsFor(b: Built, text: string): string {
  const words = new Set(fold(text).split(/[^a-z0-9]+/).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of b.hints) { // ya vienen ordenadas por uso
    if (!words.has(h.kw) || seen.has(h.kw)) continue;
    seen.add(h.kw);
    out.push(`${h.kw}→${h.alias}`);
    if (out.length >= 8) break;
  }
  return out.join(", ");
}

// ───────────────────────── prompt ─────────────────────────
export const STATIC_PROMPT = `Eres Lukas, asistente de finanzas personales en Colombia. Conviertes lo que el usuario dice (voz transcrita o texto) en registros que él confirmará después.
Responde SOLO líneas JSON (JSON Lines): un objeto por línea, sin markdown ni texto extra. Omite claves vacías o nulas.

FORMATOS
Gasto: {"k":"g","a":monto,"d":"descripción","c":"cat","alt":["cat","cat"],"p":"cuenta o tarjeta","f":"cuándo","it":[["ítem",cant,precio_unitario]]}
Ingreso: {"k":"i","a":monto,"d":"descripción","c":"cat","alt":["cat","cat"],"p":"cuenta","f":"cuándo"}
Pago a tarjeta de crédito (no es gasto): {"k":"tc","t":"tarjeta","p":"cuenta de origen","a":monto,"in":intereses}
Cuota de un crédito: {"k":"cr","cr":"crédito","p":"cuenta","a":monto} (sin "a" si no dice el monto)
Nueva suscripción: {"k":"su","n":"nombre","a":monto,"fr":"m|a|s","c":"cat","p":"cuenta o tarjeta"}
Aporte a meta de ahorro: {"k":"me","m":"meta","a":monto,"p":"cuenta"}
Consulta sobre su plata: {"k":"q","m":"gasto|ingreso|saldo|deuda|corte|creditos|suscripciones|presupuesto|metas","per":"hoy|ayer|semana|semana_pasada|mes|mes_pasado|año","c":"cat","t":"tarjeta","p":"cuenta"}
Pregunta para aclarar: {"k":"?","q":"pregunta"}
Fuera de tema o saludo: {"k":"x","r":"respuesta"}

REGLAS
1. Montos en pesos, enteros. Ya vienen en cifras ($30000 = treinta mil). Copia el monto exacto que dijo; nunca lo inventes. Si se corrige ("30, no, $35000"), usa el último.
2. Separa por categoría: cosas de categorías distintas van en líneas distintas. Lo de la misma categoría, mismo momento y lugar va en UNA línea con "it" y "a" = suma exacta de cant×precio. Un solo producto: sin "it".
3. "d": corta y natural, con mayúscula inicial ("Almuerzo", "Uber", "Comida con mi novia").
4. "c": solo ids de la lista; prefiere la subcategoría (Taxi para Uber/DiDi/taxi, Bus para TransMilenio/SITP/bus, Gasolina, Parqueadero). "alt": 2 ids distintos del mismo tipo. Si hay pistas del usuario para una palabra, úsalas.
   Guía: comida, almuerzo, tinto, domicilio, Rappi → Comida y restaurantes; D1, Ara, Éxito, Carulla, tienda, plaza → Mercado; ferretería, aseo, arreglos de la casa → Hogar; luz, agua, gas, internet, Claro → Servicios públicos; droguería, médico → Salud; cine, rumba, bar → Entretenimiento; sueldo, quincena, nómina → Salario; vendí, venta → Ventas; cliente, proyecto → Freelance; me devolvieron → Reembolsos.
5. "p": solo si dice cómo pagó o de dónde salió la plata ("con la Visa", "por Nequi", "en efectivo", "con la de Bancolombia" = su tarjeta de ese banco si tiene una). Si no lo dice, omítelo. Ingresos: solo cuentas.
6. "f": solo si no fue hoy; copia la expresión de tiempo tal como la dijo ("ayer", "anoche", "antier", "el sábado", "la semana pasada", "hace 3 días", "el 5 de noviembre", "esta mañana").
7. Si a algo le falta el monto, o no se entiende en qué gastó, o si entró o salió plata, no lo registres: emite "?" preguntando solo eso (ej. "¿Y cuánto te costaron los clavos?") y registra lo que sí está completo. No preguntes por pago, fecha ni categoría.
   Plata que le entró ("me entraron", "me cayeron", "me consignaron", "me pagaron", "recibí") con monto es un ingreso: regístralo sin preguntar (si no dice de qué, Otros ingresos).
8. Varias cosas en una frase → una línea por cada una. Primero los registros; la "?" al final.
9. Preguntas como "¿cuánto llevo?" o "¿cuánto debo en la Visa?" son consultas "q": no calcules cifras.
10. Saludo o algo ajeno a finanzas → solo "x" diciendo, amable y breve, qué puedes hacer.
11. Preguntas y respuestas: cortas, cálidas y naturales, en español colombiano neutro, tuteando, sin emojis.`;

export const FEWSHOT = `
EJEMPLOS (ids ilustrativos)
Usuario: Almorcé por $18000 con la Master y pagué un Uber de $12000 por Nequi
{"k":"g","a":18000,"d":"Almuerzo","c":"c1","alt":["c7","c18"],"p":"t2"}
{"k":"g","a":12000,"d":"Uber","c":"c27","alt":["c3","c18"],"p":"a2"}
Usuario: Fui a la ferretería por unos clavos y ayer me comí una empanada de $5000
{"k":"g","a":5000,"d":"Empanada","c":"c1","alt":["c2","c18"],"f":"ayer"}
{"k":"?","q":"¿Y cuánto te costaron los clavos?"}`;

export interface PrevState { lines: string[]; q: string | null; said: number[] }

export function parseState(state: unknown): PrevState | null {
  if (typeof state !== "string" || !state) return null;
  try {
    const s = JSON.parse(state.slice(0, 4000));
    return {
      lines: Array.isArray(s.l) ? s.l.filter((x: unknown) => typeof x === "string").slice(0, 12) : [],
      q: typeof s.q === "string" ? s.q.slice(0, 200) : null,
      said: Array.isArray(s.s) ? s.s.filter((n: unknown) => typeof n === "number").slice(0, 20) : [],
    };
  } catch { return null; }
}

export interface Msg { role: "system" | "user" | "assistant"; content: string }

/** Mensajes en orden cacheable: [estático][contexto del usuario][turno] */
export function buildMessages(b: Built, text: string, prev: PrevState | null, opts: { fewshot?: boolean; singleUser?: boolean } = {}): Msg[] {
  const hints = hintsFor(b, text);
  const turn = [
    hints ? `Pistas del usuario (palabra→categoría): ${hints}` : "",
    prev?.lines.length || prev?.q ? `Turno anterior. Registros:\n${prev.lines.join("\n") || "(ninguno)"}${prev.q ? `\nTu pregunta: ${prev.q}` : ""}\nDevuelve la lista COMPLETA y actualizada de líneas (incluye las anteriores que sigan vigentes).` : "",
    `Usuario: ${text}`,
  ].filter(Boolean).join("\n");
  const stat = STATIC_PROMPT + (opts.fewshot ? FEWSHOT : "");
  const ctx = `DATOS DEL USUARIO${b.userName ? ` (${b.userName})` : ""}\n${b.block}`;
  if (opts.singleUser) return [{ role: "user", content: `${stat}\n\n${ctx}\n\n${turn}` }];
  return [{ role: "system", content: stat }, { role: "system", content: ctx }, { role: "user", content: turn }];
}

// ───────────────────────── validación de líneas ─────────────────────────
export type LineResult =
  | { type: "proposal"; proposal: Proposal; line: string }
  | { type: "question"; text: string; line: string }
  | { type: "query"; query: QuerySpec; line: string }
  | { type: "reply"; text: string }
  | { type: "invalid"; line: string; error: string }
  | { type: "skip" };

const toInt = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const METRICS: Record<string, string> = {
  gasto: "spending", gastos: "spending", ingreso: "income", ingresos: "income", saldo: "balance", saldos: "balance",
  deuda: "card_debt", corte: "card_dates", fechas: "card_dates", pago: "card_dates", creditos: "debts", credito: "debts",
  suscripciones: "subscriptions", presupuesto: "budget", metas: "goals", meta: "goals",
};

export interface ValidateOpts { now: Date; said: number[]; strictAmounts: boolean }

/** Una línea del modelo → propuesta validada con ids reales (o error para reintentar) */
export function validateLine(rawLine: string, b: Built, o: ValidateOpts, amountOk: (a: number, itemsTotal?: number) => boolean): LineResult {
  const line = rawLine.trim().replace(/^```(json)?|```$/g, "").replace(/,\s*$/, "").trim();
  if (!line || !line.startsWith("{")) return { type: "skip" };
  let x: any;
  try { x = JSON.parse(line); } catch { return { type: "invalid", line, error: "JSON inválido" }; }
  const res = (alias: unknown, prefix: string): string | null => {
    const a = str(alias, 12);
    return a.startsWith(prefix) && b.toId[a] ? b.toId[a] : null;
  };
  const today = bogota(o.now).date;
  const payment = (p: unknown, allowCard: boolean): Payment => {
    const card = allowCard ? res(p, "t") : null;
    if (card) return { kind: "card", id: card, inferred: false };
    const acc = res(p, "a");
    if (acc) return { kind: "account", id: acc, inferred: false };
    return { kind: "account", id: b.defAccount ?? b.accounts[0]?.id ?? null, inferred: true };
  };
  const fallbackCat = (kind: Kind) => [...b.cats.values()].find((c) => c.key === (kind === "expense" ? "other_expense" : "other_income"))?.id ?? null;

  switch (x.k) {
    case "g": case "i": {
      const type: Kind = x.k === "i" ? "income" : "expense";
      const items: Item[] = (Array.isArray(x.it) ? x.it : []).map((it: unknown) => {
        const arr = Array.isArray(it) ? it : [(it as any)?.name, (it as any)?.qty, (it as any)?.unit_amount];
        const qty = Number(arr[1]) > 0 ? Math.round(Number(arr[1]) * 100) / 100 : 1;
        return { name: cap(str(arr[0], 80)), qty, unit_amount: toInt(arr[2]) ?? 0 };
      }).filter((it: Item) => it.name);
      const itemsTotal = items.reduce((s, it) => s + Math.round(it.qty * it.unit_amount), 0);
      let amount = toInt(x.a);
      if (items.length > 1 && items.every((it) => it.unit_amount > 0)) amount = itemsTotal; // el detalle manda
      if (!amount) return { type: "invalid", line, error: "sin monto: no registres sin monto, pregunta con \"?\"" };
      if (o.strictAmounts && !amountOk(amount, itemsTotal || undefined)) {
        return { type: "invalid", line, error: `el monto ${amount} no coincide con lo que dijo el usuario` };
      }
      let category_id = res(x.c, "c");
      if (category_id && b.cats.get(category_id)?.kind !== type) category_id = null;
      const lowConfidence = !category_id;
      category_id ??= fallbackCat(type);
      const alts = (Array.isArray(x.alt) ? x.alt : []).map((a: unknown) => res(a, "c"))
        .filter((id: string | null): id is string => !!id && id !== category_id && b.cats.get(id)?.kind === type);
      const when = resolveWhen(str(x.f, 60), o.now);
      const description = cap(str(x.d) || b.cats.get(category_id ?? "")?.name || "Movimiento");
      const single = items.length === 1 && items[0].qty === 1;
      return {
        type: "proposal", line,
        proposal: {
          kind: "transaction", type, amount, date: toTimestamp(when.date, when.time, o.now), description, category_id,
          category_alternatives: [...new Set(alts)].slice(0, 2) as string[], payment: payment(x.p, type === "expense"),
          items: single ? [] : items, group_id: "temp-1",
          confidence: lowConfidence ? 0.5 : Math.max(0, Math.min(1, Number(x.cf) || 0.9)),
        },
      };
    }
    case "tc": {
      const card_id = res(x.t, "t") ?? (b.cards.length === 1 ? b.cards[0].id : null);
      const amount = toInt(x.a);
      if (!amount) return { type: "question", text: "¿Cuánto le pagaste a la tarjeta?", line };
      if (!card_id) return { type: "question", text: b.cards.length ? "¿A cuál tarjeta le hiciste el pago?" : "Aún no tienes tarjetas registradas. Agrégala en Más → Tarjetas.", line };
      return { type: "proposal", line, proposal: { kind: "card_payment", card_id, account_id: res(x.p, "a") ?? b.defAccount, amount, interest: toInt(x.in), date: toTimestamp(today, null, o.now) } };
    }
    case "cr": {
      const debt_id = res(x.cr, "d") ?? (b.debts.length === 1 ? b.debts[0].id : null);
      if (!debt_id) return { type: "question", text: b.debts.length ? "¿De cuál crédito fue la cuota?" : "Aún no tienes créditos registrados. Agrégalo en Más → Créditos.", line };
      const amount = toInt(x.a) ?? (b.debts.find((d) => d.id === debt_id)?.monthly || null);
      if (!amount) return { type: "question", text: "¿Cuánto pagaste de la cuota?", line };
      return { type: "proposal", line, proposal: { kind: "debt_payment", debt_id, account_id: res(x.p, "a") ?? b.defAccount, amount, mode: "expense", date: toTimestamp(today, null, o.now) } };
    }
    case "su": {
      const amount = toInt(x.a);
      const name = cap(str(x.n, 60) || "Suscripción");
      if (!amount) return { type: "question", text: `¿Cuánto cuesta ${name}?`, line };
      const frequency = x.fr === "a" ? "yearly" : x.fr === "s" ? "weekly" : "monthly";
      let cat = res(x.c, "c");
      if (!cat || b.cats.get(cat)?.kind !== "expense") cat = [...b.cats.values()].find((c) => c.key === "subscriptions")?.id ?? null;
      return {
        type: "proposal", line,
        proposal: { kind: "subscription", name, amount, frequency, next_charge_date: addDays(today, frequency === "weekly" ? 7 : frequency === "yearly" ? 365 : 30), category_id: cat, payment: payment(x.p, true) },
      };
    }
    case "me": {
      const goal_id = res(x.m, "m") ?? (b.goals.length === 1 ? b.goals[0].id : null);
      const amount = toInt(x.a);
      if (!goal_id) return { type: "question", text: b.goals.length ? "¿Para cuál meta es ese ahorro?" : "Aún no tienes metas de ahorro. Créala en Más → Metas.", line };
      if (!amount) return { type: "question", text: "¿Cuánto ahorraste?", line };
      return { type: "proposal", line, proposal: { kind: "goal_contribution", goal_id, account_id: res(x.p, "a"), amount, date: toTimestamp(today, null, o.now) } };
    }
    case "q": {
      const metric = METRICS[fold(str(x.m, 20))] ?? "spending";
      const per = resolvePeriod(str(x.per, 20), o.now, metric === "spending" || metric === "income" ? "mes" : "mes");
      return { type: "query", line, query: { metric, ...per, category_id: res(x.c, "c"), card_id: res(x.t, "t"), account_id: res(x.p, "a") } };
    }
    case "?": {
      const q = str(x.q, 200);
      return q ? { type: "question", text: q, line } : { type: "skip" };
    }
    case "x": {
      const r = str(x.r, 300);
      return r ? { type: "reply", text: r } : { type: "skip" };
    }
  }
  return { type: "invalid", line, error: `tipo "k" desconocido: ${x.k}` };
}

// ───────────────────────── agrupación determinística ─────────────────────────
type Tx = Extract<Proposal, { kind: "transaction" }>;
/** Mismo evento = mismo tipo, categoría, día y medio de pago */
export function mergeKey(p: Proposal): string | null {
  if (p.kind !== "transaction") return null;
  return [p.type, p.category_id, p.date.slice(0, 10), p.payment.kind, p.payment.id].join("|");
}
const asItems = (p: Tx): Item[] => (p.items.length ? p.items : [{ name: p.description, qty: 1, unit_amount: p.amount }]);
function joinNames(names: string[]): string {
  const n = [...new Set(names.map((x) => x.trim()).filter(Boolean))];
  const s = n.length <= 1 ? n[0] ?? "" : n.length <= 3 ? `${n.slice(0, -1).join(", ")} y ${n[n.length - 1].toLowerCase()}` : `${n.slice(0, 2).join(", ")} y más`;
  return cap(s.length > 120 ? s.slice(0, 117) + "…" : s);
}
/** Fusiona dos transacciones del mismo evento: ítems de ambas y total sumado en código */
export function mergeTransactions(a: Proposal, b: Proposal): Proposal {
  const x = a as Tx, y = b as Tx;
  const items = [...asItems(x), ...asItems(y)];
  const amount = items.reduce((s, it) => s + Math.round(it.qty * it.unit_amount), 0);
  const alts = [...new Set([...x.category_alternatives, ...y.category_alternatives])].filter((id) => id !== x.category_id).slice(0, 2);
  return { ...x, amount, items, description: joinNames(items.map((it) => it.name)), category_alternatives: alts, confidence: Math.min(x.confidence, y.confidence) };
}

// ───────────────────────── ingresos explícitos ─────────────────────────
const W = "[a-záéíóúüñ]";
const INCOME_RE = new RegExp(`(?<!${W})(me (entraron|entr[oó]|cayeron|cay[oó]|consignaron|transfirieron|depositaron|pagaron|giraron|llegaron|lleg[oó]|mandaron)|recib[ií]|me hicieron una (consignaci[oó]n|transferencia))(?!${W})`, "i");
const EXPENSE_RE = new RegExp(`(?<!${W})(gast[eé]|pagu[eé]|compr[eé]|me cobraron|le (pagu[eé]|di|mand[eé]|transfer[ií]))(?!${W})`, "i");
/** "Me entraron $50000" sin más: ingreso con la categoría más probable, sin preguntar */
export function incomeFallback(text: string, amounts: number[], b: Built, now: Date): Proposal | null {
  if (!INCOME_RE.test(text) || EXPENSE_RE.test(text) || amounts.length !== 1) return null;
  const f = fold(text);
  const key = /quincena|sueldo|nomina|salario/.test(f) ? "salary" : /vend|venta/.test(f) ? "sales"
    : /devolv|reembols/.test(f) ? "refunds" : /cliente|proyecto|trabajo/.test(f) ? "freelance"
    : /consign|transfir|transferencia|deposit|giraron|mandaron/.test(f) ? "transfers_in" : "other_income";
  const byKey = (k: string) => [...b.cats.values()].find((c) => c.key === k && c.kind === "income")?.id ?? null;
  const category_id = byKey(key) ?? byKey("other_income");
  const alts = ["other_income", "transfers_in", "salary"].map(byKey).filter((id): id is string => !!id && id !== category_id).slice(0, 2);
  return {
    kind: "transaction", type: "income", amount: amounts[0], date: toTimestamp(bogota(now).date, null, now), description: "Ingreso",
    category_id, category_alternatives: alts, payment: { kind: "account", id: b.defAccount ?? b.accounts[0]?.id ?? null, inferred: true },
    items: [], group_id: "temp-1", confidence: 0.8,
  };
}

// ───────────────────────── respuestas con plantillas ─────────────────────────
export function recordReply(proposals: Proposal[], b: Built, seed: string): string {
  if (!proposals.length) return "";
  if (proposals.length === 1) {
    const p = proposals[0];
    if (p.kind === "transaction") {
      const cat = b.cats.get(p.category_id ?? "")?.name ?? "";
      return pick(p.type === "income" ? [
        `Listo, entraron ${money(p.amount)} en ${cat}. ¿Lo guardo así?`,
        `Anotado: ingreso de ${money(p.amount)}. ¿Lo guardo?`,
        `Perfecto, ${money(p.amount)} de ${cat.toLowerCase()}. Revisa y confirma.`,
      ] : [
        `Listo, ${money(p.amount)} en ${cat}. ¿Lo guardo así?`,
        `Anotado: ${p.description.toLowerCase()} por ${money(p.amount)}. ¿Lo guardo?`,
        `Perfecto, ${money(p.amount)} en ${cat}. Revisa y confirma.`,
        `Listo, ¿guardo ${p.description.toLowerCase()} por ${money(p.amount)}?`,
      ], seed);
    }
    if (p.kind === "card_payment") return `Listo, pago de ${money(p.amount)} a la ${b.cards.find((c) => c.id === p.card_id)?.name ?? "tarjeta"}. ¿Lo guardo?`;
    if (p.kind === "debt_payment") return `Cuota de ${money(p.amount)} de ${b.debts.find((d) => d.id === p.debt_id)?.name ?? "tu crédito"}. ¿La registro?`;
    if (p.kind === "subscription") return `Nueva suscripción: ${p.name} por ${money(p.amount)} ${p.frequency === "yearly" ? "al año" : p.frequency === "weekly" ? "a la semana" : "al mes"}. ¿La guardo?`;
    return `Aporte de ${money(p.amount)} a ${b.goals.find((g) => g.id === p.goal_id)?.name ?? "tu meta"}. ¿Lo guardo?`;
  }
  const total = proposals.reduce((s, p) => s + p.amount, 0);
  return pick([
    `Listo, te separé ${proposals.length} movimientos por ${money(total)}. ¿Los guardo así?`,
    `Anotado: ${proposals.length} registros. Revísalos y confirma.`,
    `Perfecto, son ${proposals.length} movimientos. ¿Los guardo así?`,
  ], seed);
}

export const OUT_OF_SCOPE = "Puedo ayudarte a anotar gastos e ingresos, pagos de tarjeta, cuotas, suscripciones y ahorros, y contarte cómo van tus cuentas. ¿Qué quieres registrar?";

type Row = (string | number | null)[];
/** Respuesta a una consulta con los datos calculados en SQL (sin segunda llamada al LLM) */
export function queryReply(q: QuerySpec, d: any, b: Built): string {
  const rows: Row[] = Array.isArray(d?.rows) ? d.rows : [];
  const label = q.label;
  const Label = cap(label);
  const catName = q.category_id ? b.cats.get(q.category_id)?.name : null;
  switch (q.metric) {
    case "spending": case "income": {
      const total = Number(d?.total ?? 0), count = Number(d?.count ?? 0), prev = Number(d?.prev_total ?? 0);
      const past = q.label === "ayer" || q.label.includes("pasad");
      if (q.metric === "income") {
        if (!total) return `${Label} no has registrado ingresos${catName ? ` en ${catName}` : ""}.`;
        return `${Label} ${past ? "te entraron" : "te han entrado"} ${money(total)}${catName ? ` en ${catName}` : ""}.`;
      }
      if (!total) return `${Label} no has registrado gastos${catName ? ` en ${catName}` : ""} todavía.`;
      let s = `${Label} ${past ? "gastaste" : "llevas"} ${money(total)}${catName ? ` en ${catName}` : ` en ${count} ${count === 1 ? "gasto" : "gastos"}`}`;
      const top = Array.isArray(d?.top) ? d.top : [];
      if (!catName && top.length > 1 && label !== "hoy") s += `, sobre todo en ${top[0][0]} (${money(top[0][1])})`;
      s += ".";
      if (prev > 0 && label !== "hoy" && label !== "ayer") {
        const diff = Math.round(((total - prev) / prev) * 100);
        if (Math.abs(diff) >= 5) s += ` Es ${Math.abs(diff)}% ${diff > 0 ? "más" : "menos"} que el periodo anterior.`;
      }
      return s;
    }
    case "balance": {
      if (!rows.length) return "Aún no tienes cuentas registradas.";
      if (q.account_id || rows.length === 1) return `En ${rows[0][0]} tienes ${money(Number(rows[0][1]))}.`;
      const total = rows.reduce((s, r) => s + Number(r[1]), 0);
      return `Tienes ${money(total)} en total: ${rows.slice(0, 4).map((r) => `${r[0]} ${money(Number(r[1]))}`).join(", ")}.`;
    }
    case "card_debt": {
      if (!rows.length) return "Aún no tienes tarjetas registradas.";
      if (q.card_id || rows.length === 1) {
        const [name, , debt, avail] = rows[0];
        return Number(debt) > 0 ? `En la ${name} debes ${money(Number(debt))} y te quedan ${money(Number(avail))} de cupo.` : `La ${name} está al día: no le debes nada.`;
      }
      const total = rows.reduce((s, r) => s + Number(r[2]), 0);
      return total > 0 ? `En tarjetas debes ${money(total)}: ${rows.map((r) => `${r[0]} ${money(Number(r[2]))}`).join(", ")}.` : "Tus tarjetas están al día: no debes nada.";
    }
    case "card_dates": {
      if (!rows.length) return "Aún no tienes tarjetas registradas.";
      return rows.slice(0, 3).map((r) => `La ${r[0]} corta el ${longDate(String(r[5]))} y se paga el ${longDate(String(r[6]))}.`).join(" ");
    }
    case "debts": {
      if (!rows.length) return "No tienes créditos registrados.";
      const total = rows.reduce((s, r) => s + Number(r[1]), 0);
      const first = rows[0];
      return `En créditos debes ${money(total)}.${first[3] ? ` La próxima cuota de ${first[0]} es de ${money(Number(first[2]))} el ${longDate(String(first[3]))}.` : ""}`;
    }
    case "subscriptions": {
      if (!rows.length) return "No tienes suscripciones activas.";
      const monthly = rows.reduce((s, r) => s + Number(r[4]), 0);
      return `Pagas ${money(monthly)} al mes en ${rows.length} ${rows.length === 1 ? "suscripción" : "suscripciones"}: ${rows.slice(0, 4).map((r) => r[0]).join(", ")}. La próxima es ${rows[0][0]} el ${longDate(String(rows[0][3]))}.`;
    }
    case "budget": {
      if (!rows.length) return "No tienes presupuestos configurados.";
      return rows.slice(0, 3).map((r) => `${r[0]}: llevas ${money(Number(r[2]))} de ${money(Number(r[3]))} (${Math.round(Number(r[4]))}%).`).join(" ");
    }
    case "goals": {
      if (!rows.length) return "Aún no tienes metas de ahorro.";
      return rows.slice(0, 3).map((r) => `${r[0]}: llevas ${money(Number(r[1]))} de ${money(Number(r[2]))}.`).join(" ");
    }
  }
  return "No encontré datos para esa pregunta.";
}
