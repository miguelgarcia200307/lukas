// La voz de Lukas en las notificaciones: cada aviso se arma con datos reales (ritmo de gasto, días que quedan,
// cuotas que faltan, rachas sin registrar, quincena, día de la semana…) y se redacta con muchas variantes para que
// nunca suene igual. Sin red ni Deno: funciones puras con un azar con semilla (la misma notificación siempre sale
// igual al reintentar; otra fecha u otra persona, otra frase). Corre también en Node (scripts/tests).

export type Rng = () => number;
export interface Msg { title: string; body: string }
interface Base { rng: Rng; name?: string | null }

// ── Azar con semilla ─────────────────────────────────────
export function seeded(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const firstName = (n?: string | null) => String(n ?? "").trim().split(/\s+/)[0] ?? "";
export const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Vars = Record<string, string | number | null | undefined>;
/** Reemplaza {var}; null si falta alguna (esa variante se descarta). */
export function fill(tpl: string, vars: Vars): string | null {
  let ok = true;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v == null || v === "") { ok = false; return ""; }
    return String(v);
  });
  return ok ? cap(out.replace(/\s+/g, " ").trim()) : null;
}

/** Elige una variante válida (las que usan {name} pesan menos para no sonar empalagoso). */
export function choose(rng: Rng, list: string[], vars: Vars): string {
  const ok = list.map((t) => ({ t, s: fill(t, vars) })).filter((x) => x.s) as { t: string; s: string }[];
  if (!ok.length) return "";
  const w = ok.map((x) => (x.t.includes("{name}") ? 0.5 : 1));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ok.length; i++) { r -= w[i]; if (r <= 0) return ok[i].s; }
  return ok[ok.length - 1].s;
}
const maybe = (rng: Rng, p: number) => rng() < p;
const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" ");

// ── Tarjetas ─────────────────────────────────────────────
export function cardCut(c: Base & { label: string; days: number; debt: number; usagePct?: number | null }): Msg {
  const v: Vars = { label: c.label, debt: money(c.debt), name: firstName(c.name), usage: Math.round(Number(c.usagePct) || 0) };
  const title = choose(c.rng, c.days === 0
    ? ["Hoy es el corte de tu {label}", "✂️ Hoy corta tu {label}", "Día de corte: {label}", "{name}, hoy corta tu {label}"]
    : ["Mañana es el corte de tu {label}", "✂️ Mañana corta tu {label}", "Tu {label} corta mañana", "{name}, mañana corta tu {label}"], v);
  const state = c.debt > 0
    ? choose(c.rng, ["Llevas {debt} en esta tarjeta.", "Vas en {debt} en este extracto.", "Tu deuda va en {debt}."], v)
    : choose(c.rng, ["Esta tarjeta está en ceros. ¡Bien ahí! 👏", "No debes nada en esta tarjeta: así da gusto."], v);
  const usage = Number(c.usagePct) >= 80 ? choose(c.rng, ["Ojo: ya usaste el {usage}% del cupo.", "Vas en el {usage}% del cupo; mejor frenar un poco."], v)
    : Number(c.usagePct) >= 50 && maybe(c.rng, 0.5) ? choose(c.rng, ["Eso es el {usage}% del cupo.", "Ya usaste el {usage}% del cupo."], v) : "";
  const tip = c.days === 0
    ? choose(c.rng, ["Desde mañana, lo que compres pasa al siguiente extracto.", "Hoy se cierra el extracto; mañana empieza uno nuevo.", "Las compras de mañana ya tendrán más tiempo para pagarse."], v)
    : choose(c.rng, ["Si puedes esperar, compra después del corte: tendrás más días para pagar.", "Lo que compres después del corte pasa al siguiente extracto.", "Truco: las compras grandes, mejor justo después del corte."], v);
  return { title, body: join(state, usage, tip) };
}

