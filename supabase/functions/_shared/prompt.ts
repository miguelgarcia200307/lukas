// Prompt, esquema y validación del asistente. TypeScript "borrable" sin APIs de Deno (se prueba también en Node).

export type Intent =
  | "create_transactions" | "card_payment" | "debt_payment" | "add_subscription"
  | "goal_contribution" | "query" | "unknown";

export const INTENTS: Intent[] = [
  "create_transactions", "card_payment", "debt_payment", "add_subscription", "goal_contribution", "query", "unknown",
];
export const QUERY_TOPICS = [
  "spending", "income", "balance", "card_debt", "card_dates", "debts", "subscriptions", "budget", "goals",
] as const;

export interface Category { id: string; name: string; kind: "expense" | "income"; parent_id: string | null; system_key: string | null }
export interface Account { id: string; name: string; type: string; balance?: number }
export interface Card { id: string; name: string; bank: string | null; brand: string; last4: string | null; debt?: number; next_cut_date?: string; next_due_date?: string }
export interface Debt { id: string; name: string; lender: string | null; monthly_payment: number; balance?: number }
export interface Subscription { id: string; name: string; amount: number; frequency: string; next_charge_date: string }
export interface Goal { id: string; name: string; target_amount: number; saved?: number }

export interface Ctx {
  now: Date;
  userName?: string | null;
  categories: Category[];
  accounts: Account[];
  cards: Card[];
  debts: Debt[];
  subscriptions: Subscription[];
  goals: Goal[];
  defaultAccountId: string | null;
}

export interface Aliases { toId: Record<string, string>; toAlias: Record<string, string> }

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Colombia no tiene horario de verano: UTC-5 fijo.
const BOGOTA_OFFSET_MS = -5 * 3600 * 1000;
export function bogota(d: Date) {
  const b = new Date(d.getTime() + BOGOTA_OFFSET_MS);
  const iso = b.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: b.getUTCDay(), day: b.getUTCDate(), month: b.getUTCMonth(), year: b.getUTCFullYear() };
}
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildAliases(ctx: Ctx): Aliases {
  const toId: Record<string, string> = {};
  const toAlias: Record<string, string> = {};
  const add = (prefix: string, items: { id: string }[]) =>
    items.forEach((it, i) => { const a = `${prefix}${i + 1}`; toId[a] = it.id; toAlias[it.id] = a; });
  add("c", ctx.categories);
  add("a", ctx.accounts);
  add("t", ctx.cards);
  add("d", ctx.debts);
  add("s", ctx.subscriptions);
  add("g", ctx.goals);
  return { toId, toAlias };
}

const money = (n: number | undefined) => n == null ? "?" : "$" + Math.round(n).toLocaleString("es-CO").replace(/,/g, ".");

