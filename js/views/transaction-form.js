// Crear / editar un movimiento a mano (sheet). Funciona offline para creaciones (cola IndexedDB).
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { number, parseAmount, money } from '../utils/format.js';
import { inputParts, toTimestamp } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, categoryById } from '../state.js';
import { from, unwrap } from '../api/base.js';
import { createTransactions, updateTransaction, deleteTransactions, restoreTransactions } from '../api/transactions.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { runSave } from '../ui/submit.js';
import { confirmDialog } from '../ui/modal.js';
import { segmented, selectSegment, catIcon } from '../ui/common.js';
import { pickCategory, pickPayment, paymentChip } from '../ui/pickers.js';
import { autosizeAmount } from '../ui/number-input.js';

export async function openTransactionDetail(id) {
  try {
    const tx = unwrap(await from('transactions').select('*, transaction_items(id, name, qty, unit_amount, sort_order)').eq('id', id).single());
    openTransactionForm({ tx });
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

const defaultAccount = () => state.profile?.default_account_id ?? state.accounts.find((a) => !a.archived)?.id ?? null;

/** Borra con opción de deshacer */
export async function deleteWithUndo(txs) {
  await deleteTransactions(txs.map((t) => t.id));
  haptic.warning();
  toast(txs.length === 1 ? 'Movimiento eliminado' : `${txs.length} movimientos eliminados`, {
    action: { label: 'Deshacer', fn: async () => { await restoreTransactions(txs); toast('Restaurado', { type: 'info' }); } },
  });
}

export function openTransactionForm({ tx = null, type = 'expense' } = {}) {
  const editing = !!tx;
  const linked = tx && (tx.debt_id || tx.goal_id || tx.to_card_id || tx.subscription_id);
  const m = {
    type: tx?.type ?? type,
    amount: Number(tx?.amount ?? 0),
    description: tx?.description ?? '',
    category_id: tx?.category_id ?? null,
    payment: tx?.card_id ? { kind: 'card', id: tx.card_id } : { kind: 'account', id: tx?.account_id ?? defaultAccount() },
    to_account_id: tx?.to_account_id ?? null,
    notes: tx?.notes ?? '',
    items: (tx?.transaction_items ?? []).sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ name: i.name, qty: Number(i.qty), unit_amount: Number(i.unit_amount) })),
    ...inputParts(tx?.occurred_at ?? new Date()),
  };

  const catBtn = () => {
    const c = categoryById(m.category_id);
    return html`${catIcon(c)}<span class="grow ellipsis">${c?.name ?? 'Elegir categoría'}</span>${icon('chevron-right', { size: 18 })}`;
  };
  const itemsHtml = () => html`${m.items.map((it, i) => html`<div class="item-row" data-item="${i}">
      <input class="input" data-it="name" value="${it.name}" placeholder="Ítem" aria-label="Nombre del ítem">
      <input class="input qty" data-it="qty" value="${number(it.qty)}" inputmode="decimal" aria-label="Cantidad">
      <input class="input" data-it="unit_amount" value="${it.unit_amount ? number(it.unit_amount) : ''}" inputmode="numeric" placeholder="$" aria-label="Precio unitario">
      <button type="button" class="icon-btn" data-del-item="${i}" aria-label="Quitar ítem">${icon('x', { size: 16 })}</button>
    </div>`)}`;

  const s = openSheet({
    title: editing ? 'Editar movimiento' : 'Nuevo movimiento',
    body: html`<form class="tx-form" novalidate>
      ${linked ? html`<div class="banner info mb-4">${icon('info')}<span>Este movimiento está ligado a ${tx.to_card_id ? 'un pago de tarjeta' : tx.debt_id ? 'un crédito' : tx.goal_id ? 'una meta' : 'una suscripción'}. Puedes ajustar monto, fecha y notas.</span></div>` : ''}
      ${linked ? '' : segmented('type', [{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }, { value: 'transfer', label: 'Transferencia' }], m.type)}
      <label class="amount-input"><span class="cur">$</span><input name="amount" value="${m.amount ? number(m.amount) : ''}" placeholder="0" inputmode="numeric" aria-label="Monto" autocomplete="off"></label>
      <div class="field-error center" data-err="amount"></div>
      <div class="field"><label for="tx-desc">Descripción</label>
        <input id="tx-desc" class="input" name="description" value="${m.description}" placeholder="Ej. Almuerzo, Uber, Mercado D1" maxlength="120"></div>
      <div class="field" data-show="cat"><span class="label">Categoría</span><button type="button" class="pick-btn" data-pick="category">${catBtn()}</button></div>
      <div class="field" data-show="pay"><span class="label" data-pay-label>${m.type === 'transfer' ? 'Desde' : m.type === 'income' ? 'Entró a' : 'Pagado con'}</span>
        <button type="button" class="pick-btn" data-pick="payment">${paymentChip(m.payment)}${icon('chevron-right', { size: 18 })}</button></div>
      <div class="field" data-show="to"><label for="tx-to">Hacia</label><select id="tx-to" class="input" name="to_account_id">
        <option value="">Elige la cuenta destino</option>
        ${state.accounts.filter((a) => !a.archived).map((a) => html`<option value="${a.id}" ${a.id === m.to_account_id ? 'selected' : ''}>${a.name}</option>`)}</select></div>
      <div class="input-row mt-4">
        <div class="field"><label for="tx-date">Fecha</label><input id="tx-date" class="input" type="date" name="date" value="${m.date}"></div>
        <div class="field"><label for="tx-time">Hora</label><input id="tx-time" class="input" type="time" name="time" value="${m.time}"></div>
      </div>
      <details class="tx-more mt-4" ${m.items.length || m.notes ? 'open' : ''}>
        <summary>${icon('list', { size: 16 })}Detalle y notas${icon('chevron-down', { size: 16 })}</summary>
        <div class="items" data-show="items">${itemsHtml()}</div>
        <button type="button" class="link-btn" data-add-item data-show="items">${icon('plus', { size: 16 })}Agregar ítem</button>
        <div class="field mt-2"><label for="tx-notes">Notas</label><textarea id="tx-notes" class="input" name="notes" maxlength="500" placeholder="Opcional">${m.notes}</textarea></div>
      </details>
      ${editing ? html`<button type="button" class="btn btn-danger btn-block mt-8" data-delete>${icon('trash')}Eliminar movimiento</button>` : ''}
    </form>`,
    footer: html`<button class="btn btn-primary btn-block" data-save><span class="btn-label">${editing ? 'Guardar cambios' : 'Guardar'}</span><span class="spinner"></span></button>`,
  });

  const form = s.body.querySelector('form');
  const amountEl = form.amount;
  autosizeAmount(amountEl);
  if (!editing) setTimeout(() => amountEl.focus(), 420);

  const applyType = () => {
    const t = m.type;
    form.querySelector('[data-show="cat"]').hidden = t === 'transfer' || !!linked;
    form.querySelector('[data-show="to"]').hidden = t !== 'transfer' || !!linked;
    form.querySelector('[data-show="pay"]').hidden = !!linked;
    form.querySelectorAll('[data-show="items"]').forEach((e) => { e.hidden = t === 'transfer'; });
    form.querySelector('[data-pay-label]').textContent = t === 'transfer' ? 'Desde' : t === 'income' ? 'Entró a' : 'Pagado con';
    if (t !== 'expense' && m.payment.kind === 'card') {
      m.payment = { kind: 'account', id: defaultAccount() };
      form.querySelector('[data-pick="payment"]').innerHTML = String(html`${paymentChip(m.payment)}${icon('chevron-right', { size: 18 })}`);
    }
    if (m.category_id && categoryById(m.category_id)?.kind !== t) {
      m.category_id = null;
      form.querySelector('[data-pick="category"]').innerHTML = String(catBtn());
    }
  };
  applyType();

  const syncItemsTotal = () => {
    const total = m.items.reduce((acc, it) => acc + Math.round((it.qty || 0) * (it.unit_amount || 0)), 0);
    if (total > 0 && m.items.every((it) => it.unit_amount > 0)) {
      m.amount = total;
      amountEl.value = number(total);
      amountEl.dispatchEvent(new Event('input'));
    }
  };

  [
    on(form, 'click', '[data-seg="type"] button', (e, b) => { m.type = selectSegment(b.parentElement, b.dataset.value); haptic.select(); applyType(); }),
    on(form, 'input', 'input[name="amount"]', () => {
      const v = parseAmount(amountEl.value);
      amountEl.value = v ? number(v) : '';
      m.amount = v;
      form.querySelector('[data-err="amount"]').textContent = '';
    }),
    on(form, 'click', '[data-pick="category"]', async (e, b) => {
      const id = await pickCategory({ kind: m.type === 'income' ? 'income' : 'expense', selected: m.category_id });
      if (id) { m.category_id = id; b.innerHTML = String(catBtn()); }
    }),
    on(form, 'click', '[data-pick="payment"]', async (e, b) => {
      const r = await pickPayment({ selected: m.payment, allowCards: m.type === 'expense' });
      if (r) { m.payment = r; b.innerHTML = String(html`${paymentChip(r)}${icon('chevron-right', { size: 18 })}`); }
    }),
    on(form, 'click', '[data-add-item]', () => {
      m.items.push({ name: '', qty: 1, unit_amount: 0 });
      form.querySelector('.items').innerHTML = String(itemsHtml());
      form.querySelector('.items .item-row:last-child input')?.focus();
    }),
    on(form, 'click', '[data-del-item]', (e, b) => {
      m.items.splice(Number(b.dataset.delItem), 1);
      form.querySelector('.items').innerHTML = String(itemsHtml());
      syncItemsTotal();
    }),
    on(form, 'input', '[data-it]', (e, inp) => {
      const it = m.items[Number(inp.closest('[data-item]').dataset.item)];
      const k = inp.dataset.it;
      if (k === 'name') it.name = inp.value;
      else if (k === 'qty') it.qty = Number(String(inp.value).replace(',', '.')) || 0;
      else { it.unit_amount = parseAmount(inp.value); inp.value = it.unit_amount ? number(it.unit_amount) : ''; }
      if (k !== 'name') syncItemsTotal();
    }),
  ];

  const save = async () => {
    if (!(m.amount > 0)) {
      form.querySelector('[data-err="amount"]').textContent = 'Escribe el monto';
      amountEl.closest('.amount-input').classList.add('shake');
      setTimeout(() => amountEl.closest('.amount-input').classList.remove('shake'), 500);
      haptic.error();
      return;
    }
    const toAcc = form.to_account_id?.value || null;
    if (m.type === 'transfer' && !linked && (!toAcc || toAcc === m.payment.id)) { toast('Elige una cuenta destino diferente', { type: 'err' }); return; }
    if (!linked && !m.payment.id) { toast('Elige la cuenta o tarjeta', { type: 'err' }); return; }
    const row = {
      type: m.type,
      amount: m.amount,
      occurred_at: toTimestamp(form.date.value || inputParts().date, form.time.value || '12:00'),
      description: form.description.value.trim() || categoryById(m.category_id)?.name || (m.type === 'transfer' ? 'Transferencia' : 'Movimiento'),
      notes: form.notes.value.trim(),
    };
    if (!linked) {
      Object.assign(row, {
        category_id: m.type === 'transfer' ? null : m.category_id,
        account_id: m.payment.kind === 'account' ? m.payment.id : null,
        card_id: m.payment.kind === 'card' ? m.payment.id : null,
        to_account_id: m.type === 'transfer' ? toAcc : null,
      });
      if (m.type !== 'transfer') row.items = m.items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), qty: i.qty || 1, unit_amount: i.unit_amount || 0 }));
    }
    // El id se genera una vez por apertura: si un guardado se reintenta tras un timeout, no se duplica
    if (!editing) row.id = s.newId ??= crypto.randomUUID();
    const r = await runSave(async () => {
      if (editing) { await updateTransaction(tx.id, row); return null; }
      return createTransactions([{ ...row, source: 'manual' }], { allowOffline: true });
    }, { button: s.foot.querySelector('[data-save]') });
    if (!r.ok) return;
    if (editing) toast('Cambios guardados');
    else if (r.value.queued) toast('Guardado sin conexión. Se sincroniza cuando vuelvas a tener internet.', { type: 'info' });
    else toast(`${m.type === 'income' ? 'Ingreso' : m.type === 'transfer' ? 'Transferencia' : 'Gasto'} de ${money(m.amount)} guardado`, {
      action: { label: 'Deshacer', fn: () => deleteTransactions(r.value.ids) },
    });
    haptic.success();
    s.close();
  };
  s.foot.querySelector('[data-save]').addEventListener('click', save);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '¿Eliminar este movimiento?', message: 'Podrás deshacerlo durante unos segundos.', confirm: 'Eliminar', danger: true }))) return;
    try { s.close(); await deleteWithUndo([tx]); } catch (err) { toast(err.message, { type: 'err' }); }
  });
  return s;
}