export function cardDue(c: Base & { label: string; days: number; debt: number; estInterest?: number | null }): Msg {
  const v: Vars = { label: c.label, debt: money(c.debt), name: firstName(c.name), interest: c.estInterest ? money(c.estInterest) : null };
  let title: string, body: string;
  if (c.days === 0) {
    title = choose(c.rng, ["Hoy vence el pago de tu {label}", "🚨 Último día para pagar tu {label}", "Hoy es el día: paga tu {label}", "{name}, hoy vence tu {label}"], v);
    body = choose(c.rng, ["Debes {debt}. Si ya pagaste, regístralo y lo tacho de la lista.", "Son {debt}. Paga hoy y evitas la mora.", "{debt} por pagar hoy. ¡Que no se te pase!"], v);
  } else if (c.days === 1) {
    title = choose(c.rng, ["Mañana vence tu {label}", "⏰ Mañana es el último día para pagar tu {label}", "{name}, mañana vence tu {label}", "Tu {label} vence mañana"], v);
    body = choose(c.rng, ["Deuda actual: {debt}. Págala hoy y te olvidas.", "Son {debt}. Un pago a tiempo te evita intereses de mora.", "Debes {debt}. Si la pagas hoy, mañana no hay afán."], v);
  } else {
    title = choose(c.rng, [`En ${c.days} días vence el pago de tu {label}`, `📅 Tu {label} vence en ${c.days} días`, "Ve separando el pago de tu {label}"], v);
    body = choose(c.rng, [`Deuda actual: {debt}. Con tiempo y sin afanes.`, `Tienes ${c.days} días para pagar {debt}. ¿Lo dejamos listo?`, "Debes {debt}. Pagar antes te quita un pendiente de encima."], v);
  }
  const interest = c.estInterest && c.estInterest > 0 && maybe(c.rng, 0.6)
    ? choose(c.rng, ["Si no la pagas completa, podrías pagar hasta {interest} de intereses.", "Dejarla sin pagar te costaría hasta {interest} de intereses al mes."], v) : "";
  return { title, body: join(body, interest) };
}

// ── Créditos ─────────────────────────────────────────────
export function debtDue(c: Base & { debt: string; days: number; payment: number; balance: number; progressPct?: number | null }): Msg {
  const p = Math.round(Number(c.progressPct) || 0);
  const left = c.payment > 0 ? Math.ceil(c.balance / c.payment) : null;
  const v: Vars = { debt: c.debt, payment: money(c.payment), balance: money(c.balance), p, left, name: firstName(c.name) };
  const title = choose(c.rng, c.days === 0
    ? ["Hoy pagas la cuota de {debt}", "📌 Hoy toca la cuota de {debt}", "{name}, hoy va la cuota de {debt}"]
    : ["Mañana pagas la cuota de {debt}", "📌 Mañana: cuota de {debt}", "Recordatorio: mañana va la cuota de {debt}", "{name}, mañana toca la cuota de {debt}"], v);
  const cuota = choose(c.rng, ["Cuota: {payment}.", "Son {payment}.", "La cuota es de {payment}."], v);
  const progress = left === 1 ? choose(c.rng, ["¡Esta podría ser la última cuota! 🎉", "¡Ya casi! Con esta podrías terminarla 🎉"], v)
    : p >= 90 ? choose(c.rng, ["¡Ya casi la terminas! Vas en el {p}%.", "Vas en el {p}%: la recta final 🏁"], v)
      : p >= 50 ? choose(c.rng, ["Ya pagaste el {p}%. ¡Sigue así!", "Más de la mitad pagada ({p}%) 💪"], v)
        : left && left <= 3 ? choose(c.rng, ["Te quedan unas {left} cuotas.", "Faltan más o menos {left} cuotas."], v)
          : choose(c.rng, ["Saldo pendiente: {balance}.", "Te faltan {balance} por pagar.", "Cada cuota cuenta: quedan {balance}."], v);
  return { title, body: join(cuota, progress) };
}

// ── Suscripciones ────────────────────────────────────────
export function subscriptionSoon(c: Base & { sub: string; amount: number; frequency?: string | null; auto: boolean }): Msg {
  const yearly = c.frequency === "monthly" ? c.amount * 12 : c.frequency === "weekly" ? c.amount * 52 : null;
  const v: Vars = { sub: c.sub, amount: money(c.amount), yearly: yearly ? money(yearly) : null, name: firstName(c.name) };
  const title = choose(c.rng, ["Mañana se cobra {sub}", "🔁 {sub} se cobra mañana", "Mañana sale el pago de {sub}", "{name}, mañana se cobra {sub}"], v);
  const what = choose(c.rng, ["{amount}.", "Son {amount}.", "Serán {amount}."], v);
  const auto = c.auto ? choose(c.rng, ["Lo registro automáticamente.", "Yo lo anoto, no tienes que hacer nada.", "Tranquilo, yo lo registro."], v)
    : choose(c.rng, ["Recuerda registrarlo cuando salga.", "¿Me lo cuentas cuando salga?", "Cuando se cobre, dímelo y lo anoto."], v);
  const extra = yearly && maybe(c.rng, 0.4) ? choose(c.rng, ["Al año son {yearly}.", "Dato: al año suma {yearly}."], v)
    : maybe(c.rng, 0.2) ? "¿La sigues usando? Si no, es buen momento para cancelarla." : "";
  return { title, body: join(what, auto, extra) };
}

