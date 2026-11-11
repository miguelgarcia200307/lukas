// Tarjetas de propuesta editables (lo que entendió la IA) y su guardado atómico vía RPC
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number, parseAmount } from '../utils/format.js';
import { bogota, todayISO } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, categoryById } from '../state.js';
import { pickCategory, pickPayment, paymentChip } from '../ui/pickers.js';
import { createTransactions, deleteTransactions } from '../api/transactions.js';
import { payCard } from '../api/cards.js';
import { payDebt } from '../api/debts.js';
import { createSubscription, deleteSubscription } from '../api/subscriptions.js';
import { contribute } from '../api/goals.js';

const toLocalInput = (iso) => { const b = bogota(new Date(iso)); return `${b.date}T${b.time}`; };
const fromLocalInput = (v) => (v ? `${v}:00-05:00` : new Date().toISOString());

const accountOptions = (selected, { allowNone = false } = {}) => html`
  ${allowNone ? html`<option value="" ${!selected ? 'selected' : ''}>Sin mover plata de una cuenta</option>` : ''}
  ${state.accounts.filter((a) => !a.archived).map((a) => html`<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${a.name}</option>`)}`;

function catChip(id, selectedId) {
  const c = categoryById(id);
  if (!c) return '';
  return html`<button class="chip cat ${id === selectedId ? 'selected' : ''}" style="--c:${c.color}" data-act="cat" data-id="${id}" aria-pressed="${id === selectedId}">
    <span class="dot"></span>${c.name}</button>`;
}

function txCard(p, i) {
  const chips = [...new Set([p.category_id, ...(p.category_alternatives ?? []), ...(p._extraCats ?? [])].filter(Boolean))];
  const itemsTotal = (p.items ?? []).reduce((s, it) => s + Math.round(it.qty * it.unit_amount), 0);
  return html`<article class="proposal" data-i="${i}" style="--i:${i}">
    <div class="p-top">
      <button class="tag ${p.type === 'income' ? 'ok' : 'danger'} type-toggle" data-act="type" aria-label="Cambiar tipo">
        ${icon(p.type === 'income' ? 'arrow-in' : 'arrow-out', { size: 12, stroke: 2.4 })}${p.type === 'income' ? 'Ingreso' : 'Gasto'}</button>
      ${p.confidence < 0.6 ? html`<span class="tag warn">Revisa</span>` : ''}
      <button class="icon-btn p-discard" data-act="discard" aria-label="Descartar">${icon('x', { size: 18 })}</button>
    </div>
    <label class="p-amount"><span class="cur">$</span><input data-f="amount" value="${number(p.amount)}" style="width:${number(p.amount).length + 0.6}ch" inputmode="numeric" aria-label="Monto" autocomplete="off"></label>
    <input class="p-desc" data-f="description" value="${p.description}" aria-label="Descripción" maxlength="120">
    <div class="chips p-cats">${chips.map((id) => catChip(id, p.category_id))}
      <button class="chip" data-act="cat-other">${icon('plus', { size: 14 })}Otra</button></div>
    <div class="p-meta">
      <button class="chip" data-act="payment">${paymentChip(p.payment)}${p.payment?.inferred ? html`<span class="p-hint">por defecto</span>` : ''}</button>
      <label class="chip p-date">${icon('calendar', { size: 15 })}<input type="datetime-local" data-f="date" value="${toLocalInput(p.date)}" max="${todayISO()}T23:59" aria-label="Fecha y hora"></label>
    </div>
    ${p.items?.length ? html`<details class="p-items">
      <summary>${p.items.length} ${p.items.length === 1 ? 'ítem' : 'ítems'} · ${money(itemsTotal)}${icon('chevron-down', { size: 16 })}</summary>
      <ul>${p.items.map((it) => html`<li><span class="grow">${it.name}</span><span class="muted">${it.qty !== 1 ? `${number(it.qty)} × ${money(it.unit_amount)}` : ''}</span><b class="num">${money(Math.round(it.qty * it.unit_amount))}</b></li>`)}</ul>
    </details>` : ''}
  </article>`;
}

