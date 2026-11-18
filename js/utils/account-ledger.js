// Extracto de una cuenta: efecto de cada movimiento en el saldo, saldo después de cada uno, resumen del período,
// serie diaria para la gráfica y desglose de a dónde se fue / de dónde vino la plata. Lógica pura (sin DOM ni estado).
// Misma fórmula que la vista account_balances:
//   saldo = saldo inicial + ingresos − (gastos y transferencias que salen) + transferencias que entran

/** Lo que un movimiento le suma (+) o le resta (−) a la cuenta `accountId` */
export function effectOn(t, accountId) {
  const amount = Number(t.amount) || 0;
  let e = 0;
  if (t.account_id === accountId) e += t.type === 'income' ? amount : -amount;
  if (t.to_account_id === accountId && t.type === 'transfer') e += amount;
  return e;
}

/** Del más reciente al más antiguo (igual que la lista de la API) */
export const byNewest = (a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));

/**
 * Recorre los movimientos del más reciente al más antiguo partiendo del saldo actual.
 * txs debe incluir TODOS los movimientos desde el inicio del período en adelante (también los de fechas futuras),
 * porque el saldo actual ya los cuenta.
 * → { rows: [{ tx, effect, after }], startBalance } · after = saldo justo después de ese movimiento
 */
export function ledger(txs, accountId, currentBalance) {
  let bal = Number(currentBalance) || 0;
  const rows = [...txs].sort(byNewest).map((tx) => {
    const effect = effectOn(tx, accountId);
    const row = { tx, effect, after: bal };
    bal -= effect;
    return row;
  });
  return { rows, startBalance: bal };
}

/** Entradas, salidas y neto de unas filas del extracto */
export function summarize(rows) {
  let inflow = 0, outflow = 0, nIn = 0, nOut = 0;
  for (const r of rows) {
    if (r.effect > 0) { inflow += r.effect; nIn++; } else if (r.effect < 0) { outflow -= r.effect; nOut++; }
  }
  return { inflow, outflow, net: inflow - outflow, nIn, nOut };
}

const addDay = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Saldo al cierre de cada día entre `from` y `to` (YYYY-MM-DD, inclusive), más un punto de apertura al inicio.
 * dateOf(tx) → YYYY-MM-DD en la zona de la app. Máximo `maxDays` puntos diarios (se toma el final del rango).
 * → [{ date, balance, opening? }]
 */
export function dailySeries(rows, { from, to, startBalance, dateOf, maxDays = 1100 }) {
  if (!from || !to || from > to) return [{ date: from ?? to, balance: startBalance, opening: true }];
  const byDay = new Map();
  for (const r of rows) {
    const d = dateOf(r.tx);
    byDay.set(d, (byDay.get(d) ?? 0) + r.effect);
  }
  let bal = Number(startBalance) || 0;
  // Movimientos anteriores a `from` (no deberían venir, pero por si acaso) se suman a la apertura
  for (const [d, e] of byDay) if (d < from) bal += e;
  const out = [{ date: from, balance: bal, opening: true }];
  let skipped = 0;
  for (let d = from, i = 0; d <= to && i < 40000; d = addDay(d, 1), i++) {
    bal += byDay.get(d) ?? 0;
    out.push({ date: d, balance: bal });
  }
  // Rangos muy largos: se conserva el final (lo reciente) y la apertura se mueve al primer día que queda
  if (out.length - 1 > maxDays) {
    skipped = out.length - 1 - maxDays;
    const tail = out.slice(1 + skipped);
    return [{ date: tail[0].date, balance: out[skipped].balance, opening: true }, ...tail];
  }
  return out;
}

/**
 * Agrupa entradas (dir='in') o salidas (dir='out') por destino/origen.
 * keyOf(row, dir) → { key, label, icon, color } (lo resuelve la vista con categorías, cuentas y tarjetas)
 * → [{ key, label, icon, color, amount, count, pct }] ordenado de mayor a menor; `top` grupos y el resto en "Otros"
 */
export function breakdown(rows, dir, keyOf, { top = 5 } = {}) {
  const groups = new Map();
  let total = 0;
  for (const r of rows) {
    const v = dir === 'in' ? r.effect : -r.effect;
    if (v <= 0) continue;
    const k = keyOf(r, dir);
    const g = groups.get(k.key) ?? { ...k, amount: 0, count: 0, keys: [k.key] };
    g.amount += v;
    g.count++;
    groups.set(k.key, g);
    total += v;
  }
  let list = [...groups.values()].sort((a, b) => b.amount - a.amount || String(a.label).localeCompare(String(b.label), 'es'));
  if (list.length > top + 1) {
    const rest = list.slice(top);
    list = [...list.slice(0, top), {
      key: 'others', label: 'Otros', icon: 'dots', color: '#9A9A92', amount: rest.reduce((s, g) => s + g.amount, 0),
      count: rest.reduce((s, g) => s + g.count, 0), keys: rest.flatMap((g) => g.keys),
    }];
  }
  return list.map((g) => ({ ...g, pct: total > 0 ? (g.amount * 100) / total : 0 }));
}

/** Variación entre dos saldos en % (null si no se puede calcular con sentido) */
export function changePct(from, to) {
  if (!from || Math.sign(from) !== Math.sign(to || from)) return null;
  return ((to - from) * 100) / Math.abs(from);
}

/** Para "Cuadrar saldo": cuánto cambia el saldo inicial para que el saldo calculado quede en `target` */
export function reconcile(account, target) {
  const delta = Math.round(Number(target) || 0) - Math.round(Number(account.balance) || 0);
  return { delta, initial_balance: Math.round(Number(account.initial_balance) || 0) + delta };
}