export function subscriptionCharged(c: Base & { sub: string; amount: number }): Msg {
  const v: Vars = { sub: c.sub, amount: money(c.amount), name: firstName(c.name) };
  return {
    title: choose(c.rng, ["Registré el cobro de {sub}", "✅ {sub} ya quedó anotado", "Anoté {sub} por ti", "{sub}: cobro registrado"], v),
    body: choose(c.rng, ["{amount} quedó en tus movimientos.", "{amount}, ya en tus movimientos. Uno menos 😉", "Fueron {amount}; no tienes que hacer nada.", "Lo anoté: {amount}. Tus cuentas siguen al día."], v),
  };
}

// ── Resumen semanal ──────────────────────────────────────
export interface WeekData { cur: number; prev: number; count: number; top?: [string, number] | null; busiest?: { weekday: number; amount: number } | null }
export function weekly(c: Base & WeekData): Msg {
  const diff = c.prev > 0 ? Math.round(((c.cur - c.prev) / c.prev) * 100) : null;
  const share = c.top && c.cur > 0 ? Math.round((c.top[1] / c.cur) * 100) : null;
  const v: Vars = {
    cur: money(c.cur), pct: diff == null ? null : Math.abs(diff), name: firstName(c.name), n: c.count,
    cat: c.top?.[0], amt: c.top ? money(c.top[1]) : null, share, avg: money(c.cur / 7),
    day: c.busiest ? WEEKDAYS[c.busiest.weekday] : null, dayAmt: c.busiest ? money(c.busiest.amount) : null,
  };
  if (c.cur <= 0) {
    return {
      title: choose(c.rng, ["Semana sin gastos registrados", "🤔 ¿Una semana sin gastos?", "{name}, esta semana no anotaste gastos"], v),
      body: choose(c.rng, ["Si gastaste algo, cuéntamelo y lo pongo al día.", "¿Ahorro extremo o se te pasó anotar? Cuéntame y lo arreglamos.", "Dime lo que recuerdes de la semana y lo registro."], v),
    };
  }
  let title: string;
  const usedCompare = diff != null && Math.abs(diff) >= 15;
  if (diff != null && diff <= -15) title = choose(c.rng, ["🎉 Gastaste {pct}% menos esta semana", "¡Bien! {pct}% menos que la semana pasada", "Semana más ahorradora: {cur} 💪", "{name}, bajaste tus gastos un {pct}%"], v);
  else if (diff != null && diff >= 15) title = choose(c.rng, ["📈 Tu semana: {cur}, {pct}% más que la anterior", "Ojo: esta semana gastaste {pct}% más", "Semana más cara: {cur}", "{name}, tus gastos subieron un {pct}%"], v);
  else title = choose(c.rng, ["Tu semana: {cur} en gastos", "📊 Resumen de tu semana: {cur}", "Cerraste la semana con {cur} en gastos", "{name}, así te fue: {cur} esta semana"], v);

  // Dos datos, los más útiles primero (y en otro orden según el día)
  const facts: string[] = [];
  if (c.top) facts.push(choose(c.rng, share != null && share >= 40
    ? ["{cat} se llevó el {share}% ({amt}).", "Casi todo fue en {cat}: {amt} ({share}%)."]
    : ["Donde más gastaste: {cat} ({amt}).", "{cat} encabeza la lista con {amt}.", "Tu categoría top: {cat}, {amt}."], v));
  if (!usedCompare && diff != null) facts.push(diff === 0 ? "Igual que la semana pasada." : choose(c.rng, diff > 0 ? ["{pct}% más que la semana pasada."] : ["{pct}% menos que la semana pasada."], v));
  if (c.busiest && c.count >= 3) facts.push(choose(c.rng, ["El {day} fue tu día más movido: {dayAmt}.", "Tu día más caro fue el {day} ({dayAmt})."], v));
  facts.push(choose(c.rng, c.count === 1 ? ["Registraste un solo gasto."] : ["En promedio, {avg} al día.", "Registraste {n} gastos.", "{n} gastos, unos {avg} al día."], v));
  const [first, ...rest] = facts;
  const second = rest.length ? rest[Math.floor(c.rng() * rest.length)] : "";
  return { title, body: join(first, second) };
}