function cardPaymentCard(p, i) {
  return html`<article class="proposal" data-i="${i}" style="--i:${i}">
    <div class="p-top"><span class="tag accent">${icon('card', { size: 12, stroke: 2.4 })}Pago de tarjeta</span>
      <button class="icon-btn p-discard" data-act="discard" aria-label="Descartar">${icon('x', { size: 18 })}</button></div>
    <label class="p-amount"><span class="cur">$</span><input data-f="amount" value="${number(p.amount)}" style="width:${number(p.amount).length + 0.6}ch" inputmode="numeric" aria-label="Monto"></label>
    <div class="p-grid">
      <label class="field"><span class="label">Tarjeta</span><select class="input" data-f="card_id">
        ${state.cards.filter((c) => !c.archived).map((c) => html`<option value="${c.id}" ${c.id === p.card_id ? 'selected' : ''}>${c.name}${c.last4 ? ` ·${c.last4}` : ''}</option>`)}</select></label>
      <label class="field"><span class="label">Desde</span><select class="input" data-f="account_id">${accountOptions(p.account_id)}</select></label>
      <label class="field"><span class="label">¿Cobraron intereses este mes? (opcional)</span>
        <input class="input" data-f="interest" inputmode="numeric" placeholder="$ 0" value="${p.interest ? number(p.interest) : ''}"></label>
    </div>
    <p class="p-note">${icon('info', { size: 14 })}No cuenta como gasto: baja la deuda de la tarjeta.</p>
  </article>`;
}

function debtCard(p, i) {
  return html`<article class="proposal" data-i="${i}" style="--i:${i}">
    <div class="p-top"><span class="tag accent">${icon('bank', { size: 12, stroke: 2.4 })}Cuota de crédito</span>
      <button class="icon-btn p-discard" data-act="discard" aria-label="Descartar">${icon('x', { size: 18 })}</button></div>
    <label class="p-amount"><span class="cur">$</span><input data-f="amount" value="${number(p.amount)}" style="width:${number(p.amount).length + 0.6}ch" inputmode="numeric" aria-label="Monto"></label>
    <div class="p-grid">
      <label class="field"><span class="label">Crédito</span><select class="input" data-f="debt_id">
        ${state.debts.filter((d) => !d.archived).map((d) => html`<option value="${d.id}" ${d.id === p.debt_id ? 'selected' : ''}>${d.name}</option>`)}</select></label>
      <label class="field"><span class="label">Desde</span><select class="input" data-f="account_id">${accountOptions(p.account_id)}</select></label>
      <label class="field"><span class="label">Registrar como</span><select class="input" data-f="mode">
        <option value="expense" ${p.mode !== 'transfer' ? 'selected' : ''}>Gasto (Gastos financieros)</option>
        <option value="transfer" ${p.mode === 'transfer' ? 'selected' : ''}>Transferencia (no cuenta como gasto)</option></select></label>
    </div>
  </article>`;
}

