// Tarjetas de propuesta editables (lo que entendió la IA) y su guardado atómico vía RPC.
// Una tarjeta por categoría: los ítems se pueden mover entre tarjetas, separar o unir; una tarjeta sin monto
// queda pendiente con su pregunta integrada (campo de monto o respuesta por voz).
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number, parseAmount } from '../utils/format.js';
import { bogota, todayISO } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, categoryById } from '../state.js';
import { pickCategory, pickPayment, paymentChip } from '../ui/pickers.js';
import { catIcon } from '../ui/common.js';
import { openSheet } from '../ui/sheet.js';
import { createTransactions, deleteTransactions } from '../api/transactions.js';
import { payCard } from '../api/cards.js';
import { payDebt } from '../api/debts.js';
import { createSubscription, deleteSubscription } from '../api/subscriptions.js';
import { contribute } from '../api/goals.js';
import { learnCategoryHints } from '../api/ai.js';
import { toast } from '../ui/toast.js';
import { runSave } from '../ui/submit.js';

const toastErr = (m) => toast(m, { type: 'err' });

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

const itemTotal = (it) => Math.round(it.qty * it.unit_amount);
const isActive = (p) => !p._status || p._status === 'pending';
/** Transacción a la que aún le falta el monto (la IA la dejó pendiente con su pregunta) */
export const missingAmount = (p) => p.kind === 'transaction' && isActive(p) && (p.pending || !(p.amount > 0));
function joinNames(names) {
  const n = [...new Set(names.map((x) => String(x).trim()).filter(Boolean))];
  const s = n.length <= 1 ? n[0] ?? '' : n.length <= 3 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1].toLowerCase()}` : `${n.slice(0, 2).join(', ')} y más`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const asItems = (p) => (p.items?.length ? p.items : [{ name: p.description || categoryById(p.category_id)?.name || 'Ítem', qty: 1, unit_amount: p.amount }]);
/** Otras tarjetas con las que esta se puede unir (mismo tipo, con monto) */
const joinable = (p, list) => list.filter((q) => q !== p && isActive(q) && q.kind === 'transaction' && q.type === p.type && !missingAmount(q));

function actionsRow(p, list) {
  if (p.kind !== 'transaction' || !isActive(p)) return '';
  const multi = list.filter(isActive).length > 1;
  const pend = missingAmount(p);
  const parts = [];
  if ((p.items?.length ?? 0) >= 2) parts.push(html`<button class="chip" data-act="split">${icon('grid', { size: 14 })}Separar</button>`);
  if (!pend && joinable(p, list).length) parts.push(html`<button class="chip" data-act="join">${icon('layers', { size: 14 })}Unir</button>`);
  if (multi && !pend) parts.push(html`<button class="chip save-one" data-act="save-one">${icon('check', { size: 14, stroke: 2.4 })}Guardar esta</button>`);
  return html`${parts}`;
}

function txCard(p, i, list = [p]) {
  const chips = [...new Set([p.category_id, ...(p.category_alternatives ?? []), ...(p._extraCats ?? [])].filter(Boolean))];
  const cat = categoryById(p.category_id);
  const pend = missingAmount(p);
  const items = p.items ?? [];
  const cls = ['proposal', 'tx', pend ? 'pending' : '', p._done ? 'completed' : '', p._catch ? 'catch' : '', p._fresh ? 'fresh' : ''].filter(Boolean).join(' ');
  return html`<article class="${cls}" data-i="${i}" style="--i:${i};--c:${cat?.color ?? '#9A9A92'}">
    <div class="p-top">
      <button class="p-cat" data-act="cat-other" aria-label="Categoría: ${cat?.name ?? 'sin categoría'}. Cambiar">
        ${catIcon(cat)}<span class="p-cat-name ellipsis">${cat?.name ?? 'Sin categoría'}</span>${icon('chevron-down', { size: 14 })}</button>
      <button class="tag ${p.type === 'income' ? 'ok' : 'danger'} type-toggle" data-act="type" aria-label="Cambiar tipo">
        ${icon(p.type === 'income' ? 'arrow-in' : 'arrow-out', { size: 12, stroke: 2.4 })}${p.type === 'income' ? 'Ingreso' : 'Gasto'}</button>
      ${p.confidence < 0.6 && !pend ? html`<span class="tag warn">Revisa</span>` : ''}
      <button class="icon-btn p-discard" data-act="discard" aria-label="Descartar">${icon('x', { size: 18 })}</button>
    </div>
    ${pend ? html`<div class="p-ask" role="group" aria-label="${p.question || 'Falta el monto'}">
        <div class="p-ask-q">${icon('sparkles', { size: 16 })}<span>${p.question || `¿Cuánto costó ${(p.description || '').toLowerCase()}?`}</span></div>
        <div class="p-ask-row">
          <label class="p-ask-field"><span class="cur">$</span><input data-f="answer" inputmode="numeric" placeholder="0" autocomplete="off" enterkeyhint="done" aria-label="Monto de ${p.description}"></label>
          <button class="btn btn-accent btn-sm" data-act="answer">Listo</button>
          <button class="icon-btn filled p-ask-mic" data-act="answer-mic" aria-label="Responder con voz">${icon('mic', { size: 20 })}</button>
        </div>
      </div>`
    : html`<label class="p-amount"><span class="cur">$</span><input data-f="amount" value="${number(p.amount)}" style="width:${number(p.amount).length + 0.6}ch" inputmode="numeric" aria-label="Monto" autocomplete="off"></label>`}
    <input class="p-desc" data-f="description" value="${p.description}" aria-label="Descripción" maxlength="120">
    ${items.length ? html`<ul class="p-items-list" aria-label="Ítems (toca uno para moverlo de categoría)">
      ${items.map((it, k) => html`<li style="--k:${k}" class="${p._drop === k ? 'drop' : ''}"><button class="p-item" data-act="item" data-k="${k}" aria-label="Mover ${it.name} a otra categoría">
        <span class="grow ellipsis">${it.name}</span><span class="muted">${it.qty !== 1 ? `${number(it.qty)} × ${money(it.unit_amount)}` : ''}</span>
        <b class="num">${it.unit_amount ? money(itemTotal(it)) : '—'}</b>${icon('swap', { size: 14 })}</button></li>`)}
    </ul>` : ''}
    <div class="chips p-cats">${chips.map((id) => catChip(id, p.category_id))}
      <button class="chip" data-act="cat-other">${icon('plus', { size: 14 })}Otra</button></div>
    <div class="p-meta">
      <button class="chip" data-act="payment">${paymentChip(p.payment)}${p.payment?.inferred ? html`<span class="p-hint">por defecto</span>` : ''}</button>
      <label class="chip p-date">${icon('calendar', { size: 15 })}<input type="datetime-local" data-f="date" value="${toLocalInput(p.date)}" max="${todayISO()}T23:59" aria-label="Fecha y hora"></label>
    </div>
    <div class="chips p-actions">${actionsRow(p, list)}</div>
  </article>`;
}

function savedCard(p, i) {
  const cat = p.kind === 'transaction' ? categoryById(p.category_id) : null;
  return html`<article class="proposal saved" data-i="${i}" style="--i:${i};--c:${cat?.color ?? '#12875A'}">
    <span class="p-saved-check">${icon('check', { size: 16, stroke: 2.6 })}</span>
    <span class="grow ellipsis"><b>Guardado</b> · ${cat?.name ?? p.description ?? p.name ?? ''}</span>
    <b class="num">${money(p.amount)}</b>
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

