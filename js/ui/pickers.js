// Selectores en sheet: categoría y método de pago
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { haptic } from '../utils/haptics.js';
import { openSheet } from './sheet.js';
import { catIcon } from './common.js';
import { state, topCategories, childCategories } from '../state.js';

/** Abre el selector de categoría → Promise<id|null> */
export function pickCategory({ kind = 'expense', selected = null, title = 'Categoría' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const renderList = (q = '') => {
      const norm = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const nq = norm(q);
      const parents = topCategories(kind);
      const blocks = parents.map((p) => {
        const kids = childCategories(p.id);
        const all = [p, ...kids].filter((c) => !nq || norm(c.name).includes(nq));
        if (!all.length) return '';
        return html`<div class="cat-group">
          ${all.map((c) => html`<button class="cat-pick ${c.id === selected ? 'selected' : ''} ${c.parent_id ? 'child' : ''}" data-id="${c.id}">
            ${catIcon(c)}<span class="ellipsis">${c.name}</span>${c.id === selected ? icon('check', { size: 18, stroke: 2.4 }) : ''}
          </button>`)}
        </div>`;
      });
      return html`${blocks}`;
    };
    const s = openSheet({
      title,
      detent: 'large',
      body: html`<div class="search-field mb-4">${icon('search', { size: 18 })}<input class="input" type="search" placeholder="Buscar categoría" aria-label="Buscar categoría" enterkeyhint="search"></div>
        <div class="cat-pick-list stagger">${renderList()}</div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const list = s.body.querySelector('.cat-pick-list');
    s.body.querySelector('input').addEventListener('input', (e) => { list.innerHTML = String(renderList(e.target.value)); });
    on(s.body, 'click', '.cat-pick', (e, b) => {
      haptic.select();
      done = true;
      resolve(b.dataset.id);
      s.close();
    });
  });
}

/** Selector de método de pago → Promise<{ kind: 'account'|'card', id } | null> */
export function pickPayment({ selected = null, allowCards = true, title = 'Método de pago' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const accounts = state.accounts.filter((a) => !a.archived);
    const cards = allowCards ? state.cards.filter((c) => !c.archived) : [];
    const row = (kind, item, sub) => html`<button class="list-row tappable" data-kind="${kind}" data-id="${item.id}">
      <span class="cat-icon" style="--c:${item.color}">${icon(kind === 'card' ? 'card' : item.type === 'cash' ? 'wallet' : 'bank', { size: 20 })}</span>
      <div class="grow"><div class="row-title">${item.name}</div><div class="row-sub">${sub}</div></div>
      ${selected?.id === item.id ? html`<span class="income">${icon('check', { size: 20, stroke: 2.4 })}</span>` : ''}
    </button>`;
    const s = openSheet({
      title,
      detent: 'medium',
      body: html`
        <div class="eyebrow mb-2">Cuentas</div>
        <div class="list">${accounts.map((a) => row('account', a, `Saldo ${money(a.balance)}`))}</div>
        ${cards.length ? html`<div class="eyebrow mb-2 mt-6">Tarjetas de crédito</div>
          <div class="list">${cards.map((c) => row('card', c, `Disponible ${money(c.available)}`))}</div>` : ''}`,
      onClose: () => { if (!done) resolve(null); },
    });
    on(s.body, 'click', '[data-kind]', (e, b) => {
      haptic.select();
      done = true;
      resolve({ kind: b.dataset.kind, id: b.dataset.id });
      s.close();
    });
  });
}

export function paymentChip(payment) {
  if (!payment?.id) return html`${icon('wallet', { size: 16 })}<span>Elegir</span>`;
  const item = payment.kind === 'card' ? state.cards.find((c) => c.id === payment.id) : state.accounts.find((a) => a.id === payment.id);
  return html`${icon(payment.kind === 'card' ? 'card' : 'wallet', { size: 16 })}<span>${item?.name ?? 'Elegir'}</span>`;
}