function subscriptionCard(p, i) {
  return html`<article class="proposal" data-i="${i}" style="--i:${i}">
    <div class="p-top"><span class="tag accent">${icon('repeat', { size: 12, stroke: 2.4 })}Nueva suscripción</span>
      <button class="icon-btn p-discard" data-act="discard" aria-label="Descartar">${icon('x', { size: 18 })}</button></div>
    <label class="p-amount"><span class="cur">$</span><input data-f="amount" value="${number(p.amount)}" style="width:${number(p.amount).length + 0.6}ch" inputmode="numeric" aria-label="Monto"></label>
    <input class="p-desc" data-f="name" value="${p.name}" aria-label="Nombre">
    <div class="p-grid two">
      <label class="field"><span class="label">Frecuencia</span><select class="input" data-f="frequency">
        ${[['monthly', 'Mensual'], ['yearly', 'Anual'], ['weekly', 'Semanal']].map(([v, l]) => html`<option value="${v}" ${p.frequency === v ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="field"><span class="label">Próximo cobro</span><input class="input" type="date" data-f="next_charge_date" value="${p.next_charge_date}"></label>
    </div>
    <div class="p-meta"><button class="chip" data-act="payment">${paymentChip(p.payment)}</button></div>
  </article>`;
}

function goalCard(p, i) {
  return html`<article class="proposal" data-i="${i}" style="--i:${i}">
    <div class="p-top"><span class="tag ok">${icon('target', { size: 12, stroke: 2.4 })}Aporte a meta</span>
      <button class="icon-btn p-discard" data-act="discard" aria-label="Descartar">${icon('x', { size: 18 })}</button></div>
    <label class="p-amount"><span class="cur">$</span><input data-f="amount" value="${number(p.amount)}" style="width:${number(p.amount).length + 0.6}ch" inputmode="numeric" aria-label="Monto"></label>
    <div class="p-grid">
      <label class="field"><span class="label">Meta</span><select class="input" data-f="goal_id">
        ${state.goals.filter((g) => !g.archived).map((g) => html`<option value="${g.id}" ${g.id === p.goal_id ? 'selected' : ''}>${g.name}</option>`)}</select></label>
      <label class="field"><span class="label">Desde</span><select class="input" data-f="account_id">${accountOptions(p.account_id, { allowNone: true })}</select></label>
    </div>
  </article>`;
}

const RENDER = { transaction: txCard, card_payment: cardPaymentCard, debt_payment: debtCard, subscription: subscriptionCard, goal_contribution: goalCard };

export function renderProposals(list) {
  return html`${list.map((p, i) => (p._status === 'discarded' ? '' : raw(String(RENDER[p.kind]?.(p, i) ?? ''))))}`;
}

/** Enlaza la edición en vivo de las tarjetas con el arreglo de propuestas */
export function bindProposals(container, list, { onChange } = {}) {
  const get = (node) => list[Number(node.closest('.proposal')?.dataset.i)];
  const rerender = (p) => {
    const i = list.indexOf(p);
    const old = container.querySelector(`.proposal[data-i="${i}"]`);
    if (!old) return;
    const t = document.createElement('template');
    t.innerHTML = String(RENDER[p.kind](p, i)).trim();
    const fresh = t.content.firstElementChild;
    fresh.style.animation = 'none';
    old.replaceWith(fresh);
  };

  const offInput = on(container, 'input', '[data-f]', (e, inp) => {
    const p = get(inp);
    if (!p) return;
    const f = inp.dataset.f;
    if (f === 'amount' || f === 'interest') {
      const v = parseAmount(inp.value);
      inp.value = v ? number(v) : '';
      if (f === 'amount') inp.style.width = `${Math.max(1, inp.value.length) + 0.6}ch`;
      p[f] = v;
    } else if (f === 'date') p.date = fromLocalInput(inp.value);
    else p[f] = inp.value;
    onChange?.();
  });
  const offChange = on(container, 'change', 'select[data-f], input[type="date"][data-f]', (e, inp) => {
    const p = get(inp);
    if (p) { p[inp.dataset.f] = inp.value || null; onChange?.(); }
  });
  const offClick = on(container, 'click', '[data-act]', async (e, b) => {
    const p = get(b);
    if (!p) return;
    const act = b.dataset.act;
    haptic.select();
    if (act === 'discard') {
      const card = b.closest('.proposal');
      card.classList.add('leaving');
      setTimeout(() => { p._status = 'discarded'; card.remove(); onChange?.(); }, 260);
    } else if (act === 'type') {
      p.type = p.type === 'income' ? 'expense' : 'income';
      const fallback = state.categories.find((c) => c.kind === p.type && c.system_key === (p.type === 'income' ? 'other_income' : 'other_expense'));
      if (categoryById(p.category_id)?.kind !== p.type) { p.category_id = fallback?.id ?? null; p.category_alternatives = []; }
      if (p.type === 'income' && p.payment?.kind === 'card') p.payment = { kind: 'account', id: state.profile?.default_account_id ?? state.accounts[0]?.id, inferred: true };
      rerender(p); onChange?.();
    } else if (act === 'cat') {
      p.category_id = b.dataset.id;
      rerender(p); onChange?.();
    } else if (act === 'cat-other') {
      const id = await pickCategory({ kind: p.type ?? 'expense', selected: p.category_id });
      if (id) {
        p._extraCats = [...new Set([...(p._extraCats ?? []), id])];
        p.category_id = id;
        rerender(p); onChange?.();
      }
    } else if (act === 'payment') {
      const r = await pickPayment({ selected: p.payment, allowCards: p.kind !== 'transaction' || p.type === 'expense' });
      if (r) { p.payment = { ...r, inferred: false }; rerender(p); onChange?.(); }
    }
  });
  return () => { offInput(); offChange(); offClick(); };
}

export const pendingProposals = (list) => list.filter((p) => !p._status || p._status === 'pending');

export function validateProposal(p) {
  if (!(p.amount > 0)) return 'Falta el monto';
  if (p.kind === 'transaction' && !p.payment?.id) return 'Elige con qué pagaste';
  if (p.kind === 'card_payment' && (!p.card_id || !p.account_id)) return 'Elige la tarjeta y la cuenta';
  if (p.kind === 'debt_payment' && !p.debt_id) return 'Elige el crédito';
  if (p.kind === 'goal_contribution' && !p.goal_id) return 'Elige la meta';
  if (p.kind === 'subscription' && !p.name?.trim()) return 'Ponle nombre a la suscripción';
  return null;
}

/**
 * Guarda las propuestas pendientes. Las transacciones van juntas en una sola llamada atómica.
 * Devuelve { count, undo } donde undo revierte todo lo guardado.
 */
export async function saveProposals(list, { transcript } = {}) {
  const pending = pendingProposals(list);
  const undos = [];
  let count = 0;

  const txs = pending.filter((p) => p.kind === 'transaction');
  if (txs.length) {
    const rows = txs.map((p) => ({
      type: p.type, amount: p.amount, occurred_at: p.date, description: p.description?.trim() || categoryById(p.category_id)?.name || 'Movimiento',
      category_id: p.category_id, account_id: p.payment?.kind === 'account' ? p.payment.id : null,
      card_id: p.payment?.kind === 'card' ? p.payment.id : null, source: 'voice', transcript: transcript ?? null,
      group_id: p.group_id ?? 'temp-1', items: (p.items ?? []).map((it) => ({ name: it.name, qty: it.qty, unit_amount: it.unit_amount })),
    }));
    const { ids } = await createTransactions(rows);
    txs.forEach((p) => { p._status = 'saved'; });
    count += ids.length;
    undos.push(() => deleteTransactions(ids));
  }

  for (const p of pending.filter((x) => x.kind !== 'transaction')) {
    if (p.kind === 'card_payment') {
      const r = await payCard({ cardId: p.card_id, accountId: p.account_id, amount: p.amount, interest: p.interest || 0, date: p.date });
      undos.push(() => deleteTransactions([r.payment_id, r.interest_id].filter(Boolean)));
    } else if (p.kind === 'debt_payment') {
      const id = await payDebt({ debtId: p.debt_id, amount: p.amount, accountId: p.account_id, mode: p.mode, date: p.date });
      undos.push(() => deleteTransactions([id]));
    } else if (p.kind === 'subscription') {
      const row = await createSubscription({
        name: p.name.trim(), amount: p.amount, frequency: p.frequency, next_charge_date: p.next_charge_date, category_id: p.category_id,
        account_id: p.payment?.kind === 'account' ? p.payment.id : null, card_id: p.payment?.kind === 'card' ? p.payment.id : null,
      });
      undos.push(() => deleteSubscription(row.id));
    } else if (p.kind === 'goal_contribution') {
      await contribute({ goalId: p.goal_id, amount: p.amount, accountId: p.account_id || null, date: p.date });
    }
    p._status = 'saved';
    count++;
  }

  return { count, undo: undos.length ? async () => { for (const u of undos.reverse()) await u(); } : null };
}