export function systemPrompt(ctx: Ctx, al: Aliases): string {
  const t = bogota(ctx.now);
  const monday = addDays(t.date, -((t.weekday + 6) % 7));
  const lastWeek = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(t.date, -i);
    const wd = WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];
    return `${wd} ${d}`;
  }).join(", ");
  const catName = new Map(ctx.categories.map((c) => [c.id, c.name]));
  const cats = ctx.categories.map((c) =>
    `${al.toAlias[c.id]} | ${c.name} | ${c.kind === "expense" ? "gasto" : "ingreso"}${c.parent_id ? ` | subcategoría de ${catName.get(c.parent_id) ?? "?"}` : ""}`
  ).join("\n");
  const def = ctx.defaultAccountId ? al.toAlias[ctx.defaultAccountId] : null;
  const accounts = ctx.accounts.map((a) => `${al.toAlias[a.id]} | ${a.name} | ${a.type}${a.id === ctx.defaultAccountId ? " | POR DEFECTO" : ""}`).join("\n") || "(ninguna)";
  const cards = ctx.cards.map((c) => `${al.toAlias[c.id]} | ${c.name} | ${c.bank ?? ""} | ${c.brand}${c.last4 ? ` ****${c.last4}` : ""}`).join("\n") || "(ninguna)";
  const debts = ctx.debts.map((d) => `${al.toAlias[d.id]} | ${d.name} | ${d.lender ?? ""} | cuota ${money(d.monthly_payment)}`).join("\n") || "(ninguno)";
  const subs = ctx.subscriptions.map((s) => `${al.toAlias[s.id]} | ${s.name} | ${money(s.amount)} ${s.frequency}`).join("\n") || "(ninguna)";
  const goals = ctx.goals.map((g) => `${al.toAlias[g.id]} | ${g.name} | meta ${money(g.target_amount)}`).join("\n") || "(ninguna)";

  return `Eres Lukas, el asistente de finanzas personales de ${ctx.userName || "el usuario"} en Colombia. Conviertes lo que dice (transcrito de voz o escrito, en español colombiano coloquial) en propuestas de registro estructuradas. NO guardas nada: el usuario confirma después.

FECHA Y HORA ACTUAL (America/Bogota): ${WEEKDAYS[t.weekday]} ${t.day} de ${MONTHS[t.month]} de ${t.year}, ${t.time}. Hoy = ${t.date}.
Últimos 7 días: ${lastWeek}.
"ayer" = ${addDays(t.date, -1)}; "antier"/"anteayer" = ${addDays(t.date, -2)}; "anoche" = ayer a las 21:00 (si ya es de madrugada, anoche puede ser hoy temprano).
"esta semana" = ${monday} a ${t.date} (semana inicia lunes). "la semana pasada" = ${addDays(monday, -7)} a ${addDays(monday, -1)}.
"este mes" = ${t.date.slice(0, 8)}01 a ${t.date}. Un día de la semana sin más ("el viernes") es el más reciente ya pasado (o hoy si es hoy).

MONTOS (pesos colombianos, enteros, sin decimales):
- "luca"/"lucas"/"barras"/"k"/"mil" = ×1.000 → "30 lucas" = 30000, "5 lucas" = 5000, "30k" = 30000, "mil quinientos" = 1500, "luca y media" = 1500.
- "palo"/"palos"/"millón" = ×1.000.000 → "un palo" = 1000000, "palo y medio" = 1500000, "2 palos y medio" = 2500000.
- "500 mil" = 500000. "medio palo" = 500000. Si dice "30.000" o "30,000" es treinta mil.
- Cantidad × precio unitario: "dos gaseosas de 5.000 cada una" = qty 2, unit_amount 5000 (total 10000).
- NUNCA inventes un monto. Si un gasto no tiene monto, NO lo incluyas en transactions y pregunta por él.

CÓMO ARMAR LAS TRANSACCIONES (intent "create_transactions"):
1. Separa por categoría: cosas de categorías distintas en la misma frase → transacciones separadas (mismo "group").
   Ej.: clavos (Hogar) + empanada (Comida) → 2 transacciones.
2. Agrupa por evento: ítems de la MISMA categoría del mismo momento/lugar → UNA transacción con su detalle en "items" y "amount" = total exacto.
   Ej.: "salchipapa de 30.000, hamburguesa de 22.000 y dos gaseosas de 5.000" → 1 transacción de 62000 con 3 items (Gaseosa qty 2, unit_amount 5000).
   Si solo hay un producto o el usuario no detalla productos, "items" puede ir vacío.
3. "description": corta y natural en español (ej. "Comida con mi novia", "Empanada", "Venta", "Uber al trabajo"). Primera letra en mayúscula.
4. Categoría: usa SOLO alias de la lista. Prefiere la subcategoría si aplica (Taxi, Gasolina, Bus, Parqueadero, Intereses, 4x1000…).
   Da SIEMPRE 2 alternativas razonables y distintas en "category_alternatives" (del mismo tipo gasto/ingreso).
   Pistas: restaurante/almuerzo/comida/Rappi/domicilio/empanada/café → Comida y restaurantes (salir a comer con la pareja: Comida, alternativa Pareja).
   D1/Ara/Éxito/Carulla/Olímpica/Jumbo/plaza/tienda de barrio (mercado) → Mercado. Uber/DiDi/InDrive/Cabify/taxi → Taxi. TransMilenio/MIO/Metro/SITP/bus/buseta → Bus.
   Tanqueé/gasolina/Terpel → Gasolina. Ferretería/arreglos/aseo de la casa → Hogar. Luz/agua/gas/internet/Claro/Movistar/Tigo/EPM/Enel → Servicios públicos.
   Droguería/médico/EPS/Cruz Verde/Farmatodo → Salud. Netflix/Spotify/Disney/iCloud/YouTube/ChatGPT → Suscripciones. Cine/rumba/concierto/bar → Entretenimiento.
   Novio(a)/esposo(a)/pareja (regalos, planes) → Pareja. Ingresos: "me pagaron el sueldo/quincena/nómina" → Salario; "vendí"/"una venta" → Ventas; "un cliente me pagó"/proyecto → Freelance; "me transfirieron"/"me consignaron" → Transferencias recibidas; "me devolvieron" → Reembolsos.
5. Tipo: gasto ("expense") o ingreso ("income": "me pagaron", "recibí", "vendí", "me consignaron", "me entró"). Si no es claro si entró o salió plata, pregunta.
6. Método de pago ("payment"): si menciona tarjeta ("con la Visa", "con la tarjeta de Bancolombia", "con la Master") → kind "card" con el alias de la tarjeta, inferred false.
   Si menciona cuenta ("por Nequi", "en efectivo", "de Bancolombia", "con Daviplata", "transferencia") → kind "account" con su alias, inferred false.
   Si no menciona nada → kind "account", ref ${def ? `"${def}" (cuenta por defecto)` : "null"}, inferred true. "Con tarjeta" ambiguo con varias tarjetas → usa la primera tarjeta y confidence baja.
   Para ingresos usa solo cuentas.
7. Fecha: "date" = YYYY-MM-DD; "time" = HH:mm si se deduce ("al almuerzo" ≈ 13:00, "anoche" ≈ 21:00, "esta mañana" ≈ 09:00), si no, null.
8. "confidence" 0–1: qué tan seguro estás de la transacción completa.

OTRAS INTENCIONES (todas se confirman antes de guardar):
- "card_payment": pagar la tarjeta de crédito ("pagué 500 mil de la Visa desde Bancolombia"). NO es un gasto: llena "card_payment" {card, account, amount, interest}. "interest" = intereses cobrados si los menciona, si no null. "transactions" vacío.
- "debt_payment": pagar una cuota de un crédito/préstamo de la lista. Llena "debt_payment" {debt, account, amount, mode:"expense"}. Si no dice monto, usa la cuota mensual registrada.
- "add_subscription": "me suscribí a Netflix por 38.900 al mes". Llena "subscription" {name, amount, frequency (monthly|yearly|weekly), next_charge_date (YYYY-MM-DD; si no la dice, la misma fecha del próximo periodo desde hoy), category, payment}.
- "goal_contribution": "ahorré 200 mil para el viaje". Llena "goal_contribution" {goal, amount, account (o null)}.
- "query": preguntas sobre su plata ("¿cuánto he gastado esta semana?", "¿cuánto debo en tarjetas?", "¿cuándo es el corte de la Master?"). Llena "query" {topic, from, to, category, card}:
  topic ∈ spending (gastos) | income (ingresos) | balance (saldos de cuentas) | card_debt (deuda/cupo de tarjetas) | card_dates (fechas de corte/pago) | debts (créditos) | subscriptions | budget (presupuestos/límite) | goals (metas).
  from/to = rango YYYY-MM-DD (por defecto este mes). category/card = alias si pregunta por una en particular, si no null. En "reply" pon solo algo breve como "Déjame revisar…"; NUNCA inventes cifras.
- "unknown": saludo o algo fuera de finanzas → en "reply" explica amable y brevemente qué puedes hacer (registrar gastos e ingresos por voz, pagos de tarjeta, cuotas, suscripciones, ahorros y responder preguntas sobre su plata).

ACLARACIONES:
- Si falta algo imprescindible (monto, o si fue gasto o ingreso), "needs_clarification": true y "question" = pregunta corta y natural en tono colombiano amable (ej. "¿Y cuánto te costaron los clavos?").
- Incluye igual en "transactions" lo que SÍ está completo (ej. la empanada), y pregunta solo por lo que falta.
- La conversación puede tener varios turnos: en cada respuesta devuelve la lista COMPLETA y actualizada de transacciones pendientes de toda la conversación (incluidas las de turnos anteriores), no solo las nuevas.
- Si todo está completo: "needs_clarification": false y "question": null.

"reply": una frase corta, cálida y natural en español colombiano (tutea, sin emojis), que resuma lo entendido. Ej.: "Listo, 62 mil en comida con tu novia." No repitas todos los detalles. NUNCA digas que ya registraste o guardaste algo: el usuario confirma después.

CATEGORÍAS (alias | nombre | tipo):
${cats}

CUENTAS (alias | nombre | tipo):
${accounts}

TARJETAS DE CRÉDITO (alias | nombre | banco | franquicia):
${cards}

CRÉDITOS (alias | nombre | entidad | cuota):
${debts}

SUSCRIPCIONES ACTIVAS:
${subs}

METAS DE AHORRO:
${goals}

Responde ÚNICAMENTE con un objeto JSON con esta forma exacta (usa null en lo que no aplique, arrays vacíos si no hay):
{"intent":"create_transactions|card_payment|debt_payment|add_subscription|goal_contribution|query|unknown","reply":"...","needs_clarification":false,"question":null,
"transactions":[{"type":"expense|income","amount":62000,"date":"YYYY-MM-DD","time":"HH:mm|null","description":"...","category":"c1","category_alternatives":["c7","c10"],"payment":{"kind":"account|card","ref":"a1","inferred":true},"items":[{"name":"...","qty":1,"unit_amount":30000}],"group":"g1","confidence":0.9}],
"card_payment":null,"debt_payment":null,"subscription":null,"goal_contribution":null,"query":null}`;
}

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENTS },
    reply: { type: "string" },
    needs_clarification: { type: "boolean" },
    question: { type: ["string", "null"] },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income"] },
          amount: { type: "integer" },
          date: { type: "string" },
          time: { type: ["string", "null"] },
          description: { type: "string" },
          category: { type: "string" },
          category_alternatives: { type: "array", items: { type: "string" } },
          payment: {
            type: "object",
            properties: { kind: { type: "string", enum: ["account", "card"] }, ref: { type: ["string", "null"] }, inferred: { type: "boolean" } },
            required: ["kind", "ref", "inferred"],
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, qty: { type: "number" }, unit_amount: { type: "integer" } },
              required: ["name", "qty", "unit_amount"],
            },
          },
          group: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["type", "amount", "date", "description", "category", "category_alternatives", "payment", "items", "confidence"],
      },
    },
    card_payment: {
      type: ["object", "null"],
      properties: { card: { type: ["string", "null"] }, account: { type: ["string", "null"] }, amount: { type: ["integer", "null"] }, interest: { type: ["integer", "null"] } },
    },
    debt_payment: {
      type: ["object", "null"],
      properties: { debt: { type: ["string", "null"] }, account: { type: ["string", "null"] }, amount: { type: ["integer", "null"] }, mode: { type: "string" } },
    },
    subscription: {
      type: ["object", "null"],
      properties: {
        name: { type: "string" }, amount: { type: ["integer", "null"] }, frequency: { type: "string" },
        next_charge_date: { type: ["string", "null"] }, category: { type: ["string", "null"] },
        payment: { type: ["object", "null"], properties: { kind: { type: "string" }, ref: { type: ["string", "null"] } } },
      },
    },
    goal_contribution: {
      type: ["object", "null"],
      properties: { goal: { type: ["string", "null"] }, amount: { type: ["integer", "null"] }, account: { type: ["string", "null"] } },
    },
    query: {
      type: ["object", "null"],
      properties: {
        topic: { type: "string" }, from: { type: ["string", "null"] }, to: { type: ["string", "null"] },
        category: { type: ["string", "null"] }, card: { type: ["string", "null"] },
      },
    },
  },
  required: ["intent", "reply", "needs_clarification", "question", "transactions"],
};

