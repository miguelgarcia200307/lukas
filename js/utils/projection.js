// Proyección del mes (lógica pura, sin DOM). En vez de "lo gastado ÷ días × días del mes", separa:
//   1. lo que ya gastaste (real),
//   2. el gasto del día a día que falta: tu ritmo histórico (8 semanas antes del mes) mezclado con el ritmo
//      de este mes y ajustado por día de la semana; las compras atípicamente grandes se recortan,
//   3. suscripciones que se cobran antes de fin de mes,
//   4. pagos que haces cada mes (arriendo, servicios…) y que este mes aún no aparecen.
// Con lo mismo estima los ingresos que suelen llegar (sueldo, quincenas) y el ahorro proyectado.
import { addDays, addMonths, startOfMonth, bogota, daysBetween } from './dates.js';

const HIST_DAYS = 56;      // historial base: 8 semanas antes del mes
const CUR_WEIGHT = 14;     // con 14 días del mes el ritmo actual pesa lo mismo que el historial
const SHRINK = 3;          // días "neutros" que suavizan el factor de cada día de la semana

const MONTHS = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|jun|jul|ago|sep|sept|oct|nov|dic)\b/g;
const FILLER = /\b(pago|pague|pagar|abono|de|del|la|el|los|las|mes|mensual)\b/g;
/** Clave para agrupar pagos repetidos: sin tildes, signos, números ni meses ("Arriendo octubre" = "arriendo") */
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\d+/g, ' ').replace(MONTHS, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return 0; const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const range = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
const lastDayOfMonth = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** "Arriendo octubre 2026" → "Arriendo" (para mostrar) */
const cleanName = (s) => s.replace(new RegExp(MONTHS.source, 'gi'), ' ').replace(/\b\d{4}\b/g, ' ').replace(/\s+/g, ' ').trim() || s.trim();

/** Movimientos que se repiten cada mes en los 3 meses anteriores (misma descripción, 1–2 veces por mes, ≥ 2 meses) */
export function recurringGroups(list, monthStart, minAmount = 0) {
  const prevStart = addMonths(monthStart, -3);
  const groups = new Map();
  for (const t of list) {
    if (!t.key || t.d < prevStart || t.d >= monthStart) continue;
    if (!groups.has(t.key)) groups.set(t.key, []);
    groups.get(t.key).push(t);
  }
  const out = [];
  for (const [key, ts] of groups) {
    const perMonth = new Map();
    ts.forEach((t) => perMonth.set(t.d.slice(0, 7), (perMonth.get(t.d.slice(0, 7)) ?? 0) + 1));
    if (perMonth.size < 2 || Math.max(...perMonth.values()) > 2) continue; // más de 2 veces al mes = día a día
    const amount = Math.round(median(ts.map((t) => t.amount)));
    if (amount < minAmount) continue;
    out.push({ key, name: cleanName(ts.at(-1).description), amount, times: Math.round(median([...perMonth.values()])),
      day: Math.round(median(ts.map((t) => Number(t.d.slice(8))))), months: perMonth.size });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * today, from, to: YYYY-MM-DD (from–to = el mes en curso). txs: ingresos y gastos desde 3 meses antes del mes
 * hasta hoy ({ type, amount, occurred_at, description, source, subscription_id }). subscriptions: state.subscriptions.
 */
export function projectMonth({ today, from, to, txs, subscriptions = [] }) {
  const rows = txs.filter((t) => t.type === 'expense' || t.type === 'income')
    .map((t) => ({ ...t, amount: Number(t.amount) || 0, d: bogota(t.occurred_at).date, key: norm(t.description) }))
    .filter((t) => t.d <= today);
  const isSub = (t) => t.source === 'subscription' || !!t.subscription_id;
  const exp = rows.filter((t) => t.type === 'expense');
  const inc = rows.filter((t) => t.type === 'income');
  const inMonth = (t) => t.d >= from && t.d <= today;

  // Historial: 8 semanas antes del mes (o desde tu primer movimiento si llevas menos)
  const firstD = rows.reduce((m, t) => (t.d < m ? t.d : m), today);
  const histEnd = addDays(from, -1);
  const histStart = [addDays(from, -HIST_DAYS), firstD].sort().at(-1);
  const histDays = histStart <= histEnd ? range(histStart, histEnd) : [];
  const inHist = (t) => t.d >= histStart && t.d <= histEnd;

  // Pagos mensuales grandes (más de 2 días típicos de gasto) se proyectan aparte
  const subKeys = new Set(subscriptions.filter((s) => s.active !== false).map((s) => norm(s.name)));
  const base0 = histDays.length ? sum(exp.filter((t) => inHist(t) && !isSub(t)).map((t) => t.amount)) / histDays.length : 0;
  const recurring = recurringGroups(exp.filter((t) => !isSub(t)), from, 2 * base0).filter((g) => !subKeys.has(g.key));
  const recKeys = new Set(recurring.map((g) => g.key));
  const variable = exp.filter((t) => !isSub(t) && !recKeys.has(t.key));

  // Compras atípicas (por encima del percentil 97 del historial) cuentan solo hasta ese tope
  const histAmounts = variable.filter(inHist).map((t) => t.amount);
  const cap = histAmounts.length >= 20 ? quantile(histAmounts, 0.97) : Infinity;
  const byDay = new Map();
  variable.forEach((t) => byDay.set(t.d, (byDay.get(t.d) ?? 0) + Math.min(t.amount, cap)));
  const histTotals = histDays.map((d) => byDay.get(d) ?? 0);
  const base = mean(histTotals);
  const factors = Array.from({ length: 7 }, (_, w) => {
    const vals = histDays.filter((d) => weekday(d) === w).map((d) => byDay.get(d) ?? 0);
    if (!base || !vals.length) return 1;
    return (vals.length * (mean(vals) / base) + SHRINK) / (vals.length + SHRINK);
  });

  // Ritmo de este mes (días completos) mezclado con el historial
  // Días completos del mes desde que usas la app (antes de tu primer movimiento no cuentan como $0)
  const curStart = firstD > from ? firstD : from;
  const doneDays = today > curStart ? range(curStart, addDays(today, -1)) : [];
  const curTotals = doneDays.map((d) => byDay.get(d) ?? 0);
  const pace = mean(curTotals);
  const alpha = histDays.length >= 7 ? doneDays.length / (doneDays.length + CUR_WEIGHT) : doneDays.length ? 1 : 0;
  const perDay = Math.max(0, (1 - alpha) * base + alpha * pace);

  const restDays = range(today, to);
  const todayVariable = variable.filter((t) => t.d === today).reduce((s, t) => s + t.amount, 0);
  const expectedOn = (d) => perDay * factors[weekday(d)];
  const dailyRest = restDays.map((d) => (d === today ? Math.max(0, expectedOn(d) - todayVariable) : expectedOn(d)));
  const variableRemaining = Math.round(sum(dailyRest));

  // Suscripciones que se cobran desde hoy hasta fin de mes (cobrar adelanta next_charge_date, así que ≥ hoy = pendiente)
  const scheduled = [];
  for (const s of subscriptions) {
    if (s.active === false || !s.next_charge_date) continue;
    let d = s.next_charge_date;
    for (let i = 0; i < 40 && d <= to; i++) {
      if (d >= today) scheduled.push({ name: s.name, amount: Number(s.amount) || 0, date: d });
      d = s.frequency === 'weekly' ? addDays(d, 7) : s.frequency === 'yearly' ? addMonths(d, 12) : addMonths(d, 1);
    }
  }
  scheduled.sort((a, b) => a.date.localeCompare(b.date));

  // Pagos de cada mes que aún no aparecen este mes
  const lastDay = lastDayOfMonth(from);
  const pendingOf = (groups, list) => groups.flatMap((g) => {
    const seen = list.filter((t) => t.key === g.key && inMonth(t)).length;
    const left = Math.max(0, g.times - seen);
    if (!left) return [];
    const date = `${from.slice(0, 8)}${String(Math.min(g.day, lastDay)).padStart(2, '0')}`;
    return [{ name: g.name, amount: g.amount * left, times: left, day: g.day, date: date < today ? today : date, late: date < today }];
  });
  const pending = pendingOf(recurring, exp);

  const spent = sum(exp.filter(inMonth).map((t) => t.amount));
  const scheduledTotal = sum(scheduled.map((s) => s.amount));
  const pendingTotal = sum(pending.map((p) => p.amount));
  const total = Math.round(spent + variableRemaining + scheduledTotal + pendingTotal);

  // Rango ≈ ±1 desviación del gasto diario acumulada en los días que faltan
  const spread = (histDays.length >= 7 ? sd(histTotals) : sd(curTotals)) * Math.sqrt(restDays.length);
  const floor = spent + scheduledTotal + pendingTotal;
  // Redondeado a miles: es un rango, no una cifra exacta
  const low = Math.max(Math.floor(Math.max(floor, total - spread) / 1000) * 1000, Math.min(floor, total));
  const high = Math.max(Math.ceil((total + spread) / 1000) * 1000, total);

  // Ingresos: lo que ya entró + lo que suele llegar y aún no llega (sueldo, quincena…)
  const incomeSoFar = sum(inc.filter(inMonth).map((t) => t.amount));
  const incomePending = pendingOf(recurringGroups(inc, from), inc);
  const incomeTotal = incomeSoFar + sum(incomePending.map((p) => p.amount));
  const savingsRate = incomeTotal > 0 ? Math.round(((incomeTotal - total) / incomeTotal) * 100) : null;

  // Curva acumulada proyectada (desde hoy hasta fin de mes)
  const extra = new Map();
  [...scheduled, ...pending].forEach((x) => extra.set(x.date, (extra.get(x.date) ?? 0) + x.amount));
  let acc = spent;
  const curve = restDays.map((d, i) => ({ d, value: Math.round((acc += dailyRest[i] + (extra.get(d) ?? 0))) }));

  const histN = histDays.length;
  const confidence = histN >= 42 ? 'alta' : histN >= 14 || doneDays.length >= 10 ? 'media' : 'baja';
  return {
    total, low, high, spent, perDay: Math.round(perDay), restDays: restDays.length, variableRemaining,
    scheduled, scheduledTotal, pending, pendingTotal, base: Math.round(base), pace: Math.round(pace), alpha,
    histDays: histN, confidence, curve,
    income: { soFar: incomeSoFar, pending: incomePending, total: incomeTotal }, savingsRate,
    // Método anterior (lineal), solo como referencia en pruebas
    linear: Math.round((spent / (daysBetween(from, today) + 1)) * (daysBetween(from, to) + 1)),
  };
}
