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

test('agrupación e ingresos explícitos', async () => {
  const { buildContext, mergeKey, mergeTransactions, incomeFallback } = await import('../../supabase/functions/_shared/brain.ts');
  const b = buildContext({ name: null, def: 'acc', cats: [['food', 'Comida', 'expense', null, 'food'], ['oi', 'Otros ingresos', 'income', null, 'other_income'], ['tr', 'Transferencias recibidas', 'income', null, 'transfers_in'], ['sal', 'Salario', 'income', null, 'salary']],
    accs: [['acc', 'Efectivo', 'cash']], cards: [], debts: [], subs: [], goals: [], hints: [] }, 'v');
  const tx = (d, a, items = []) => ({ kind: 'transaction', type: 'expense', amount: a, date: '2026-11-11T14:00:00-05:00', description: d, category_id: 'food',
    category_alternatives: [], payment: { kind: 'account', id: 'acc', inferred: true }, items, group_id: 'temp-1', confidence: 0.9 });
  let m = mergeTransactions(tx('Salchipapa', 30000), tx('Hamburguesa', 22000));
  m = mergeTransactions(m, tx('Gaseosas', 10000, [{ name: 'Gaseosa', qty: 2, unit_amount: 5000 }]));
  assert.equal(m.amount, 62000);
  assert.equal(m.items.length, 3);
  assert.equal(mergeKey(tx('a', 1)), mergeKey(tx('b', 2)));
  const now = new Date('2026-11-11T19:30:00Z');
  assert.equal(incomeFallback('Me entraron $50000', [50000], b, now)?.category_id, 'oi');
  assert.equal(incomeFallback('Me consignaron $120000', [120000], b, now)?.category_id, 'tr');
  assert.equal(incomeFallback('Recibí $45000', [45000], b, now)?.type, 'income');
  assert.equal(incomeFallback('Me pagaron la quincena, $1200000', [1200000], b, now)?.category_id, 'sal');
  assert.equal(incomeFallback('Pagué $25000', [25000], b, now), null);
});

test('fusión estricta y montos faltantes', async () => {
  const { buildContext, canMerge, validateLine, pendingFromQuestion, askedItem, recordReply, amountQuestion } = await import('../../supabase/functions/_shared/brain.ts');
  const b = buildContext({ name: null, def: 'acc', cats: [['groc', 'Mercado', 'expense', null, 'groceries'], ['home', 'Hogar', 'expense', null, 'home'],
    ['health', 'Salud', 'expense', null, 'health'], ['oth', 'Otros', 'expense', null, 'other_expense']],
  accs: [['acc', 'Efectivo', 'cash']], cards: [], debts: [], subs: [], goals: [], hints: [] }, 'v');
  const now = new Date('2026-11-11T19:30:00Z');
  const o = { now, said: [5000, 4000, 7000], strictAmounts: false };
  const v = (x) => validateLine(JSON.stringify(x), b, o, () => true);
  const groc = v({ k: 'g', a: 16000, d: 'Supermercado', c: 'c1', l: 'supermercado', it: [['Cereal', 1, 5000], ['Leche', 1, 4000], ['Huevos', 1, 7000]] }).proposal;
  const foco = v({ k: 'g', d: 'Foco', c: 'c2', l: 'ferretería', q: '¿Cuánto te costó el foco?' }).proposal;
  assert.equal(groc.amount, 16000);
  assert.equal(foco.pending, true);
  assert.equal(foco.amount, 0);
  assert.equal(foco.question, '¿Cuánto te costó el foco?');
  // categorías distintas o una pendiente: nunca se fusionan
  assert.equal(canMerge(groc, foco, true), false);
  assert.equal(canMerge(groc, { ...groc, category_id: 'home' }, true), false);
  // misma categoría: solo si es el mismo lugar (seguidas: un lugar omitido cuenta como el mismo evento)
  assert.equal(canMerge(groc, { ...groc, place: 'D1' }), false);
  assert.equal(canMerge(groc, { ...groc, place: undefined }, true), true);
  assert.equal(canMerge(groc, { ...groc, place: undefined }, false), false);
  assert.equal(canMerge(groc, { ...groc, place: 'el supermercado' }), true);
  // ítem sin precio dentro de una línea con precios → propuesta pendiente aparte
  const mixed = v({ k: 'g', a: 9000, c: 'c1', it: [['Leche', 1, 4000], ['Pan', 1, 5000], ['Foco', 1, 0]] });
  assert.equal(mixed.proposal.amount, 9000);
  assert.equal(mixed.proposal.items.length, 2);
  assert.equal(mixed.extra.length, 1);
  assert.equal(mixed.extra[0].pending, true);
  // pregunta suelta → pendiente con categoría según la frase
  assert.equal(askedItem('¿Cuánto te costó el foco?'), 'foco');
  assert.equal(askedItem('¿Y cuánto te costaron las pastillas?'), 'pastillas');
  assert.equal(askedItem('¿Fue un gasto o un ingreso?'), null);
  const text = 'Fui al supermercado, compré un cereal de $5000. De camino a casa pasé por una ferretería y compré un foco para mi cuarto.';
  const pend = pendingFromQuestion('¿Cuánto te costó el foco?', text, b, now);
  assert.equal(pend.category_id, 'home');
  assert.equal(pend.pending, true);
  assert.equal(pendingFromQuestion('¿Cuánto te costaron las pastillas?', 'luego en la droguería compré unas pastillas', b, now).category_id, 'health');
  // resumen hablado
  assert.equal(recordReply([groc, foco], b, 'x'), 'Son dos gastos: 16 mil en mercado, y ¿cuánto te costó el foco?');
  assert.equal(amountQuestion('Pastillas'), '¿Cuánto te costaron las pastillas?');
});

test('respuestas cortas sin LLM', async () => {
  const { quickIntent } = await import('../../supabase/functions/_shared/quick.ts');
  const both = ['amount', 'confirm'], conf = ['confirm'];
  for (const t of ['sí', 'Sí.', 'dale', 'listo', 'guárdalo', 'sí, guárdalos', 'de una', 'ok listo', 'Sí, por favor', 'perfecto, guárdalo']) assert.equal(quickIntent(t, conf)?.intent, 'confirm', t);
  for (const t of ['no', 'No.', 'espera', 'mejor no', 'no, espera', 'todavía no']) assert.equal(quickIntent(t, conf)?.intent, 'stop', t);
  for (const t of ['cancela', 'cancélalo', 'no, cancela todo', 'olvídalo']) assert.equal(quickIntent(t, conf)?.intent, 'cancel', t);
  assert.deepEqual(quickIntent('8 mil', both), { intent: 'amount', amount: 8000 });
  assert.deepEqual(quickIntent('ocho lucas', both), { intent: 'amount', amount: 8000 });
  assert.deepEqual(quickIntent('sí, me costó 12.500', both), { intent: 'amount', amount: 12500 });
  assert.equal(quickIntent('8 mil', conf), null); // sin monto pendiente, un número va al LLM
  assert.equal(quickIntent('sí', []), null); // sin tarjetas, nada se resuelve en código
  assert.equal(quickIntent('el foco 8 mil y los clavos 5 mil', both), null); // dos montos: LLM
  assert.equal(quickIntent('almorcé por 18 lucas con la Visa en el centro comercial ayer', both), null);
  assert.equal(quickIntent('sí pero cámbialo a hogar', conf), null);
});
