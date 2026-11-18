// Extracto de cuenta: efecto de cada movimiento, saldo después de cada uno, resumen, serie diaria y desglose. Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectOn, ledger, summarize, dailySeries, breakdown, changePct, reconcile } from '../../js/utils/account-ledger.js';

const A = 'nequi';
// Saldo inicial $1.000.000. Movimientos (del más antiguo al más reciente):
const TXS = [
  { id: 't1', type: 'income', amount: 2500000, account_id: A, occurred_at: '2026-11-01T09:00:00-05:00', category_id: 'sueldo' },
  { id: 't2', type: 'expense', amount: 80000, account_id: A, occurred_at: '2026-11-02T13:00:00-05:00', category_id: 'mercado' },
  { id: 't3', type: 'transfer', amount: 500000, account_id: A, to_account_id: 'ahorros', occurred_at: '2026-11-03T10:00:00-05:00' },
  { id: 't4', type: 'transfer', amount: 120000, account_id: 'bancolombia', to_account_id: A, occurred_at: '2026-11-03T18:00:00-05:00' },
  { id: 't5', type: 'transfer', amount: 300000, account_id: A, to_card_id: 'nu', occurred_at: '2026-11-05T08:00:00-05:00' },
  { id: 't6', type: 'expense', amount: 45000, account_id: A, occurred_at: '2026-11-05T20:00:00-05:00', category_id: 'mercado' },
  { id: 't7', type: 'expense', amount: 999, card_id: 'nu', occurred_at: '2026-11-05T21:00:00-05:00' }, // no toca la cuenta
];
// Saldo actual = 1.000.000 + 2.500.000 − 80.000 − 500.000 + 120.000 − 300.000 − 45.000 = 2.695.000
const CURRENT = 2695000;
const dateOf = (t) => t.occurred_at.slice(0, 10);

test('efecto de cada tipo de movimiento sobre la cuenta (igual que account_balances)', () => {
  assert.deepEqual(TXS.map((t) => effectOn(t, A)), [2500000, -80000, -500000, 120000, -300000, -45000, 0]);
  assert.equal(effectOn({ type: 'transfer', amount: 10, account_id: A, to_account_id: A }, A), 0, 'transferencia a sí misma no cambia el saldo');
  assert.equal(effectOn({ type: 'expense', amount: '1500', account_id: A }, A), -1500, 'monto como texto (bigint de Postgres)');
});

test('saldo después de cada movimiento, del más reciente al más antiguo, hasta el saldo inicial', () => {
  const shuffled = [TXS[3], TXS[0], TXS[5], TXS[1], TXS[4], TXS[2], TXS[6]];
  const { rows, startBalance } = ledger(shuffled, A, CURRENT);
  assert.deepEqual(rows.map((r) => r.tx.id), ['t7', 't6', 't5', 't4', 't3', 't2', 't1']);
  assert.deepEqual(rows.map((r) => r.after), [2695000, 2695000, 2740000, 3040000, 2920000, 3420000, 3500000]);
  assert.equal(startBalance, 1000000, 'termina en el saldo inicial');
});

test('resumen: entró, salió y neto', () => {
  const { rows } = ledger(TXS, A, CURRENT);
  assert.deepEqual(summarize(rows), { inflow: 2620000, outflow: 925000, net: 1695000, nIn: 2, nOut: 4 });
  assert.equal(summarize(rows).net, CURRENT - 1000000);
});

test('serie diaria: apertura + saldo al cierre de cada día, días sin movimientos repiten el saldo', () => {
  const { rows, startBalance } = ledger(TXS, A, CURRENT);
  const s = dailySeries(rows, { from: '2026-11-01', to: '2026-11-06', startBalance, dateOf });
  assert.deepEqual(s.map((p) => p.balance), [1000000, 3500000, 3420000, 3040000, 3040000, 2695000, 2695000]);
  assert.equal(s[0].opening, true);
  assert.equal(s.at(-1).balance, CURRENT, 'el último punto es el saldo actual');
});

test('serie diaria: rango muy largo conserva lo reciente y una apertura coherente', () => {
  const { rows, startBalance } = ledger(TXS, A, CURRENT);
  const s = dailySeries(rows, { from: '2026-11-01', to: '2026-11-06', startBalance, dateOf, maxDays: 3 });
  assert.equal(s.length, 4);
  assert.deepEqual(s.map((p) => p.date), ['2026-11-04', '2026-11-04', '2026-11-05', '2026-11-06']);
  assert.equal(s[0].balance, 3040000, 'apertura = cierre del día anterior al primero que se muestra');
  assert.equal(s.at(-1).balance, CURRENT);
});

test('desglose: a dónde se fue y de dónde vino, con porcentajes', () => {
  const { rows } = ledger(TXS, A, CURRENT);
  const keyOf = (r) => {
    const t = r.tx;
    if (t.type === 'transfer') return t.to_card_id ? { key: `card:${t.to_card_id}`, label: 'Pago Nu' } : t.to_account_id === A ? { key: `from:${t.account_id}`, label: 'Desde Bancolombia' } : { key: `to:${t.to_account_id}`, label: 'A Ahorros' };
    return { key: `cat:${t.category_id}`, label: t.category_id };
  };
  const out = breakdown(rows, 'out', keyOf);
  assert.deepEqual(out.map((g) => [g.key, g.amount, g.count]), [['to:ahorros', 500000, 1], ['card:nu', 300000, 1], ['cat:mercado', 125000, 2]]);
  assert.equal(Math.round(out.reduce((s, g) => s + g.pct, 0)), 100);
  const inn = breakdown(rows, 'in', keyOf);
  assert.deepEqual(inn.map((g) => g.key), ['cat:sueldo', 'from:bancolombia']);
});

test('desglose: más de `top` grupos se resumen en "Otros" con sus claves', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ tx: { id: `x${i}` }, effect: -(100 - i) }));
  const g = breakdown(rows, 'out', (r) => ({ key: r.tx.id, label: r.tx.id }), { top: 3 });
  assert.equal(g.length, 4);
  assert.equal(g[3].key, 'others');
  assert.deepEqual(g[3].keys, ['x3', 'x4', 'x5', 'x6', 'x7']);
  assert.equal(g[3].amount, 97 + 96 + 95 + 94 + 93);
});

test('variación porcentual y cuadre de saldo', () => {
  assert.equal(changePct(1000000, 1100000), 10);
  assert.equal(changePct(0, 500), null);
  assert.equal(changePct(-1000, 500), null, 'cruza de negativo a positivo: no tiene sentido como %');
  assert.deepEqual(reconcile({ balance: 2695000, initial_balance: 1000000 }, 2700000), { delta: 5000, initial_balance: 1005000 });
  assert.deepEqual(reconcile({ balance: '2695000', initial_balance: '1000000' }, 2690000), { delta: -5000, initial_balance: 995000 });
});
