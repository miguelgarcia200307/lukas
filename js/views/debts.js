// Créditos / obligaciones: saldo pendiente, cuota, próxima fecha y pagos
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number } from '../utils/format.js';
import { inDays, daysBetween, todayISO, dateShort, inputParts, toTimestamp } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe } from '../state.js';
import { createDebt, updateDebt, deleteDebt, payDebt, debtPayments } from '../api/debts.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar, progressBar, segmented, selectSegment } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { openSheet } from '../ui/sheet.js';
import { bindAmountInput } from '../ui/number-input.js';
import { toast } from '../ui/toast.js';
import { runSave } from '../ui/submit.js';

export const title = 'Créditos';

function openDebtForm(d = null) {
  formSheet({
    title: d ? 'Editar crédito' : 'Nuevo crédito',
    fields: [
      { name: 'name', label: 'Nombre', value: d?.name, required: true, placeholder: 'Ej. Crédito del carro' },
      { name: 'lender', label: 'Entidad', value: d?.lender, placeholder: 'Ej. Davivienda' },
      { name: 'original_amount', label: 'Monto original', type: 'amount', value: d?.original_amount },
      { name: 'starting_balance', label: 'Saldo pendiente hoy', type: 'amount', value: d?.starting_balance, required: true, hint: 'Cada pago que registres lo descuenta.' },
      { name: 'monthly_payment', label: 'Cuota mensual', type: 'amount', value: d?.monthly_payment, required: true },
      { name: 'due_day', label: 'Día de pago', type: 'day', value: d?.due_day },
      { name: 'end_date', label: 'Fecha fin estimada', type: 'date', value: d?.end_date ?? '' },
      ...(d ? [{ name: 'archived', label: 'Archivar', type: 'switch', value: d.archived }] : []),
    ],
    onSubmit: async (v) => {
      const row = { ...v, lender: v.lender || null, end_date: v.end_date || null, original_amount: v.original_amount || v.starting_balance };
      if (d) await updateDebt(d.id, row); else await createDebt(row);
      toast(d ? 'Crédito actualizado' : 'Crédito agregado');
    },
    onDelete: d ? async () => { await deleteDebt(d.id); toast('Crédito eliminado'); } : null,
    deleteConfirm: { title: '¿Eliminar este crédito?', message: 'Se borra su historial de pagos. Los movimientos registrados se conservan.' },
  });
}