// ── Recordatorio de la noche ─────────────────────────────
export function evening(c: Base & { weekday: number; day: number; lastDay: number; daysSince: number | null }): Msg {
  const v: Vars = { name: firstName(c.name), n: c.daysSince };
  const quincena = c.day === 15 || c.day === c.lastDay || c.day === 30;
  if (c.daysSince != null && c.daysSince >= 3) {
    return {
      title: choose(c.rng, ["Hace {n} días no hablamos 👋", "{name}, ¿me extrañaste?", "¿Todo bien? Llevas {n} días sin anotar"], v),
      body: choose(c.rng, ["Cuéntame lo que recuerdes y en un minuto quedas al día.", "Si fue mucho, dímelo por partes: yo me encargo.", "No importa si no es exacto: dime lo que recuerdes y lo organizo."], v),
    };
  }
  const titles = ["¿Gastaste algo hoy?", "¿Cómo te fue hoy con la plata?", "Antes de dormir: ¿algún gasto? 🌙", "Un minuto para tus cuentas", "¿Hoy fue día de cero gastos?", "{name}, ¿qué gastaste hoy?"];
  const bodies = ["{name}, cuéntamelo en 10 segundos y mantén tus cuentas al día.", "Dímelo por voz y yo lo anoto.", "Si no gastaste nada, ¡felicitaciones! Si sí, cuéntame.", "Hasta el tinto cuenta ☕. Dímelo y lo anoto.", "Los gastos pequeños son los que más se escapan.", "Cuéntamelo como se lo dirías a un amigo; yo lo organizo."];
  let special: Msg | null = null;
  if (quincena) special = {
    title: choose(c.rng, ["¿Llegó la quincena? 💸", "Día de quincena 💸", "{name}, ¿cayó la quincena?"], v),
    body: choose(c.rng, ["Si recibiste plata, cuéntamelo también: llevo ingresos y gastos.", "Buen momento para separar lo de los pagos fijos. ¿Algún gasto hoy?"], v),
  };
  else if (c.weekday === 5) special = {
    title: choose(c.rng, ["¿Viernes de salida? 🍻", "¡Viernes! ¿Qué tal el día?", "Viernes en la noche: ¿algún gasto?"], v),
    body: choose(c.rng, ["Si salió algo, dímelo antes de que se te olvide.", "Disfruta. Y si gastaste, cuéntame en 10 segundos."], v),
  };
  else if (c.weekday === 6 || c.weekday === 0) special = {
    title: choose(c.rng, [c.weekday === 0 ? "Domingo: ¿algún gasto?" : "Sábado: ¿algún gasto?", "¿Qué tal el fin de semana?", "Fin de semana… ¿y de gastos? 😄"], v),
    body: choose(c.rng, ["Mercado, salidas, domicilios… dímelo y lo anoto.", "Si gastaste algo, cuéntame en 10 segundos."], v),
  };
  if (special && maybe(c.rng, 0.65)) return special;
  return { title: choose(c.rng, titles, v), body: choose(c.rng, bodies, v) };
}

