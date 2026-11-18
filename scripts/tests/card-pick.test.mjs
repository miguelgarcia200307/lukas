// Tarjetas: fechas de corte/pago, "¿con cuál pago hoy?", próximo pago, tono de uso, simulador del mínimo,
// y el asistente (apodos + consulta mejor_tarjeta). Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pick from '../../js/utils/card-pick.js';
import * as pickServer from '../../supabase/functions/_shared/card-pick.ts';
import { buildContext, validateLine, queryReply } from '../../supabase/functions/_shared/brain.ts';
import * as voice from '../../supabase/functions/_shared/lukas-voice.ts';

const TODAY = '2026-11-18';
// Datos de ejemplo: deuda total $2.955.000 y cupo total $10.400.000
const CARDS = [
  { id: 'fal', name: 'CMR Falabella', bank: 'Banco Falabella', credit_limit: 1900000, debt: 540000, available: 1360000, cut_day: 30, due_day: 15, next_due_date: '2026-12-15' },
  { id: 'rap', name: 'RappiCard', bank: 'Rappi Bank', credit_limit: 2500000, debt: 1517000, available: 983000, cut_day: 5, due_day: 25, next_due_date: '2026-11-25' },
  { id: 'bco', name: 'Visa Bancolombia', bank: 'Bancolombia', credit_limit: 3000000, debt: 400000, available: 2600000, cut_day: 15, due_day: 2, next_due_date: '2026-12-02' },
  { id: 'dav', name: 'Davivienda Visa', bank: 'Davivienda', credit_limit: 1500000, debt: 298000, available: 1202000, cut_day: 20, due_day: 5, next_due_date: '2026-12-05' },
  { id: 'nu', name: 'Nu', bank: 'Nu', credit_limit: 1500000, debt: 200000, available: 1300000, cut_day: 10, due_day: 20, next_due_date: '2026-11-20' },
];

test('las dos copias de la lógica (app y asistente) son idénticas', () => {
  const js = fs.readFileSync('js/utils/card-pick.js', 'utf8');
  const ts = fs.readFileSync('supabase/functions/_shared/card-pick.ts', 'utf8');
  assert.equal(ts.split('\n').slice(1).join('\n'), js);
  assert.deepEqual(pickServer.bestCardToday(CARDS, TODAY)?.card.id, pick.bestCardToday(CARDS, TODAY)?.card.id);
});

test('los datos de ejemplo suman deuda $2.955.000 y cupo $10.400.000', () => {
  assert.equal(CARDS.reduce((s, c) => s + c.debt, 0), 2955000);
  assert.equal(CARDS.reduce((s, c) => s + c.credit_limit, 0), 10400000);
});

test('fechas: día de corte en meses cortos y cruce de año', () => {
  assert.equal(pick.nextOnOrAfter(30, '2026-11-18'), '2026-11-30');
  assert.equal(pick.nextOnOrAfter(31, '2026-02-10'), '2026-02-28');
  assert.equal(pick.nextOnOrAfter(5, '2026-12-20'), '2027-01-05');
  assert.equal(pick.nextOnOrAfter(18, '2026-11-18'), '2026-11-18');
  assert.equal(pick.nextAfter(18, '2026-11-18'), '2026-12-18');
  assert.equal(pick.lastBefore(18, '2026-11-18'), '2026-10-18');
  assert.equal(pick.lastBefore(10, '2026-11-18'), '2026-11-10');
});

test('ventana de compra: Falabella corta el 30 nov y se paga el 15 dic', () => {
  const w = pick.purchaseWindow(CARDS[0], TODAY);
  assert.deepEqual([w.cutDate, w.payDate, w.daysToPay], ['2026-11-30', '2026-12-15', 27]);
});

test('"¿con cuál pago hoy?" elige la que acaba de cortar y da más días', () => {
  const b = pick.bestCardToday(CARDS, TODAY);
  // Bancolombia cortó el 15 nov: lo de hoy entra al corte del 15 dic y se paga el 2 ene (45 días)
  assert.equal(b.card.id, 'bco');
  assert.equal(b.payDate, '2027-01-02');
  assert.equal(b.daysToPay, 45);
  assert.equal(b.daysSinceCut, 3);
});

test('"¿con cuál pago hoy?" descarta las que no tienen cupo o están sobre el 90 %', () => {
  const full = CARDS.map((c) => (c.id === 'bco' ? { ...c, debt: 2900000, available: 100000 } : c));
  assert.notEqual(pick.bestCardToday(full, TODAY).card.id, 'bco');
  assert.equal(pick.bestCardToday([{ ...CARDS[0], available: 0 }], TODAY), null);
  assert.equal(pick.bestCardToday([], TODAY), null);
});