// ───────────────────────── validación y normalización ─────────────────────────

export interface ProposalItem { name: string; qty: number; unit_amount: number }
export interface Payment { kind: "account" | "card"; id: string | null; inferred: boolean }
export type Proposal =
  | { kind: "transaction"; type: "expense" | "income"; amount: number; date: string; description: string; category_id: string | null;
      category_alternatives: string[]; payment: Payment; items: ProposalItem[]; group_id: string; confidence: number }
  | { kind: "card_payment"; card_id: string | null; account_id: string | null; amount: number; interest: number | null; date: string }
  | { kind: "debt_payment"; debt_id: string | null; account_id: string | null; amount: number; mode: "expense" | "transfer"; date: string }
  | { kind: "subscription"; name: string; amount: number; frequency: "weekly" | "monthly" | "yearly"; next_charge_date: string;
      category_id: string | null; payment: Payment }
  | { kind: "goal_contribution"; goal_id: string | null; account_id: string | null; amount: number; date: string };

export interface AssistantResult {
  intent: Intent;
  reply: string;
  needs_clarification: boolean;
  question: string | null;
  proposals: Proposal[];
  query: { topic: string; from: string; to: string; category_id: string | null; card_id: string | null } | null;
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown): s is string => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
const toInt = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export function toTimestamp(date: string | undefined | null, time: string | undefined | null, now: Date): string {
  const t = bogota(now);
  const d = isDate(date) && date <= t.date ? date : t.date;
  const hm = isTime(time) ? time : (d === t.date ? t.time : "12:00");
  return `${d}T${hm}:00-05:00`;
}

