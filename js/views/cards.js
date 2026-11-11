// Tarjetas de crédito: plásticos visuales con deuda, cupo, uso y próximas fechas
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, percent } from '../utils/format.js';
import { inDays, daysBetween, todayISO, dateShort } from '../utils/dates.js';
import { state, subscribe } from '../state.js';
import { createCard, updateCard, deleteCard } from '../api/cards.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar, progressBar } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { skCards } from '../ui/skeleton.js';
import { formSheet } from '../ui/form.js';
import { pullToRefresh } from '../ui/gestures.js';
import { toast } from '../ui/toast.js';

export const title = 'Tarjetas';

const BRAND_MARK = {
  visa: '<span class="brand-visa">VISA</span>',
  mastercard: '<span class="brand-mc"><i></i><i></i></span>',
  amex: '<span class="brand-amex">AMEX</span>',
  diners: '<span class="brand-diners">Diners</span>',
  other: '',
};

export function plastic(c, { link = true } = {}) {
  const inner = html`
    <div class="pl-top"><span class="pl-bank">${c.bank || c.name}</span>${raw(BRAND_MARK[c.brand] ?? '')}</div>
    <div class="pl-mid"><span class="pl-chip" aria-hidden="true"></span>
      <div class="pl-debt"><span>Deuda actual</span><b class="num">${money(Math.max(0, c.debt))}</b>${Number(c.debt) < 0 ? html`<em>Saldo a favor ${money(-c.debt)}</em>` : ''}</div></div>
    <div class="pl-bottom"><span class="num">${c.last4 ? `•••• ${c.last4}` : ''}</span><span class="ellipsis">${c.name}</span></div>`;
  return link
    ? html`<a class="plastic pressable" href="#/tarjetas/${c.id}" style="--c:${c.color}" aria-label="Tarjeta ${c.name}">${inner}</a>`
    : html`<div class="plastic" style="--c:${c.color}">${inner}</div>`;
}

export function cardStats(c) {
  const usage = Number(c.usage_pct) || 0;
  const dCut = daysBetween(todayISO(), c.next_cut_date);
  const dDue = daysBetween(todayISO(), c.next_due_date);
  return html`<div class="card-stats">
    <div class="cs-row"><div><span class="eyebrow">Cupo</span><b class="num">${money(c.credit_limit)}</b></div>
      <div><span class="eyebrow">Disponible</span><b class="num ${Number(c.available) < 0 ? 'expense-txt' : ''}">${money(c.available)}</b></div>
      <div><span class="eyebrow">Uso</span><b class="num">${percent(usage)}</b></div></div>
    ${progressBar(usage, { color: c.color })}
    <div class="cs-dates">
      <span class="tag ${dCut <= 1 ? 'warn' : ''}">${icon('calendar', { size: 12 })}Corte ${dCut === 0 ? 'hoy' : inDays(dCut).toLowerCase()} · ${dateShort(c.next_cut_date)}</span>
      <span class="tag ${dDue <= 3 && Number(c.debt) > 0 ? 'danger' : ''}">${icon('clock', { size: 12 })}Pago ${dDue === 0 ? 'hoy' : inDays(dDue).toLowerCase()} · ${dateShort(c.next_due_date)}</span>
    </div>
  </div>`;
}

export function openCardForm(card = null) {
  return formSheet({
    title: card ? 'Editar tarjeta' : 'Nueva tarjeta de crédito',
    fields: [
      { name: 'name', label: 'Nombre o alias', value: card?.name, required: true, placeholder: 'Ej. Visa Bancolombia' },
      { name: 'bank', label: 'Banco', value: card?.bank, placeholder: 'Ej. Bancolombia' },
      { name: 'brand', label: 'Franquicia', type: 'select', value: card?.brand ?? 'visa', options: [
        { value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }, { value: 'amex', label: 'American Express' },
        { value: 'diners', label: 'Diners' }, { value: 'other', label: 'Otra' }] },
      { name: 'last4', label: 'Últimos 4 dígitos', value: card?.last4, inputmode: 'numeric', maxlength: 4, placeholder: '1234',
        validate: (v) => (v && !/^\d{4}$/.test(v) ? 'Deben ser 4 números' : null) },
      { name: 'credit_limit', label: 'Cupo total', type: 'amount', value: card?.credit_limit, required: true },
      { name: 'cut_day', label: 'Día de corte', type: 'day', value: card?.cut_day, required: true, hint: 'Si el mes no tiene ese día, se usa el último.' },
      { name: 'due_day', label: 'Día límite de pago', type: 'day', value: card?.due_day, required: true },
      ...(card ? [] : [{ name: 'initial_debt', label: 'Lo que debes hoy (opcional)', type: 'amount', value: 0, hint: 'Para arrancar con el saldo real del extracto.' }]),
      { name: 'monthly_rate', label: 'Tasa de interés mensual (opcional)', type: 'percent', value: card?.monthly_rate ?? '', hint: 'Solo informativa: sirve para estimar intereses.' },
      { name: 'color', label: 'Color', type: 'color', value: card?.color ?? '#1D1D1B' },
    ],
    onSubmit: async (v) => {
      const row = { ...v, last4: v.last4 || null, bank: v.bank || null };
      if (card) await updateCard(card.id, row);
      else await createCard(row);
      toast(card ? 'Tarjeta actualizada' : 'Tarjeta agregada');
    },
    onDelete: card ? async () => { await deleteCard(card.id); toast('Tarjeta eliminada'); location.hash = '#/tarjetas'; } : null,
    deleteConfirm: { title: '¿Eliminar esta tarjeta?', message: 'Se borra su historial de movimientos. Los gastos hechos con ella se conservan.' },
  });
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Tarjetas', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Agregar tarjeta">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="cards-list">${state.cards.length ? '' : skCards()}</div></div></div>`);
  const list = screen.querySelector('.cards-list');

  const render = () => {
    const cards = state.cards.filter((c) => !c.archived);
    if (!cards.length) {
      list.innerHTML = String(emptyState({ illus: 'cards', title: 'Aún no tienes tarjetas', text: 'Agrega la primera y te aviso antes del corte y del pago.', action: { label: 'Agregar tarjeta', attrs: 'data-new' } }));
      return;
    }
    const total = cards.reduce((s, c) => s + Math.max(0, Number(c.debt)), 0);
    const limit = cards.reduce((s, c) => s + Number(c.credit_limit), 0);
    list.innerHTML = String(html`
      <div class="totals-strip"><div><span class="eyebrow">Deuda total</span><b class="num">${money(total)}</b></div>
        <div><span class="eyebrow">Cupo total</span><b class="num">${money(limit)}</b></div></div>
      <div class="stack gap-6 stagger">${cards.map((c, i) => html`<div style="--i:${i}">${plastic(c)}${cardStats(c)}</div>`)}</div>`);
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openCardForm()),
    subscribe('cards', render),
    pullToRefresh(screen.querySelector('.scroller'), () => refresh('cards')),
  ];
  render();
  refresh('cards');
  return () => offs.forEach((f) => f());
}