async function openDebtDetail(d) {
  let mode = 'expense';
  const now = inputParts();
  const s = openSheet({
    title: d.name,
    body: html`<div class="debt-hero"><span class="eyebrow">Saldo pendiente</span><b class="num">${money(d.balance)}</b>
        ${progressBar(Number(d.progress_pct), { color: '#12875A' })}<span class="muted small">${number(d.progress_pct)}% pagado · cuota ${money(d.monthly_payment)}</span></div>
      <div class="section-title mt-6 mb-2">Registrar pago</div>
      <label class="amount-input"><span class="cur">$</span><input name="amount" value="${number(d.monthly_payment)}" aria-label="Monto"></label>
      <div class="field"><label>Desde la cuenta</label><select class="input" name="account">${state.accounts.filter((a) => !a.archived).map((a) => html`<option value="${a.id}" ${a.id === state.profile?.default_account_id ? 'selected' : ''}>${a.name}</option>`)}</select></div>
      <div class="field"><span class="label">¿Cómo lo registro?</span>${segmented('mode', [{ value: 'expense', label: 'Como gasto' }, { value: 'transfer', label: 'Como transferencia' }], mode)}
        <span class="field-hint">Gasto: cuenta en “Gastos financieros”. Transferencia: solo mueve plata, no aparece en gastos.</span></div>
      <div class="field"><label>Fecha</label><input class="input" type="date" name="date" value="${now.date}"></div>
      <div class="section-title mt-8 mb-2">Pagos anteriores</div><div class="dp-list"><div class="sk" style="height:64px;border-radius:16px"></div></div>
      <button class="btn btn-ghost btn-block mt-6" data-edit>${icon('edit')}Editar crédito</button>`,
    footer: html`<button class="btn btn-primary btn-block" data-pay><span class="btn-label">Registrar pago</span><span class="spinner"></span></button>`,
  });
  const amt = bindAmountInput(s.body.querySelector('[name="amount"]'));
  on(s.body, 'click', '[data-seg] button', (e, b) => { mode = selectSegment(b.parentElement, b.dataset.value); haptic.select(); });
  s.body.querySelector('[data-edit]').addEventListener('click', () => { s.close(); openDebtForm(d); });
  s.foot.querySelector('[data-pay]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!amt.value) { toast('Escribe el monto', { type: 'err' }); return; }
    const r = await runSave(() => payDebt({ debtId: d.id, amount: amt.value, accountId: s.body.querySelector('[name="account"]').value, mode,
      date: toTimestamp(s.body.querySelector('[name="date"]').value, now.time) }), { button: btn });
    if (r.ok) { haptic.success(); toast(`Pago de ${money(amt.value)} registrado`); s.close(); }
  });
  try {
    const pays = await debtPayments(d.id);
    s.body.querySelector('.dp-list').innerHTML = String(pays.length ? html`<div class="list">${pays.map((p) => html`<div class="list-row">
      <span class="cat-icon" style="--c:#12875A">${icon('check', { size: 20 })}</span>
      <div class="grow"><div class="row-title">${dateShort(p.paid_at)}</div><div class="row-sub">${p.mode === 'expense' ? 'Como gasto' : 'Transferencia'}</div></div>
      <div class="row-amount">${money(p.amount)}</div></div>`)}</div>` : html`<p class="muted small">Aún no hay pagos registrados.</p>`);
  } catch { s.body.querySelector('.dp-list').innerHTML = ''; }
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Créditos', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nuevo crédito">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="debts-body"></div></div></div>`);
  const body = screen.querySelector('.debts-body');
  const render = () => {
    const list = state.debts.filter((d) => !d.archived);
    if (!list.length) {
      body.innerHTML = String(emptyState({ illus: 'wallet', title: 'Sin créditos registrados', text: 'Agrega tus préstamos para ver cuánto te falta y recibir aviso de cada cuota.', action: { label: 'Agregar crédito', attrs: 'data-new' } }));
      return;
    }
    const total = list.reduce((s, d) => s + Number(d.balance), 0);
    const monthly = list.reduce((s, d) => s + Number(d.monthly_payment), 0);
    body.innerHTML = String(html`
      <div class="totals-strip"><div><span class="eyebrow">Saldo total</span><b class="num">${money(total)}</b></div>
        <div><span class="eyebrow">Cuotas al mes</span><b class="num">${money(monthly)}</b></div></div>
      <div class="stack gap-3 stagger">${list.map((d, i) => {
        const days = d.next_due_date ? daysBetween(todayISO(), d.next_due_date) : null;
        return html`<button class="card card-pad debt-card pressable" data-id="${d.id}" style="--i:${i}">
          <div class="row between"><div class="stack"><span class="row-title">${d.name}</span><span class="row-sub">${d.lender ?? ''}</span></div>
            ${days != null ? html`<span class="tag ${days <= 1 ? 'warn' : ''}">${inDays(days)}</span>` : ''}</div>
          <div class="row between mt-4"><b class="num debt-bal">${money(d.balance)}</b><span class="muted small">Cuota ${money(d.monthly_payment)}</span></div>
          <div class="mt-2">${progressBar(Number(d.progress_pct), { color: '#12875A' })}</div>
          <div class="row-sub mt-2">${number(d.progress_pct)}% pagado${d.end_date ? ` · termina ${dateShort(d.end_date)}` : ''}</div>
        </button>`;
      })}</div>`);
  };
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openDebtForm()),
    on(screen, 'click', '[data-id]', (e, b) => openDebtDetail(state.debts.find((d) => d.id === b.dataset.id))),
    subscribe('debts', render),
  ];
  render();
  refresh('debts');
  return () => offs.forEach((f) => f());
}
