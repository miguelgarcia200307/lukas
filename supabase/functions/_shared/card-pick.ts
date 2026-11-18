// @ts-nocheck — copia exacta de js/utils/card-pick.js (la usa el asistente; scripts/tests/card-pick.test.mjs exige que sean iguales)
// Lógica pura de tarjetas (sin DOM ni red): fechas de corte/pago, "¿con cuál pago hoy?", próximo pago,
// tono de uso y simulador de pago mínimo. Hay una copia idéntica para el asistente en
// supabase/functions/_shared/card-pick.ts (scripts/tests/card-pick.test.mjs comprueba que den lo mismo).
// Fechas en ISO 'YYYY-MM-DD' (día de Bogotá).

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { y, m: m - 1, d }; };
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isoOf = (y, m, d) => { const t = new Date(Date.UTC(y, m, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, daysIn(t.getUTCFullYear(), t.getUTCMonth())))}`; };
export const diffDays = (a, b) => Math.round((Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`)) / DAY);

/** Próxima fecha con ese día del mes en o después de `from` (si el mes es corto, el último día) */
export function nextOnOrAfter(day, from) {
  const { y, m } = parts(from);
  const here = isoOf(y, m, day);
  return diffDays(from, here) >= 0 ? here : isoOf(y, m + 1, day);
}
/** Próxima fecha con ese día del mes estrictamente después de `from` */
export function nextAfter(day, from) {
  const { y, m } = parts(from);
  const here = isoOf(y, m, day);
  return diffDays(from, here) > 0 ? here : isoOf(y, m + 1, day);
}
/** Último corte estrictamente antes de `from` */
export function lastBefore(day, from) {
  const { y, m } = parts(from);
  const here = isoOf(y, m, day);
  return diffDays(here, from) > 0 ? here : isoOf(y, m - 1, day);
}

/** Verde < 30 %, amarillo 30–70 %, rojo > 70 % */
export function usageTone(pct) {
  const p = Number(pct) || 0;
  return p > 70 ? 'high' : p >= 30 ? 'mid' : 'ok';
}

const num = (v) => Number(v) || 0;
const debtOf = (c) => Math.max(0, num(c.debt));
const usageOf = (c) => (num(c.credit_limit) > 0 ? (debtOf(c) * 100) / num(c.credit_limit) : 0);

/**
 * Lo que compres hoy con esta tarjeta entra al próximo corte (incluido el de hoy) y se paga en la primera fecha de
 * pago después de ese corte. → { cutDate, payDate, daysToPay, daysSinceCut }
 */
export function purchaseWindow(card, today) {
  const cutDate = nextOnOrAfter(num(card.cut_day), today);
  const payDate = nextAfter(num(card.due_day), cutDate);
  const prevCut = lastBefore(num(card.cut_day), today);
  return { cutDate, payDate, daysToPay: diffDays(today, payDate), daysSinceCut: diffDays(prevCut, today) };
}

/**
 * "¿Con cuál pago hoy?": la tarjeta que da más días para pagar (la que acaba de cortar), castigando el uso alto y el
 * disponible bajo. Descarta las que no tienen cupo, están sobre el 90 % o no tienen días de corte/pago.
 * → { card, cutDate, payDate, daysToPay, daysSinceCut, usage } | null
 */
export function bestCardToday(cards, today) {
  let best = null;
  for (const c of cards ?? []) {
    if (c.archived || !num(c.cut_day) || !num(c.due_day) || num(c.credit_limit) <= 0) continue;
    const usage = usageOf(c);
    if (num(c.available) <= 0 || usage >= 90) continue;
    const w = purchaseWindow(c, today);
    const lowAvail = num(c.available) < num(c.credit_limit) * 0.1;
    const score = w.daysToPay - (usage > 70 ? 15 : usage > 50 ? 5 : 0) - (lowAvail ? 10 : 0);
    if (!best || score > best.score || (score === best.score && usage < best.usage)) best = { card: c, ...w, usage, score };
  }
  if (!best) return null;
  const { score, ...out } = best; // eslint-disable-line no-unused-vars
  return out;
}

/** Próximo pago entre las tarjetas con deuda → { card, date, days, amount, tone: 'ok'|'warn'|'danger' } | null */
export function nextPayment(cards, today) {
  let best = null;
  for (const c of cards ?? []) {
    if (c.archived || debtOf(c) <= 0 || !c.next_due_date) continue;
    const days = diffDays(today, c.next_due_date);
    if (!best || days < best.days || (days === best.days && debtOf(c) > best.amount)) best = { card: c, date: String(c.next_due_date).slice(0, 10), days, amount: debtOf(c) };
  }
  if (!best) return null;
  return { ...best, tone: best.days <= 0 ? 'danger' : best.days <= 5 ? 'warn' : 'ok' };
}

/** Pago mínimo: el configurado o un estimado (intereses del mes + 3 % del saldo, mínimo $30.000) */
export function minimumPayment(card) {
  const debt = debtOf(card);
  if (!debt) return 0;
  if (card.min_payment != null && num(card.min_payment) > 0) return Math.min(debt, num(card.min_payment));
  const interest = Math.round((debt * num(card.monthly_rate)) / 100);
  return Math.min(debt + interest, Math.max(30000, interest + Math.round(debt * 0.03)));
}

/**
 * Simula pagar solo el mínimo cada mes con la tasa mensual (%). minPayment fijo, o null para recalcular el estimado
 * mes a mes. → { months, totalInterest, totalPaid, never } (never = el mínimo no alcanza ni para los intereses)
 */
export function simulateMinimum({ debt, rate, minPayment = null, maxMonths = 600 }) {
  let bal = Math.max(0, Math.round(num(debt)));
  const r = num(rate) / 100;
  let months = 0, interest = 0, paid = 0;
  while (bal > 0 && months < maxMonths) {
    const i = Math.round(bal * r);
    const due = bal + i;
    const pay = Math.min(due, minPayment != null && num(minPayment) > 0 ? num(minPayment) : Math.max(30000, i + Math.round(bal * 0.03)));
    if (pay <= i && pay < due) return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, never: true };
    interest += i; paid += pay; bal = due - pay; months++;
  }
  return { months, totalInterest: interest, totalPaid: paid, never: bal > 0 };
}