/** Valida la salida del LLM. Devuelve errores (para reintentar) y el resultado normalizado con ids reales. */
export function validateAndNormalize(raw: any, ctx: Ctx, al: Aliases): { errors: string[]; result: AssistantResult } {
  const errors: string[] = [];
  const now = ctx.now;
  const today = bogota(now).date;
  const resolve = (alias: unknown, prefix: string): string | null => {
    if (typeof alias !== "string") return null;
    const a = alias.trim();
    if (a.startsWith(prefix) && al.toId[a]) return al.toId[a];
    return null;
  };
  const cats = new Map(ctx.categories.map((c) => [c.id, c]));
  const fallbackCat = (kind: "expense" | "income") =>
    ctx.categories.find((c) => c.system_key === (kind === "expense" ? "other_expense" : "other_income"))?.id ?? null;

  if (!raw || typeof raw !== "object") {
    return { errors: ["La respuesta no es un objeto JSON"], result: emptyResult() };
  }
  let intent: Intent = INTENTS.includes(raw.intent) ? raw.intent : "unknown";
  if (!INTENTS.includes(raw.intent)) errors.push(`intent inválido: ${raw.intent}`);
  const reply = typeof raw.reply === "string" && raw.reply.trim() ? raw.reply.trim() : "";
  let needs = raw.needs_clarification === true;
  let question = typeof raw.question === "string" && raw.question.trim() ? raw.question.trim() : null;
  const proposals: Proposal[] = [];
  let query: AssistantResult["query"] = null;

  const payment = (p: any, allowCard: boolean): Payment => {
    if (p && allowCard && p.kind === "card") {
      const id = resolve(p.ref, "t");
      if (id) return { kind: "card", id, inferred: p.inferred === true };
    }
    if (p && p.kind === "account") {
      const id = resolve(p.ref, "a");
      if (id) return { kind: "account", id, inferred: p.inferred === true && id === ctx.defaultAccountId };
    }
    return { kind: "account", id: ctx.defaultAccountId, inferred: true };
  };

  if (intent === "create_transactions") {
    const list = Array.isArray(raw.transactions) ? raw.transactions : [];
    list.forEach((tx: any, i: number) => {
      const type = tx?.type === "income" ? "income" : tx?.type === "expense" ? "expense" : null;
      if (!type) { errors.push(`transactions[${i}].type inválido`); return; }
      const items: ProposalItem[] = (Array.isArray(tx.items) ? tx.items : [])
        .map((it: any) => ({
          name: String(it?.name ?? "").trim().slice(0, 80),
          qty: Number(it?.qty) > 0 ? Math.round(Number(it.qty) * 100) / 100 : 1,
          unit_amount: toInt(it?.unit_amount) ?? 0,
        }))
        .filter((it: ProposalItem) => it.name);
      const itemsTotal = items.reduce((s, it) => s + Math.round(it.qty * it.unit_amount), 0);
      let amount = toInt(tx.amount);
      if (items.length > 1 && items.every((it) => it.unit_amount > 0)) amount = itemsTotal; // el detalle manda
      if (!amount) { errors.push(`transactions[${i}] sin monto válido: no incluyas transacciones sin monto, pregunta`); return; }

      let category_id = resolve(tx.category, "c");
      if (category_id && cats.get(category_id)?.kind !== type) category_id = null;
      if (!category_id) category_id = fallbackCat(type);
      const alternatives = (Array.isArray(tx.category_alternatives) ? tx.category_alternatives : [])
        .map((a: unknown) => resolve(a, "c"))
        .filter((id: string | null): id is string => !!id && id !== category_id && cats.get(id)?.kind === type);
      const description = String(tx.description ?? "").trim().slice(0, 120) || (cats.get(category_id ?? "")?.name ?? "Movimiento");
      proposals.push({
        kind: "transaction",
        type,
        amount,
        date: toTimestamp(tx.date, tx.time, now),
        description: description.charAt(0).toUpperCase() + description.slice(1),
        category_id,
        category_alternatives: [...new Set(alternatives)].slice(0, 2),
        payment: payment(tx.payment, type === "expense"),
        items: items.length === 1 && items[0].qty === 1 ? [] : items, // un solo ítem = la transacción misma
        group_id: "temp-1", // todo lo dicho en la misma conversación comparte grupo
        confidence: Math.max(0, Math.min(1, Number(tx.confidence) || 0.7)),
      });
    });
    if (!proposals.length && !needs) {
      needs = true;
      question = question ?? "¿Me cuentas cuánto fue y en qué?";
    }
  } else if (intent === "card_payment") {
    const cp = raw.card_payment ?? {};
    const card_id = resolve(cp.card, "t") ?? (ctx.cards.length === 1 ? ctx.cards[0].id : null);
    const amount = toInt(cp.amount);
    if (!amount) { needs = true; question = question ?? "¿Cuánto le pagaste a la tarjeta?"; }
    else if (!card_id) { needs = true; question = question ?? "¿A cuál tarjeta le hiciste el pago?"; }
    else proposals.push({ kind: "card_payment", card_id, account_id: resolve(cp.account, "a") ?? ctx.defaultAccountId, amount, interest: toInt(cp.interest), date: toTimestamp(today, null, now) });
  } else if (intent === "debt_payment") {
    const dp = raw.debt_payment ?? {};
    const debt_id = resolve(dp.debt, "d") ?? (ctx.debts.length === 1 ? ctx.debts[0].id : null);
    const amount = toInt(dp.amount) ?? (debt_id ? ctx.debts.find((d) => d.id === debt_id)?.monthly_payment || null : null);
    if (!debt_id) { needs = true; question = question ?? "¿De cuál crédito fue la cuota?"; }
    else if (!amount) { needs = true; question = question ?? "¿Cuánto pagaste de la cuota?"; }
    else proposals.push({ kind: "debt_payment", debt_id, account_id: resolve(dp.account, "a") ?? ctx.defaultAccountId, amount, mode: dp.mode === "transfer" ? "transfer" : "expense", date: toTimestamp(today, null, now) });
  } else if (intent === "add_subscription") {
    const s = raw.subscription ?? {};
    const amount = toInt(s.amount);
    const frequency = ["weekly", "monthly", "yearly"].includes(s.frequency) ? s.frequency : "monthly";
    if (!amount) { needs = true; question = question ?? `¿Cuánto cuesta ${s.name || "la suscripción"}?`; }
    else {
      let cat = resolve(s.category, "c");
      if (!cat || cats.get(cat)?.kind !== "expense") cat = ctx.categories.find((c) => c.system_key === "subscriptions")?.id ?? null;
      proposals.push({
        kind: "subscription", name: String(s.name || "Suscripción").slice(0, 60), amount, frequency,
        next_charge_date: isDate(s.next_charge_date) && s.next_charge_date >= today ? s.next_charge_date : addDays(today, frequency === "weekly" ? 7 : frequency === "yearly" ? 365 : 30),
        category_id: cat, payment: payment(s.payment, true),
      });
    }
  } else if (intent === "goal_contribution") {
    const g = raw.goal_contribution ?? {};
    const goal_id = resolve(g.goal, "g") ?? (ctx.goals.length === 1 ? ctx.goals[0].id : null);
    const amount = toInt(g.amount);
    if (!goal_id) { needs = true; question = question ?? (ctx.goals.length ? "¿Para cuál meta es ese ahorro?" : "Aún no tienes metas de ahorro. Créala en Más → Metas y vuelve a intentarlo."); }
    else if (!amount) { needs = true; question = question ?? "¿Cuánto ahorraste?"; }
    else proposals.push({ kind: "goal_contribution", goal_id, account_id: resolve(g.account, "a"), amount, date: toTimestamp(today, null, now) });
  } else if (intent === "query") {
    const q = raw.query ?? {};
    const topic = (QUERY_TOPICS as readonly string[]).includes(q.topic) ? q.topic : "spending";
    const from = isDate(q.from) ? q.from : `${today.slice(0, 8)}01`;
    const to = isDate(q.to) && q.to >= from ? q.to : today;
    query = { topic, from, to: to > today ? today : to, category_id: resolve(q.category, "c"), card_id: resolve(q.card, "t") };
  }

  if (needs && !question) question = reply || "¿Me das un poco más de detalle?";
  if (!needs) question = null;

  return {
    errors,
    result: { intent, reply: reply || (needs ? question ?? "" : "Listo, revisa y confirma."), needs_clarification: needs, question, proposals, query },
  };
}

function emptyResult(): AssistantResult {
  return { intent: "unknown", reply: "", needs_clarification: false, question: null, proposals: [], query: null };
}

/** Vocabulario para mejorar la transcripción de Whisper. */
export function whisperPrompt(ctx: Ctx): string {
  const names = [
    ...ctx.accounts.map((a) => a.name), ...ctx.cards.map((c) => [c.name, c.bank].filter(Boolean).join(" ")),
    ...ctx.debts.map((d) => d.name), ...ctx.subscriptions.map((s) => s.name),
  ];
  return `Gastos en Colombia. Me gasté 30 lucas, 5 lucas, un palo, 500 mil, 2 gaseosas de 5.000. ` +
    `Nequi, Daviplata, Bancolombia, Davivienda, Visa, Mastercard, efectivo, TransMilenio, Rappi, D1, Ara, Éxito, salchipapa, empanada, arepa, tinto. ` +
    names.join(", ");
}
