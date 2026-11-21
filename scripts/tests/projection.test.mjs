// Proyección del mes: día a día por día de la semana, compras atípicas, suscripciones, pagos mensuales, ingresos
// esperados y comparación con el método lineal anterior. Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMonth, norm, recurringGroups } from '../../js/utils/projection.js';
import { addDays } from '../../js/utils/dates.js';

const at = (d, h = 12) => `${d}T${String(h).padStart(2, '0')}:00:00-05:00`;
const wd = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const weekend = (d) => wd(d) === 0 || wd(d) === 6;
const TODAY = '2026-11-21'; // sábado
const FROM = '2026-11-01';
const TO = '2026-11-30';

/** Historia de agosto a hoy: entre semana $30.000, fines de semana $80.000; arriendo y sueldo cada mes */
function build({ rentDay = 5, tv = true, todaySoFar = 20000 } = {}) {
  const txs = [];
  let id = 0;
  const push = (t) => txs.push({ id: `t${++id}`, source: 'manual', ...t });
  for (let d = '2026-08-01'; d < TODAY; d = addDays(d, 1)) {
    push({ type: 'expense', amount: weekend(d) ? 50000 : 18000, occurred_at: at(d, 13), description: weekend(d) ? 'Salida' : 'Almuerzo' });
    push({ type: 'expense', amount: weekend(d) ? 30000 : 12000, occurred_at: at(d, 18), description: 'Transporte' });
  }
  push({ type: 'expense', amount: todaySoFar, occurred_at: at(TODAY, 9), description: 'Desayuno' });
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    const rd = `${m}-${String(rentDay).padStart(2, '0')}`;
    if (rd < TODAY) push({ type: 'expense', amount: 1200000, occurred_at: at(rd, 8), description: `Arriendo ${['agosto', 'septiembre', 'octubre', 'noviembre'][Number(m.slice(5)) - 8]}` });
    if (`${m}-15` < TODAY) push({ type: 'expense', amount: 45000, occurred_at: at(`${m}-15`), description: 'Netflix', source: 'subscription', subscription_id: 'netflix' });
    if (m !== '2026-11') push({ type: 'income', amount: 3000000, occurred_at: at(`${m}-30`, 7), description: 'Sueldo' });
  }
  push({ type: 'income', amount: 400000, occurred_at: at('2026-11-10'), description: 'Venta bicicleta' });
  if (tv) push({ type: 'expense', amount: 2500000, occurred_at: at('2026-11-02', 16), description: 'Televisor' });
  return txs;
}
const SUBS = [{ id: 'netflix', name: 'Netflix', amount: 45000, frequency: 'monthly', next_charge_date: '2026-12-15', active: true },
  { id: 'gym', name: 'Gimnasio', amount: 90000, frequency: 'monthly', next_charge_date: '2026-11-25', active: true },
  { id: 'old', name: 'Inactiva', amount: 999999, frequency: 'monthly', next_charge_date: '2026-11-26', active: false }];

/** Lo que de verdad falta: resto de hoy + días por venir según el patrón, + gimnasio */
function ideal(txs, extra = 0) {
  const spent = txs.filter((t) => t.type === 'expense' && t.occurred_at.slice(0, 10) >= FROM).reduce((s, t) => s + t.amount, 0);
  let rest = 80000 - 20000; // hoy es sábado: típico $80.000 y ya van $20.000
  for (let d = addDays(TODAY, 1); d <= TO; d = addDays(d, 1)) rest += weekend(d) ? 80000 : 30000;
  return spent + rest + 90000 + extra;
}

test('agrupa pagos repetidos sin importar mes, tildes o "pago"', () => {
  assert.equal(norm('Arriendo Octubre 2026'), 'arriendo');
  assert.equal(norm('Pagó el arriendo del mes'), 'arriendo');
  assert.equal(norm('Cafetería'), 'cafeteria');
  const g = recurringGroups(build().filter((t) => t.type === 'expense').map((t) => ({ ...t, d: t.occurred_at.slice(0, 10), key: norm(t.description) })), FROM, 100000);
  assert.deepEqual(g.map((x) => [x.key, x.amount, x.day]), [['arriendo', 1200000, 5]]);
});

test('compra grande al inicio del mes: la proyección no se dispara (el método lineal sí)', () => {
  const txs = build();
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs, subscriptions: SUBS });
  const want = ideal(txs);
  assert.ok(Math.abs(p.total - want) / want < 0.03, `proyección ${p.total} vs real esperado ${want}`);
  assert.ok(p.linear > want * 1.05, `el lineal sobreestima: ${p.linear}`);
  assert.ok(p.low <= want && want <= p.high, `rango ${p.low}–${p.high} contiene ${want}`);
  assert.equal(p.confidence, 'alta');
  assert.deepEqual(p.scheduled.map((s) => [s.name, s.date]), [['Gimnasio', '2026-11-25']], 'solo suscripciones activas que faltan este mes');
  assert.equal(p.pending.length, 0, 'el arriendo de noviembre ya se pagó');
});

test('día de la semana: el fin de semana pesa más que entre semana', () => {
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs: build({ tv: false }), subscriptions: [] });
  const sat = p.curve[1].value - p.curve[0].value; // domingo 22
  const mon = p.curve[2].value - p.curve[1].value; // lunes 23
  assert.ok(sat > mon * 2, `domingo ${sat} vs lunes ${mon}`);
});

test('el arriendo que aún no se paga este mes entra a la proyección', () => {
  const txs = build({ rentDay: 25 });
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs, subscriptions: SUBS });
  assert.deepEqual(p.pending.map((x) => [x.name, x.amount, x.date]), [['Arriendo', 1200000, '2026-11-25']]);
  const want = ideal(txs, 1200000);
  assert.ok(Math.abs(p.total - want) / want < 0.03, `proyección ${p.total} vs ${want}`);
});

test('ingresos: suma el sueldo que aún no llega y calcula el ahorro proyectado', () => {
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs: build(), subscriptions: SUBS });
  assert.equal(p.income.soFar, 400000);
  assert.deepEqual(p.income.pending.map((x) => [x.name, x.amount, x.date]), [['Sueldo', 3000000, '2026-11-30']]);
  assert.equal(p.income.total, 3400000);
  assert.equal(p.savingsRate, Math.round(((3400000 - p.total) / 3400000) * 100));
});

test('usuario nuevo sin historial: usa el ritmo del mes y avisa confianza baja', () => {
  const txs = build().filter((t) => t.occurred_at.slice(0, 10) >= '2026-11-15');
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs, subscriptions: [] });
  assert.equal(p.histDays, 0);
  assert.equal(p.confidence, 'baja');
  assert.ok(p.total >= p.spent && Number.isFinite(p.total));
  const first = projectMonth({ today: FROM, from: FROM, to: TO, txs: [], subscriptions: [] });
  assert.equal(first.total, 0);
  assert.equal(first.curve.length, 30);
});

test('suscripción semanal: cuenta cada cobro que cae antes de fin de mes', () => {
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs: [], subscriptions: [{ name: 'Lavandería', amount: 20000, frequency: 'weekly', next_charge_date: '2026-11-21', active: true }] });
  assert.deepEqual(p.scheduled.map((s) => s.date), ['2026-11-21', '2026-11-28']);
  assert.equal(p.total, 40000);
});

test('la curva termina exactamente en el total', () => {
  const p = projectMonth({ today: TODAY, from: FROM, to: TO, txs: build({ rentDay: 25 }), subscriptions: SUBS });
  assert.equal(p.curve.at(-1).d, TO);
  assert.ok(Math.abs(p.curve.at(-1).value - p.total) <= 1);
});