/** Una tarjeta (en el contexto de la lista completa, para saber con cuáles se puede unir) */
export function renderOne(p, i, list) {
  if (p._status === 'discarded') return '';
  if (p._status === 'saved') return String(savedCard(p, i));
  return String(RENDER[p.kind]?.(p, i, list) ?? '');
}

export function renderProposals(list) {
  return html`${list.map((p, i) => raw(renderOne(p, i, list)))}`;
}

/** Resumen de lo que queda por confirmar: tarjetas, categorías, total y pendientes */
export function summarize(list) {
  const active = list.filter(isActive);
  const txs = active.filter((p) => p.kind === 'transaction');
  const pending = active.filter(missingAmount);
  const cats = [...new Set(txs.map((p) => p.category_id).filter(Boolean))].map((id) => categoryById(id)).filter(Boolean);
  const kinds = new Set(txs.map((p) => p.type));
  const noun = txs.length === active.length && kinds.size === 1 ? ([...kinds][0] === 'income' ? ['ingreso', 'ingresos'] : ['gasto', 'gastos']) : ['movimiento', 'movimientos'];
  const total = active.filter((p) => !missingAmount(p)).reduce((s, p) => s + (p.amount || 0), 0);
  return { count: active.length, noun: active.length === 1 ? noun[0] : noun[1], cats, total, pending: pending.length, saved: list.filter((p) => p._status === 'saved').length };
}

