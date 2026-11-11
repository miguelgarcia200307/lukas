// Pruebas unitarias de la normalización de montos y fechas. Uso: node --test scripts/ai-eval/
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, amountSupported } from '../../supabase/functions/_shared/normalize.ts';
import { resolveWhen } from '../../supabase/functions/_shared/brain.ts';

const cases = [
  ['Me gasté 30 lucas en el almuerzo', 'Me gasté $30000 en el almuerzo', [30000]],
  ['una empanada de 5 lucas', 'una empanada de $5000', [5000]],
  ['Me cobraron una luca por la bolsa', 'Me cobraron $1000 por la bolsa', [1000]],
  ['Pagué luca y media por un tinto', 'Pagué $1500 por un tinto', [1500]],
  ['Me gasté un palo en un celular', 'Me gasté $1000000 en un celular', [1000000]],
  ['Le pagué medio palo al mecánico', 'Le pagué $500000 al mecánico', [500000]],
  ['me pagaron dos palos y medio', 'me pagaron $2500000', [2500000]],
  ['palo y medio de arriendo', '$1500000 de arriendo', [1500000]],
  ['Tanqueé 80 barras', 'Tanqueé $80000', [80000]],
  ['Compré unos tenis de 180k', 'Compré unos tenis de $180000', [180000]],
  ['me gasté 30K', 'me gasté $30000', [30000]],
  ['Pagué mil quinientos de parqueadero', 'Pagué $1500 de parqueadero', [1500]],
  ['veinte mil quinientos por el almuerzo', '$20500 por el almuerzo', [20500]],
  ['Pagué el arriendo, un millón doscientos', 'Pagué el arriendo, $1200000', [1200000]],
  ['un millón doscientos mil', '$1200000', [1200000]],
  ['dos millones trescientos mil pesos', '$2300000', [2300000]],
  ['1,5 millones', '$1500000', [1500000]],
  ['me gasté 30.000 en una salchipapa', 'me gasté $30000 en una salchipapa', [30000]],
  ['dos gaseosas de 5.000 cada una', '2 gaseosas de $5000 cada una', [5000]],
  ['30 mil pesos por una venta', '$30000 por una venta', [30000]],
  ['treinta y cinco mil', '$35000', [35000]],
  ['Pagué el taxi, 30, no, 35 mil', 'Pagué el taxi, 30, no, $35000', [35000]],
  ['Pagué el taxi, treinta, no, treinta y cinco mil.', 'Pagué el taxi, 30, no, $35000.', [35000]],
  ['arroz por cuatro mil doscientos, dos litros de leche a tres mil ochocientos cada uno y huevos por catorce mil',
    'arroz por $4200, 2 litros de leche a $3800 cada uno y huevos por $14000', [4200, 3800, 14000]],
  ['500 mil de la Visa', '$500000 de la Visa', [500000]],
  ['quinientos mil de la Visa', '$500000 de la Visa', [500000]],
  ['cien mil', '$100000', [100000]],
  ['ciento veinte mil', '$120000', [120000]],
  ['20 mil 500', '$20500', [20500]],
  ['un tinto y una arepa', 'un tinto y una arepa', []],
  ['mil gracias', 'mil gracias', []],
  ['compré 2 barras de chocolate de 3 mil', 'compré 2 barras de chocolate de $3000', [3000]],
  ['medio millón', '$500000', [500000]],
  ['un millón', '$1000000', [1000000]],
  ['$45.000', '$45000', [45000]],
  ['1.200.000', '$1200000', [1200000]],
  ['me gasté como, eh, 15 mil en un almuerzo', 'me gasté como, eh, $15000 en un almuerzo', [15000]],
  ['hace tres días', 'hace 3 días', []],
  ['dieciocho lucas', '$18000', [18000]],
  ['veintidós mil', '$22000', [22000]],
  ['2 palos', '$2000000', [2000000]],
];

for (const [input, text, amounts] of cases) {
  test(`normaliza: ${input}`, () => {
    const r = normalizeText(input);
    assert.equal(r.text, text);
    assert.deepEqual(r.amounts, amounts);
  });
}

test('amountSupported', () => {
  assert.ok(amountSupported(62000, [30000, 22000, 2, 5000], 62000));
  assert.ok(amountSupported(10000, [2, 5000]));
  assert.ok(amountSupported(173000, [98000, 75000]));
  assert.ok(amountSupported(35000, [30, 35000]));
  assert.ok(!amountSupported(40000, [35000, 30]));
  assert.ok(!amountSupported(5000, []));
});

test('resolveWhen', () => {
  const now = new Date('2026-11-11T19:30:00Z'); // miércoles 14:30 en Bogotá
  assert.deepEqual(resolveWhen(null, now), { date: '2026-11-11', time: null });
  assert.deepEqual(resolveWhen('ayer', now), { date: '2026-11-10', time: null });
  assert.deepEqual(resolveWhen('anoche', now), { date: '2026-11-10', time: '21:00' });
  assert.deepEqual(resolveWhen('antier', now), { date: '2026-11-09', time: null });
  assert.deepEqual(resolveWhen('anteayer', now), { date: '2026-11-09', time: null });
  assert.deepEqual(resolveWhen('el sábado', now), { date: '2026-11-07', time: null });
  assert.deepEqual(resolveWhen('el miércoles', now), { date: '2026-11-04', time: null });
  assert.deepEqual(resolveWhen('la semana pasada', now), { date: '2026-11-04', time: null });
  assert.deepEqual(resolveWhen('hace 3 días', now), { date: '2026-11-08', time: null });
  assert.deepEqual(resolveWhen('el 5 de noviembre', now), { date: '2026-11-05', time: null });
  assert.deepEqual(resolveWhen('el 20', now), { date: '2026-10-20', time: null });
  assert.deepEqual(resolveWhen('esta mañana', now), { date: '2026-11-11', time: '09:00' });
  assert.deepEqual(resolveWhen('2026-11-01', now), { date: '2026-11-01', time: null });
  assert.deepEqual(resolveWhen('mañana', now), { date: '2026-11-11', time: null });
});
