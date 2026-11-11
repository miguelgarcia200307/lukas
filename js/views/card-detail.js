// Detalle de tarjeta: historial, registrar pago (con intereses opcionales), interés/cuota de manejo, ajuste con extracto
import { html, on, raw } from '../utils/dom.js';
import { ORB_SPINNER } from '../ui/orb-loader.js';
import { icon } from '../utils/icons.js';
import { money, number } from '../utils/format.js';
import { dayLabel, timeLabel, inputParts, toTimestamp } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe, cardById } from '../state.js';
import { cardMovements, payCard, extraCharge, adjustBalance } from '../api/cards.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar, segmented, selectSegment } from '../ui/common.js';
import { loaderHtml, settle, orbError, loadErrorText, online } from '../ui/orb-loader.js';
import { emptyState } from '../ui/empty.js';
import { openSheet } from '../ui/sheet.js';
import { bindAmountInput } from '../ui/number-input.js';
import { toast } from '../ui/toast.js';
import { runSave } from '../ui/submit.js';
import { plastic, cardStats, openCardForm } from './cards.js';

export const title = 'Tarjeta';

const KIND = {
  charge: { label: 'Compra', icon: 'cart', sign: '+' },
  payment: { label: 'Pago', icon: 'check', sign: '−' },
  interest: { label: 'Intereses', icon: 'percent', sign: '+' },
  fee: { label: 'Cuota de manejo', icon: 'card', sign: '+' },
  adjustment: { label: 'Ajuste', icon: 'swap', sign: '' },
};

function actionSheet({ title, body, submitLabel, onSubmit }) {
  const s = openSheet({
    title, detent: 'large', body,
    footer: html`<button class="btn btn-primary btn-block" data-submit><span class="btn-label">${submitLabel}</span>${raw(ORB_SPINNER)}</button>`,
  });
  const btn = s.foot.querySelector('[data-submit]');
  btn.addEventListener('click', async () => {
    const r = await runSave(() => onSubmit(s.body), { button: btn });
    if (r.ok && r.value !== false) { haptic.success(); s.close(); } // false = validación propia del formulario
  });
  return s;
}

const accountSelect = () => html`<select class="input" name="account">${state.accounts.filter((a) => !a.archived).map((a) => html`<option value="${a.id}" ${a.id === state.profile?.default_account_id ? 'selected' : ''}>${a.name} · ${money(a.balance)}</option>`)}</select>`;

function openPay(card) {
  const now = inputParts();
  const s = actionSheet({
    title: 'Registrar pago',
    submitLabel: 'Registrar pago',
    body: html`<p class="muted small">Pagar la tarjeta no es un gasto: la plata sale de tu cuenta y baja la deuda.</p>
      <label class="amount-input"><span class="cur">$</span><input name="amount" value="${Number(card.debt) > 0 ? number(card.debt) : ''}" placeholder="0" aria-label="Monto del pago"></label>
      <div class="chips center-chips">${Number(card.debt) > 0 ? html`<button type="button" class="chip" data-fill="${card.debt}">Total ${money(card.debt)}</button>` : ''}</div>
      <div class="field mt-4"><label>Desde la cuenta</label>${accountSelect()}</div>
      <div class="field"><label>¿Cobraron intereses este mes? (opcional)</label><div class="input-prefix"><span>$</span><input class="input" name="interest" placeholder="0"></div>
        <span class="field-hint">Si los ingresas, suben la deuda y cuentan como gasto en Gastos financieros.</span></div>
      <div class="input-row mt-4"><div class="field"><label>Fecha</label><input class="input" type="date" name="date" value="${now.date}"></div>
        <div class="field"><label>Hora</label><input class="input" type="time" name="time" value="${now.time}"></div></div>`,
    onSubmit: async (b) => {
      const amount = amt.value;
      if (!amount) { toast('Escribe el monto del pago', { type: 'err' }); return false; }
      await payCard({ cardId: card.id, accountId: b.querySelector('[name="account"]').value, amount, interest: interest.value,
        date: toTimestamp(b.querySelector('[name="date"]').value, b.querySelector('[name="time"]').value) });
      toast(`Pago de ${money(amount)} registrado`);
    },
  });
  const amt = bindAmountInput(s.body.querySelector('[name="amount"]'));
  const interest = bindAmountInput(s.body.querySelector('[name="interest"]'));
  on(s.body, 'click', '[data-fill]', (e, b) => { amt.value = Number(b.dataset.fill); });
}

function openExtra(card) {
  let kind = 'interest';
  const now = inputParts();
  const s = actionSheet({
    title: 'Interés o cuota de manejo',
    submitLabel: 'Registrar',
    body: html`${segmented('kind', [{ value: 'interest', label: 'Intereses' }, { value: 'fee', label: 'Cuota de manejo' }], kind)}
      <label class="amount-input"><span class="cur">$</span><input name="amount" placeholder="0" aria-label="Monto"></label>
      <p class="muted small center">Sube la deuda de la tarjeta y se registra como gasto en Gastos financieros.</p>
      <div class="field mt-4"><label>Fecha</label><input class="input" type="date" name="date" value="${now.date}"></div>`,
    onSubmit: async (b) => {
      if (!amt.value) { toast('Escribe el monto', { type: 'err' }); return false; }
      await extraCharge({ cardId: card.id, kind, amount: amt.value, date: toTimestamp(b.querySelector('[name="date"]').value, now.time) });
      toast('Registrado');
    },
  });
  const amt = bindAmountInput(s.body.querySelector('[name="amount"]'));
  on(s.body, 'click', '[data-seg] button', (e, b) => { kind = selectSegment(b.parentElement, b.dataset.value); });
}