/** Enlaza la edición en vivo de las tarjetas con el arreglo de propuestas */
export function bindProposals(container, list, { onChange, onAnswerVoice, onSaved, transcript } = {}) {
  const get = (node) => list[Number(node.closest('.proposal')?.dataset.i)];
  const clearFlags = () => list.forEach((q) => { delete q._drop; delete q._catch; delete q._done; delete q._fresh; });
  const rerender = (p) => {
    const i = list.indexOf(p);
    const old = container.querySelector(`.proposal[data-i="${i}"]`);
    if (!old) return;
    const t = document.createElement('template');
    t.innerHTML = renderOne(p, i, list).trim();
    const fresh = t.content.firstElementChild;
    if (!fresh) { old.remove(); return; }
    if (!p._done && !p._catch && !p._fresh) fresh.style.animation = 'none';
    old.replaceWith(fresh);
    clearFlags();
    refreshActions();
  };
  /** Re-pinta todo sin animar (salvo las tarjetas marcadas: ítem que cae, tarjeta nueva o completada) */
  const renderAll = () => {
    container.classList.add('still');
    container.innerHTML = String(renderProposals(list));
    clearFlags();
  };
  /** Solo actualiza las acciones (Separar / Unir / Guardar esta) sin tocar lo que se está animando */
  const refreshActions = () => {
    container.querySelectorAll('.proposal[data-i]').forEach((node) => {
      const p = list[Number(node.dataset.i)];
      const row = node.querySelector('.p-actions');
      if (p && row) row.innerHTML = String(actionsRow(p, list));
    });
  };
  const recompute = (p) => {
    if (p.items?.length && p.items.every((it) => it.unit_amount > 0)) p.amount = p.items.reduce((s, it) => s + itemTotal(it), 0);
    if (p.items?.length === 1 && p.items[0].qty === 1) { p.description = p.items[0].name; p.amount = itemTotal(p.items[0]) || p.amount; p.items = []; }
  };
  /** Completa una tarjeta pendiente con el monto que dijo o escribió el usuario */
  const complete = (p, amount) => {
    if (!(amount > 0)) return false;
    p.amount = amount;
    p.pending = false;
    p._done = true;
    haptic.success();
    rerender(p);
    onChange?.();
    return true;
  };
  /** Mueve el ítem k de p a la categoría catId: cae en la tarjeta de esa categoría o crea una nueva */
  const moveItem = (p, k, catId) => {
    if (catId === p.category_id) return;
    const it = p.items[k];
    const target = list.find((q) => q !== p && isActive(q) && q.kind === 'transaction' && q.type === p.type && q.category_id === catId && !missingAmount(q));
    p.items.splice(k, 1);
    if (p.items.every((x) => x.unit_amount > 0)) p.amount = p.items.reduce((s, x) => s + itemTotal(x), 0);
    else p.amount = Math.max(0, p.amount - itemTotal(it));
    p.description = joinNames(p.items.map((x) => x.name)) || p.description;
    recompute(p);
    if (target) {
      target.items = [...asItems(target), it];
      target.amount = target.items.reduce((s, x) => s + itemTotal(x), 0);
      target.description = joinNames(target.items.map((x) => x.name));
      target._drop = target.items.length - 1;
      target._catch = true;
    } else {
      const fresh = { ...p, category_id: catId, category_alternatives: [], _extraCats: [], items: it.qty !== 1 ? [it] : [], description: it.name, amount: itemTotal(it), pending: false, _fresh: true, _catch: true };
      delete fresh._status;
      list.splice(list.indexOf(p) + 1, 0, fresh);
    }
    renderAll();
    onChange?.();
  };
  const split = (p) => {
    const parts = p.items.map((it) => ({ ...p, items: it.qty !== 1 ? [it] : [], description: it.name, amount: itemTotal(it), _fresh: true }));
    list.splice(list.indexOf(p), 1, ...parts);
    renderAll();
    onChange?.();
  };
  const join = (p, target) => {
    target.items = [...asItems(target), ...asItems(p)];
    target.amount = target.items.reduce((s, x) => s + itemTotal(x), 0);
    target.description = joinNames(target.items.map((x) => x.name));
    target._drop = target.items.length - 1;
    target._catch = true;
    p._status = 'discarded';
    renderAll();
    onChange?.();
  };
  const chooseCard = (p) => new Promise((resolve) => {
    let done = false;
    const options = joinable(p, list);
    const s = openSheet({
      title: 'Unir con…', detent: 'medium',
      body: html`<div class="list">${options.map((q) => { const c = categoryById(q.category_id); return html`<button class="list-row tappable" data-k="${list.indexOf(q)}">
        ${catIcon(c)}<div class="grow"><div class="row-title">${c?.name ?? 'Sin categoría'}</div><div class="row-sub ellipsis">${q.description}</div></div><b class="num">${money(q.amount)}</b></button>`; })}</div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    on(s.body, 'click', '[data-k]', (e, b) => { done = true; resolve(list[Number(b.dataset.k)]); s.close(); });
  });

  const offKey = on(container, 'keydown', '[data-f="answer"]', (e, inp) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    inp.closest('.proposal')?.querySelector('[data-act="answer"]')?.click();
  });

  const offInput = on(container, 'input', '[data-f]', (e, inp) => {
    const p = get(inp);
    if (!p) return;
    const f = inp.dataset.f;
    if (f === 'answer') { const v = parseAmount(inp.value); inp.value = v ? number(v) : ''; return; }
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
      setTimeout(() => { p._status = 'discarded'; card.remove(); refreshActions(); onChange?.(); }, 260);
    } else if (act === 'answer') {
      const inp = b.closest('.proposal').querySelector('[data-f="answer"]');
      if (!complete(p, parseAmount(inp?.value))) { inp?.focus(); b.closest('.proposal').classList.add('shake'); setTimeout(() => b.closest('.proposal')?.classList.remove('shake'), 500); }
    } else if (act === 'answer-mic') {
      onAnswerVoice?.(p);
    } else if (act === 'item') {
      const id = await pickCategory({ kind: p.type ?? 'expense', selected: p.category_id, title: `¿A qué categoría va ${p.items[Number(b.dataset.k)]?.name ?? 'este ítem'}?` });
      if (id) moveItem(p, Number(b.dataset.k), id);
    } else if (act === 'split') {
      split(p);
    } else if (act === 'join') {
      const target = await chooseCard(p);
      if (target) join(p, target);
    } else if (act === 'save-one') {
      const err = validateProposal(p);
      if (err) { toastErr(err); return; }
      const res = await runSave(() => saveProposals([p], { transcript: transcript?.() }), { button: b });
      if (!res.ok) return;
      haptic.success();
      rerender(p);
      onChange?.();
      onSaved?.(p, res.value);
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
  const unbind = () => { offInput(); offChange(); offClick(); offKey(); };
  return Object.assign(unbind, { complete, render: renderAll, refreshActions });
}

export const pendingProposals = (list) => list.filter((p) => !p._status || p._status === 'pending');

export function validateProposal(p) {
  if (missingAmount(p)) return `Falta el monto de ${(p.description || 'un gasto').toLowerCase()}`;
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
    // Memoria de categorización: lo confirmado (o corregido) enseña a Lukas cómo categoriza este usuario
    learnCategoryHints(txs.filter((p) => p.category_id).map((p) => ({
      text: [p.description, ...(p.items ?? []).map((it) => it.name)].filter(Boolean).join(' '), category_id: p.category_id,
    })));
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
