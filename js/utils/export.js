// Exportar datos a CSV / JSON (descarga local)
import { sb } from '../supabase.js';
import { state, categoryById, accountById, cardById } from '../state.js';
import { bogota } from './dates.js';
import { AppError } from '../api/base.js';

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function fetchAll(table, select = '*', order = 'created_at') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).order(order, { ascending: true }).range(from, from + 999);
    if (error) throw new AppError('No se pudieron exportar los datos.', error);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const TYPE = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' };

/** CSV de movimientos (opcionalmente filtrado por rango YYYY-MM-DD) */
export async function exportTransactionsCSV({ from, to } = {}) {
  let rows = await fetchAll('transactions', '*, transaction_items(name, qty, unit_amount)', 'occurred_at');
  if (from) rows = rows.filter((t) => bogota(new Date(t.occurred_at)).date >= from && bogota(new Date(t.occurred_at)).date <= to);
  const header = ['Fecha', 'Hora', 'Tipo', 'Monto', 'Descripción', 'Categoría', 'Cuenta', 'Tarjeta', 'Notas', 'Origen', 'Detalle'];
  const lines = rows.map((t) => {
    const b = bogota(new Date(t.occurred_at));
    const cat = categoryById(t.category_id);
    const parent = cat?.parent_id ? categoryById(cat.parent_id)?.name + ' / ' : '';
    return [b.date, b.time, TYPE[t.type], t.type === 'expense' ? -t.amount : t.amount, t.description, cat ? parent + cat.name : '',
      accountById(t.account_id)?.name ?? '', cardById(t.card_id ?? t.to_card_id)?.name ?? '', t.notes ?? '', t.source,
      (t.transaction_items ?? []).map((i) => `${i.name} ${i.qty}x${i.unit_amount}`).join(' | ')].map(csvCell).join(',');
  });
  download(`lukas-movimientos-${bogota().date}.csv`, '﻿' + [header.join(','), ...lines].join('\n'), 'text/csv;charset=utf-8');
  return rows.length;
}

/** Respaldo completo en JSON */
export async function exportAllJSON() {
  const tables = ['categories', 'accounts', 'credit_cards', 'card_movements', 'transactions', 'transaction_items', 'debts', 'debt_payments',
    'subscriptions', 'budgets', 'savings_goals', 'goal_contributions'];
  const data = {};
  for (const t of tables) data[t] = await fetchAll(t);
  data.profile = state.profile;
  download(`lukas-respaldo-${bogota().date}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2), 'application/json');
}

/** CSV genérico (para reportes) */
export function downloadCSV(name, header, rows) {
  download(name, '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
}