function openAdjust(card) {
  const s = actionSheet({
    title: 'Ajustar saldo',
    submitLabel: 'Ajustar',
    body: html`<p class="muted small">Escribe lo que dice tu extracto o la app del banco. Haré un ajuste por la diferencia (no cuenta como gasto).</p>
      <div class="center mt-4"><span class="eyebrow">Hoy registras</span><div class="num bold">${money(card.debt)}</div></div>
      <label class="amount-input"><span class="cur">$</span><input name="amount" value="${number(Math.max(0, card.debt))}" aria-label="Deuda real"></label>`,
    onSubmit: async () => {
      const delta = await adjustBalance({ cardId: card.id, target: amt.value });
      toast(delta === 0 ? 'Ya estaba cuadrada' : `Ajuste de ${money(delta)} aplicado`);
    },
  });
  const amt = bindAmountInput(s.body.querySelector('[name="amount"]'));
}

export function mount(screen, { params }) {
  const id = params.id;
  screen.innerHTML = String(html`
    ${topbar({ title: 'Tarjeta', back: true, right: html`<button class="icon-btn" data-edit aria-label="Editar tarjeta">${icon('edit')}</button>` })}
    <div class="scroller"><div class="content"><div class="cd-head"></div>
      <div class="cd-actions">
        <button class="action-tile pressable" data-act="pay"><span>${icon('check', { stroke: 2.2 })}</span>Registrar pago</button>
        <button class="action-tile pressable" data-act="extra"><span>${icon('percent')}</span>Interés o cuota</button>
        <button class="action-tile pressable" data-act="adjust"><span>${icon('swap')}</span>Ajustar saldo</button>
      </div>
      <div class="cd-note"></div>
      <section class="section"><div class="section-head"><h2 class="section-title">Movimientos de la tarjeta</h2></div><div class="cd-moves">${loaderHtml()}</div></section>
    </div></div>`);

  const head = screen.querySelector('.cd-head');
  const moves = screen.querySelector('.cd-moves');

  const paintHead = () => {
    const c = cardById(id);
    if (!c) { head.innerHTML = String(emptyState({ illus: 'cards', title: 'No encontramos esta tarjeta' })); return; }
    screen.querySelector('.title-sm').textContent = c.name;
    head.innerHTML = String(html`${plastic(c, { link: false })}${cardStats(c)}`);
    screen.querySelector('.cd-note').innerHTML = String(c.est_interest != null && Number(c.debt) > 0 ? html`<div class="banner info mt-4">${icon('info')}
      <span>Con tu tasa de ${Number(c.monthly_rate).toLocaleString('es-CO', { maximumFractionDigits: 3 })}% mensual, el interés aproximado sobre la deuda actual sería de <b>${money(c.est_interest)}</b> al mes. Es una estimación: tu banco puede calcularlo distinto.</span></div>` : '');
  };

  const loadMoves = async () => {
    try {
      const list = await online(() => cardMovements(id));
      await settle(moves);
      if (!list.length) { moves.innerHTML = String(emptyState({ illus: 'list', title: 'Sin movimientos todavía', text: 'Los gastos que pagues con esta tarjeta aparecerán aquí.' })); return; }
      moves.innerHTML = String(html`<div class="list stagger">${list.map((m, i) => {
        const k = KIND[m.kind];
        const sign = m.kind === 'adjustment' ? (m.amount < 0 ? '−' : '+') : k.sign;
        return html`<div class="list-row" style="--i:${Math.min(i, 10)}">
          <span class="cat-icon" style="--c:${m.kind === 'payment' ? '#12875A' : m.kind === 'charge' ? '#4B3BF5' : '#B87600'}">${icon(k.icon, { size: 20 })}</span>
          <div class="grow"><div class="row-title ellipsis">${m.note || k.label}</div><div class="row-sub">${k.label} · ${dayLabel(m.occurred_at)} · ${timeLabel(m.occurred_at)}</div></div>
          <div class="row-amount ${m.kind === 'payment' || m.amount < 0 ? 'in' : ''}">${sign}${money(Math.abs(m.amount))}</div></div>`;
      })}</div>`);
    } catch (err) {
      await settle(moves);
      moves.innerHTML = String(orbError({ title: 'No pudimos cargar los movimientos', text: loadErrorText(err) }));
    }
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-edit]', () => { const c = cardById(id); if (c) openCardForm(c); }),
    on(screen, 'click', '[data-act]', (e, b) => {
      const c = cardById(id);
      if (!c) return;
      haptic.tap();
      if (b.dataset.act === 'pay') openPay(c);
      if (b.dataset.act === 'extra') openExtra(c);
      if (b.dataset.act === 'adjust') openAdjust(c);
    }),
    subscribe('cards', () => { paintHead(); loadMoves(); }),
    on(screen, 'click', '[data-retry]', loadMoves),
  ];
  paintHead();
  loadMoves();
  refresh('cards');
  return () => offs.forEach((f) => f());
}
