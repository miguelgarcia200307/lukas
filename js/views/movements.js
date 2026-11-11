// Movimientos: agrupados por día con total diario, búsqueda, filtros, swipe para editar/eliminar, pull-to-refresh
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { bogota, dayLabel, todayISO, addDays, startOfMonth } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, onChanged, categoryById, childCategories } from '../state.js';
import { listTransactions } from '../api/transactions.js';
import { topbar, bindTopbar, txRow, segmented, selectSegment } from '../ui/common.js';
import { skRows } from '../ui/skeleton.js';
import { emptyState } from '../ui/empty.js';
import { enableSwipe, pullToRefresh } from '../ui/gestures.js';
import { openSheet } from '../ui/sheet.js';
import { pickCategory } from '../ui/pickers.js';
import { toast } from '../ui/toast.js';
import { openTransactionForm, openTransactionDetail, deleteWithUndo } from './transaction-form.js';

export const title = 'Movimientos';
const PAGE = 60;
const filters = { type: '', categoryId: '', source: '', from: '', to: '', search: '' }; // se conserva entre visitas

export function mount(screen, { query }) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Movimientos', large: true, right: html`<button class="icon-btn filled" data-new aria-label="Nuevo movimiento">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller">
      <div class="content">
        <div class="search-row">
          <div class="search-field grow">${icon('search', { size: 18 })}<input class="input" type="search" placeholder="Buscar" value="${filters.search}" aria-label="Buscar movimientos" enterkeyhint="search"></div>
          <button class="icon-btn filled" data-filters aria-label="Filtros">${icon('filter')}<span class="badge-dot" data-fcount hidden></span></button>
        </div>
        <div class="chips scroll active-filters"></div>
        <div class="mv-summary"></div>
        <div class="mv-list">${skRows(6)}</div>
        <div class="mv-more center"></div>
      </div>
    </div>`);

  const listEl = screen.querySelector('.mv-list');
  const moreEl = screen.querySelector('.mv-more');
  const summaryEl = screen.querySelector('.mv-summary');
  const scroller = screen.querySelector('.scroller');
  let rows = [];
  let done = false;
  let loading = false;

  const activeCount = () => ['type', 'categoryId', 'source', 'from'].filter((k) => filters[k]).length;
  const paintFilterChips = () => {
    const chips = [];
    if (filters.type) chips.push(['type', { expense: 'Gastos', income: 'Ingresos', transfer: 'Transferencias' }[filters.type]]);
    if (filters.categoryId) chips.push(['categoryId', categoryById(filters.categoryId)?.name ?? 'Categoría']);
    if (filters.source) {
      const [k, id] = filters.source.split(':');
      chips.push(['source', (k === 'card' ? state.cards : state.accounts).find((x) => x.id === id)?.name ?? 'Cuenta']);
    }
    if (filters.from) chips.push(['from', `${filters.from.slice(5)} → ${filters.to.slice(5)}`]);
    screen.querySelector('.active-filters').innerHTML = String(html`${chips.map(([k, l]) => html`<button class="chip selected" data-clear="${k}">${l}${icon('x', { size: 14 })}</button>`)}`);
    const badge = screen.querySelector('[data-fcount]');
    badge.hidden = !activeCount();
    badge.textContent = String(activeCount());
  };

  const query_ = (offset) => {
    const [k, id] = (filters.source || ':').split(':');
    const cat = filters.categoryId ? [filters.categoryId, ...childCategories(filters.categoryId).map((c) => c.id)] : undefined;
    return listTransactions({
      type: filters.type || undefined, categoryIds: cat, accountId: k === 'account' ? id : undefined, cardId: k === 'card' ? id : undefined,
      from: filters.from || undefined, to: filters.to || undefined, search: filters.search || undefined, limit: PAGE, offset,
    });
  };

  const render = () => {
    if (!rows.length) {
      const filtered = activeCount() || filters.search;
      listEl.innerHTML = String(filtered
        ? emptyState({ illus: 'search', title: 'Nada por aquí', text: 'No hay movimientos con esos filtros.', action: { label: 'Quitar filtros', attrs: 'data-clear-all' } })
        : emptyState({ illus: 'list', title: 'Aún no tienes movimientos', text: 'Registra el primero con tu voz o a mano.', action: { label: 'Agregar movimiento', attrs: 'data-new' } }));
      summaryEl.innerHTML = '';
      moreEl.innerHTML = '';
      return;
    }
    const groups = new Map();
    for (const t of rows) {
      const d = bogota(new Date(t.occurred_at)).date;
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(t);
    }
    let i = 0;
    listEl.innerHTML = String(html`${[...groups.entries()].map(([d, txs]) => {
      const out = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      const inc = txs.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      return html`<div class="day-group" style="--i:${Math.min(i++, 8)}">
        <div class="day-head"><span class="d">${dayLabel(d)}</span><span class="t">${out ? `−${money(out)}` : ''}${out && inc ? ' · ' : ''}${inc ? html`<span class="income">+${money(inc)}</span>` : ''}</span></div>
        <div class="list">${txs.map((t) => txRow(t, { swipe: true }))}</div>
      </div>`;
    })}`);
    const exp = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const inc = rows.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    summaryEl.innerHTML = String(activeCount() || filters.search ? html`<div class="mv-totals">
      <span>${rows.length}${done ? '' : '+'} movimientos</span><span>Gastos <b class="num">${money(exp)}</b></span><span>Ingresos <b class="num income">${money(inc)}</b></span></div>` : '');
    moreEl.innerHTML = done ? '' : String(html`<button class="btn btn-ghost btn-sm" data-more>Cargar más</button>`);
  };

  const load = async ({ append = false } = {}) => {
    if (loading) return;
    loading = true;
    try {
      const batch = await query_(append ? rows.length : 0);
      rows = append ? [...rows, ...batch] : batch;
      done = batch.length < PAGE;
      render();
    } catch (err) {
      toast(err.message, { type: 'err' });
      if (!rows.length) listEl.innerHTML = String(emptyState({ illus: 'list', title: 'No pudimos cargar tus movimientos', text: err.message, action: { label: 'Reintentar', attrs: 'data-retry' } }));
    } finally {
      loading = false;
    }
  };

  const openFilters = () => {
    const local = { ...filters };
    const src = [...state.accounts.map((a) => ({ v: `account:${a.id}`, l: a.name })), ...state.cards.map((c) => ({ v: `card:${c.id}`, l: c.name }))];
    const today = todayISO();
    const ranges = [
      ['', 'Todo'], ['7', 'Últimos 7 días'], ['month', 'Este mes'], ['30', 'Últimos 30 días'], ['90', 'Últimos 3 meses'],
    ];
    const s = openSheet({
      title: 'Filtros',
      detent: 'large',
      body: html`<div class="stack gap-6">
        <div><div class="eyebrow mb-2">Tipo</div>${segmented('ftype', [{ value: '', label: 'Todos' }, { value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }, { value: 'transfer', label: 'Transf.' }], local.type)}</div>
        <div><div class="eyebrow mb-2">Categoría</div>
          <button class="pick-btn" data-fcat>${local.categoryId ? categoryById(local.categoryId)?.name : 'Todas las categorías'}${icon('chevron-right', { size: 18 })}</button></div>
        <div><div class="eyebrow mb-2">Cuenta o tarjeta</div>
          <select class="input" data-fsrc><option value="">Todas</option>${src.map((o) => html`<option value="${o.v}" ${o.v === local.source ? 'selected' : ''}>${o.l}</option>`)}</select></div>
        <div><div class="eyebrow mb-2">Fechas</div>
          <div class="chips">${ranges.map(([v, l]) => html`<button class="chip" data-range="${v}">${l}</button>`)}</div>
          <div class="input-row mt-3"><input class="input" type="date" data-from value="${local.from}" aria-label="Desde"><input class="input" type="date" data-to value="${local.to}" aria-label="Hasta"></div></div>
      </div>`,
      footer: html`<button class="btn btn-ghost" data-reset>Limpiar</button><button class="btn btn-primary grow" data-apply>Ver resultados</button>`,
    });
    on(s.body, 'click', '[data-seg] button', (e, b) => { local.type = selectSegment(b.parentElement, b.dataset.value); haptic.select(); });
    on(s.body, 'click', '[data-fcat]', async (e, b) => {
      const id = await pickCategory({ kind: local.type === 'income' ? 'income' : 'expense', selected: local.categoryId });
      if (id) { local.categoryId = id; b.firstChild.textContent = categoryById(id)?.name; }
    });
    on(s.body, 'click', '[data-range]', (e, b) => {
      const v = b.dataset.range;
      local.from = v === '' ? '' : v === 'month' ? startOfMonth(today) : addDays(today, -Number(v) + 1);
      local.to = v === '' ? '' : today;
      s.body.querySelector('[data-from]').value = local.from;
      s.body.querySelector('[data-to]').value = local.to;
      haptic.select();
    });
    s.body.querySelector('[data-fsrc]').addEventListener('change', (e) => { local.source = e.target.value; });
    s.body.querySelector('[data-from]').addEventListener('change', (e) => { local.from = e.target.value; local.to ||= todayISO(); });
    s.body.querySelector('[data-to]').addEventListener('change', (e) => { local.to = e.target.value; });
    s.foot.querySelector('[data-reset]').addEventListener('click', () => {
      Object.assign(filters, { type: '', categoryId: '', source: '', from: '', to: '' });
      s.close(); paintFilterChips(); load();
    });
    s.foot.querySelector('[data-apply]').addEventListener('click', () => {
      if (local.from && !local.to) local.to = todayISO();
      Object.assign(filters, local);
      s.close(); paintFilterChips(); listEl.innerHTML = String(skRows(5)); load();
    });
  };

  let searchT;
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openTransactionForm()),
    on(screen, 'click', '[data-filters]', openFilters),
    on(screen, 'click', '[data-more]', () => load({ append: true })),
    on(screen, 'click', '[data-retry]', () => load()),
    on(screen, 'click', '[data-clear]', (e, b) => {
      const k = b.dataset.clear;
      filters[k] = '';
      if (k === 'from') filters.to = '';
      paintFilterChips(); load();
    }),
    on(screen, 'click', '[data-clear-all]', () => {
      Object.assign(filters, { type: '', categoryId: '', source: '', from: '', to: '', search: '' });
      screen.querySelector('input[type="search"]').value = '';
      paintFilterChips(); load();
    }),
    on(screen, 'input', 'input[type="search"]', (e, inp) => {
      clearTimeout(searchT);
      searchT = setTimeout(() => { filters.search = inp.value.trim(); load(); }, 280);
    }),
    on(screen, 'click', '[data-tx]', (e, b) => openTransactionDetail(b.dataset.tx)),
    enableSwipe(listEl, {
      edit: (id) => openTransactionDetail(id),
      delete: async (id) => {
        const tx = rows.find((r) => r.id === id);
        if (!tx) return;
        const row = listEl.querySelector(`.swipe[data-id="${id}"]`);
        row?.classList.add('removing');
        try { await deleteWithUndo([tx]); } catch (err) { row?.classList.remove('removing'); toast(err.message, { type: 'err' }); }
      },
    }),
    pullToRefresh(scroller, () => load()),
    onChanged((ents) => { if (ents.includes('transactions')) load(); }),
  ];

  // Carga automática al acercarse al final
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !done && rows.length) load({ append: true });
  }, { root: scroller, rootMargin: '400px' });
  io.observe(moreEl);

  paintFilterChips();
  load();
  if (query.nuevo === '1') setTimeout(() => openTransactionForm(), 300);

  return () => { offs.forEach((f) => f()); io.disconnect(); clearTimeout(searchT); };
}