test('próximo pago: la fecha más cercana con deuda y su tono', () => {
  const n = pick.nextPayment(CARDS, TODAY);
  assert.equal(n.card.id, 'nu');
  assert.equal(n.days, 2);
  assert.equal(n.tone, 'warn');
  assert.equal(pick.nextPayment([CARDS[0]], TODAY).tone, 'ok');
  assert.equal(pick.nextPayment([{ ...CARDS[0], next_due_date: TODAY }], TODAY).tone, 'danger');
  assert.equal(pick.nextPayment([{ ...CARDS[0], debt: 0 }], TODAY), null);
});

test('tono de uso: verde < 30 %, amarillo 30–70 %, rojo > 70 %', () => {
  assert.deepEqual([0, 29.9, 30, 70, 70.1, 100].map(pick.usageTone), ['ok', 'ok', 'mid', 'mid', 'high', 'high']);
});

test('pago mínimo: el configurado o un estimado razonable', () => {
  assert.equal(pick.minimumPayment({ debt: 540000, min_payment: 54000 }), 54000);
  assert.equal(pick.minimumPayment({ debt: 540000, monthly_rate: 2 }), 30000); // 10.800 de intereses + 16.200 (3 %) < mínimo de $30.000
  assert.equal(pick.minimumPayment({ debt: 2000000, monthly_rate: 2 }), 100000);
  assert.equal(pick.minimumPayment({ debt: 0 }), 0);
  assert.equal(pick.minimumPayment({ debt: 20000, monthly_rate: 2 }), 20400); // nunca más que la deuda + intereses
});

test('simulador: pagar solo el mínimo cuesta intereses; un mínimo menor que los intereses nunca termina', () => {
  const s = pick.simulateMinimum({ debt: 1517000, rate: 2.2 });
  assert.ok(s.months > 12 && s.totalInterest > 100000 && !s.never, JSON.stringify(s));
  assert.equal(s.totalPaid, 1517000 + s.totalInterest);
  assert.equal(pick.simulateMinimum({ debt: 1000000, rate: 3, minPayment: 20000 }).never, true);
  assert.deepEqual(pick.simulateMinimum({ debt: 0, rate: 2 }), { months: 0, totalInterest: 0, totalPaid: 0, never: false });
});

// ── Asistente ───────────────────────────────────────────
const raw = {
  name: 'Miguel', def: 'acc', cats: [['c1', 'Comida', 'expense', null, null]], accs: [['acc', 'Efectivo', 'cash']],
  cards: [['fal', 'CMR Falabella', 'Banco Falabella', 'mastercard', '6013', 'Mercado'], ['rap', 'RappiCard', 'Rappi Bank', 'visa', null]],
  debts: [], subs: [], goals: [], hints: [],
};

test('el contexto del asistente incluye el apodo de la tarjeta', () => {
  const b = buildContext(raw, 'v');
  assert.match(b.block, /apodo "Mercado"/);
  assert.equal(b.cards[0].nickname, 'Mercado');
  assert.equal(b.cards[1].nickname, null);
  assert.match(b.whisper, /Mercado/);
});

test('"¿con cuál tarjeta pago hoy?" es la consulta card_best y responde con la mejor', () => {
  const b = buildContext(raw, 'v');
  const r = validateLine('{"k":"q","m":"mejor_tarjeta"}', b, { now: new Date('2026-11-18T15:00:00Z'), said: [], strictAmounts: false }, () => true);
  assert.equal(r.type, 'query');
  assert.equal(r.query.metric, 'card_best');
  const rows = CARDS.map((c) => [c.name, c.bank, c.debt, c.available, c.credit_limit, null, c.next_due_date, c.id === 'bco' ? 'Viajes' : null, c.cut_day, c.due_day, 0]);
  const text = queryReply(r.query, { rows, to: TODAY }, b);
  assert.match(text, /^Usa la Visa Bancolombia, tu tarjeta Viajes: cortó hace 3 días/);
  assert.match(text, /sábado 2 de enero, en 45 días/);
  assert.match(text, /\$2\.600\.000 de cupo/);
  assert.match(queryReply(r.query, { rows: [], to: TODAY }, b), /no tienes tarjetas/i);
});

test('recordatorio de corte con días configurables', () => {
  const rng = () => 0.3;
  const m = voice.cardCut({ rng, name: 'Miguel', label: 'CMR Falabella', days: 5, debt: 540000, usagePct: 28 });
  assert.match(m.title, /5 días/);
  assert.ok(!/undefined|NaN|\{/.test(m.title + m.body), m.title + m.body);
});