// ── Presupuestos ─────────────────────────────────────────
export interface BudgetData { category: string; isTotal: boolean; period: "daily" | "weekly" | "monthly"; amount: number; spent: number; pct: number; periodStart: string; today: string }
const dayMs = 86400000;
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / dayMs);
function periodEnd(b: BudgetData): string {
  if (b.period === "daily") return b.today;
  if (b.period === "weekly") return new Date(Date.parse(`${b.periodStart}T12:00:00Z`) + 6 * dayMs).toISOString().slice(0, 10);
  const d = new Date(`${b.periodStart}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
}

export function budget(c: Base & BudgetData & { level: number | "over" }): Msg {
  const when = c.period === "daily" ? "hoy" : c.period === "weekly" ? "esta semana" : "este mes";
  const scope = c.isTotal ? `tu límite de ${when}` : `tu presupuesto de ${c.category} ${when}`;
  const short = c.isTotal ? `Límite de ${when}` : `${c.category} (${when})`;
  const end = periodEnd(c);
  const daysLeft = Math.max(1, between(c.today, end) + 1);
  const elapsed = Math.max(1, between(c.periodStart, c.today) + 1);
  const total = elapsed + daysLeft - 1;
  const remaining = c.amount - c.spent;
  const projection = c.period !== "daily" && elapsed >= (c.period === "monthly" ? 3 : 2) ? (c.spent / elapsed) * total : null;
  const reset = c.period === "daily" ? "mañana" : c.period === "weekly" ? "el lunes" : "el 1.º del próximo mes";
  const v: Vars = {
    scope, short, name: firstName(c.name), figures: `${money(c.spent)} de ${money(c.amount)}`, pct: Math.floor(c.pct),
    rem: money(remaining), days: daysLeft, perDay: money(remaining / daysLeft), proj: projection ? money(projection) : null,
    over: money(c.spent - c.amount), reset, periodo: c.period === "weekly" ? "la semana" : "el mes", level: c.level === "over" ? null : c.level,
  };
  if (c.level === "over") {
    return {
      title: choose(c.rng, ["Te pasaste de {scope}", "📉 Te excediste {over} en {scope}", "{short}: {over} por encima", "{name}, te pasaste {over} de {scope}"], v),
      body: join(choose(c.rng, ["Llevas {figures}.", "Vas en {figures}."], v),
        choose(c.rng, ["No pasa nada: {reset} arranca de nuevo. Lo importante es saberlo.", "{reset} vuelves a empezar; por ahora, a frenar un poquito.", "Respira: {reset} es borrón y cuenta nueva.", "Lo bueno es que ya lo sabes. {reset} retomamos 💪"], v)),
    };
  }
  if (c.level >= 100) {
    return {
      title: choose(c.rng, ["Llegaste al 100% de {scope}", "🛑 Tope alcanzado: {short}", "{short}: llegaste al límite", "{name}, completaste {scope}"], v),
      body: join(choose(c.rng, ["Llevas {figures}.", "Vas en {figures}."], v),
        choose(c.rng, ["Lo que sigas gastando ya sobrepasa el plan.", "De aquí en adelante, cada peso cuenta doble 😅", "Si puedes, pausa estos gastos hasta {reset}."], v)),
    };
  }
  const title = choose(c.rng, ["Ojo, ya vas en el {pct}% de {scope}", "⚠️ {short} va en {pct}%", "{name}, vas en el {pct}% de {scope}", "Pasaste el {level}% de {scope}"], v);
  const advice: string[] = [];
  if (c.period === "daily") advice.push(choose(c.rng, ["Te quedan {rem} para el resto del día.", "Para lo que queda del día: {rem}."], v));
  else {
    if (daysLeft > 1) advice.push(choose(c.rng, ["Te quedan {rem} para {days} días: unos {perDay} al día.", "Quedan {rem}; si repartes, son {perDay} diarios."], v));
    if (projection && projection > c.amount) advice.push(choose(c.rng, ["A este ritmo cerrarías {periodo} en {proj}.", "Si sigues así, {periodo} terminaría en {proj}."], v));
  }
  return { title, body: join(choose(c.rng, ["Llevas {figures}.", "Vas en {figures}."], v), advice.length ? advice[Math.floor(c.rng() * advice.length)] : "") };
}

// ── Prueba ───────────────────────────────────────────────
export function testPush(c: Base): Msg {
  const v: Vars = { name: firstName(c.name) };
  return {
    title: choose(c.rng, ["¡Las notificaciones funcionan!", "🔔 ¡Probando, probando!", "¡Hola! Aquí Lukas 👋", "{name}, ¡ya te puedo escribir!"], v),
    body: choose(c.rng, ["Así te avisaré de cortes, pagos y presupuestos.", "Te escribiré cuando pase algo importante con tu plata.", "Listo: te aviso de cortes, cuotas, suscripciones y más."], v),
  };
}
