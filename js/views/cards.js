// Tarjetas de crédito: resumen fijo (deuda, cupo, disponible, uso global, próximo pago y "¿con cuál pago hoy?"),
// tres vistas (pila tipo Wallet, lista compacta y carrusel), tarjetas premium con giro 3D, personalización,
// reordenar arrastrando, menú contextual al mantener presionado, pagos rápidos y modo privado.
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, percent } from '../utils/format.js';
import { todayISO } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { reducedMotion } from '../utils/motion.js';
import { state, subscribe } from '../state.js';
import { createCard, updateCard, deleteCard, reorderCards } from '../api/cards.js';
import { refresh } from '../api/catalog.js';
import { bindTopbar } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';
import { actionMenu } from '../ui/action-menu.js';
import { openSheet } from '../ui/sheet.js';
import { enablePressDrag, enableRowSwipe, pullToRefresh } from '../ui/gestures.js';
import { toast } from '../ui/toast.js';
import { isHidden, toggle as togglePrivacy, onPrivacyChange } from '../privacy.js';
import { sensitiveAmount } from '../ui/sensitive.js';
import { needsUnlock, unlock } from '../ui/bio-lock.js';
import { creditCard, cardLabel, bankColor, relDate } from '../ui/card-art.js';
import { usageTone, nextPayment, bestCardToday, diffDays } from '../utils/card-pick.js';
import {
  openPay, openPersonalize, openInstallments, openSimulator, openReminders, openBreakdown, openBest, pickCard,
  patchLocal, countTo, shortName, cardThumb,
} from './card-sheets.js';

export const title = 'Tarjetas';

const PRIV = 'creditCards';
const STRIP = 48; // franja visible de cada tarjeta apilada (6 tarjetas caben sin scroll en 390×844)
const ACTS = 72; // barra de acciones bajo la tarjeta abierta (12 + 48 + 12)
const UI_KEY = 'lukas-cards-ui';
const VIEWS = [['stack', 'layers', 'Vista apilada'], ['list', 'list', 'Vista lista'], ['carousel', 'card', 'Vista carrusel']];
const SORTS = [['due', 'Próximo pago'], ['debt', 'Deuda'], ['usage', '% de uso'], ['name', 'Nombre'], ['custom', 'Personalizado']];

const readUI = () => { try { return { view: 'stack', sort: 'due', ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; } catch { return { view: 'stack', sort: 'due' }; } };
const saveUI = (ui) => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* modo privado */ } };
const debtOf = (c) => Math.max(0, Number(c.debt) || 0);

let cssReady = null;
function ensureCss() {
  if (cssReady) return cssReady;
  cssReady = new Promise((resolve) => {
    if ([...document.styleSheets].some((s) => s.href?.endsWith('/css/cards.css'))) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../css/cards.css', import.meta.url).href;
    link.onload = resolve; link.onerror = resolve;
    document.head.appendChild(link);
    setTimeout(resolve, 1500);
  });
  return cssReady;
}

// ───────────────────────── piezas compartidas con el detalle de la tarjeta ─────────────────────────
/** Tarjeta (frente) para el detalle; vuela desde la lista con una transición compartida */
export function plastic(c, { hero = true } = {}) {
  ensureCss();
  return creditCard(c, { hidden: isHidden(PRIV), today: todayISO(), attrs: hero ? 'style="view-transition-name:cc-hero"' : '' });
}

/** Cupo, disponible, uso con color semántico y fechas relativas + absolutas */
export function cardStats(c, { hidden = isHidden(PRIV), actions = false } = {}) {
  const today = todayISO();
  const usage = Number(c.usage_pct) || 0;
  const tone = usageTone(usage);
  const dCut = c.next_cut_date ? diffDays(today, c.next_cut_date) : null;
  const dDue = c.next_due_date ? diffDays(today, c.next_due_date) : null;
  return html`<div class="cs2 mt-4">
    <div class="cs2-figs">
      <div><span class="eyebrow">Cupo</span><b class="num">${sensitiveAmount(c.credit_limit, { hidden })}</b></div>
      <div><span class="eyebrow">Disponible</span><b class="num ${Number(c.available) < 0 ? 'expense-txt' : ''}">${sensitiveAmount(c.available, { hidden })}</b></div>
      <div><span class="eyebrow">Uso</span><b class="num tone-txt-${tone}">${percent(usage)}</b></div>
    </div>
    <div class="cs2-bar tone-${tone}" role="progressbar" aria-valuenow="${Math.round(usage)}" aria-valuemin="0" aria-valuemax="100" aria-label="Uso del cupo"><span style="--p:${Math.min(100, usage)}%"></span></div>
    <div class="cs2-dates">
      ${c.next_cut_date ? html`<span class="tag ${dCut <= 1 ? 'warn' : ''}">${icon('calendar', { size: 12 })}${relDate('Corte', c.next_cut_date, today)}</span>` : ''}
      ${c.next_due_date ? html`<span class="tag ${dDue <= 0 && debtOf(c) ? 'danger' : dDue <= 5 && debtOf(c) ? 'warn' : ''}">${icon('clock', { size: 12 })}${relDate('Pago', c.next_due_date, today)}</span>` : ''}
      ${Number(c.installments_count) ? html`<span class="tag">${icon('layers', { size: 12 })}${c.installments_count} ${Number(c.installments_count) === 1 ? 'compra' : 'compras'} a cuotas · ${hidden ? '$••••' : money(c.installments_monthly)}/mes</span>` : ''}
    </div>
    ${actions ? html`<div class="cs2-acts">
      <button class="w-act primary" data-act="pay" data-id="${c.id}">${icon('check')}Pagar</button>
      <button class="w-act" data-act="movements" data-id="${c.id}">${icon('list')}Movimientos</button>
      <button class="w-act" data-act="installments" data-id="${c.id}">${icon('layers')}Cuotas</button>
      <button class="w-act" data-act="more" data-id="${c.id}" aria-haspopup="menu">${icon('dots')}Más</button></div>` : ''}
  </div>`;
}

export function openCardForm(card = null) {
  return formSheet({
    title: card ? 'Editar tarjeta' : 'Nueva tarjeta de crédito',
    fields: [
      { name: 'name', label: 'Nombre del producto', value: card?.name, required: true, placeholder: 'Ej. CMR Falabella, Visa Platinum' },
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
      { name: 'min_payment', label: 'Pago mínimo (opcional)', type: 'amount', value: card?.min_payment ?? '', hint: 'El de tu extracto. Si no lo pones, lo estimo.' },
      { name: 'monthly_rate', label: 'Tasa de interés mensual (opcional)', type: 'percent', value: card?.monthly_rate ?? '', hint: 'Sirve para estimar intereses y el simulador.' },
    ],
    onSubmit: async (v) => {
      const row = { ...v, last4: v.last4 || null, bank: v.bank || null, min_payment: v.min_payment || null };
      if (card) await updateCard(card.id, row);
      else await createCard({ ...row, color: bankColor(row) ?? '#1D1D1B' });
      toast(card ? 'Tarjeta actualizada' : 'Tarjeta agregada');
    },
    onDelete: card ? async () => { await deleteCard(card.id); toast('Tarjeta eliminada'); location.hash = '#/tarjetas'; } : null,
    deleteConfirm: { title: '¿Eliminar esta tarjeta?', message: 'Se borra su historial de movimientos. Los gastos hechos con ella se conservan.' },
  });
}

// ───────────────────────── orden ─────────────────────────
function sortCards(list, sort) {
  const by = {
    due: (a, b) => (debtOf(b) > 0) - (debtOf(a) > 0) || String(a.next_due_date).localeCompare(String(b.next_due_date)) || debtOf(b) - debtOf(a),
    debt: (a, b) => debtOf(b) - debtOf(a),
    usage: (a, b) => (Number(b.usage_pct) || 0) - (Number(a.usage_pct) || 0),
    name: (a, b) => String(a.nickname || a.name).localeCompare(String(b.nickname || b.name), 'es'),
    custom: (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.created_at).localeCompare(String(b.created_at)),
  }[sort] ?? (() => 0);
  return [...list].sort((a, b) => (!!b.pinned - !!a.pinned) || by(a, b));
}

const usageRingBig = (pct, tone) => {
  const size = 60, stroke = 6, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return html`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="30" cy="30" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
    <circle class="ring-val tone-${tone}" cx="30" cy="30" r="${r}" fill="none" stroke="var(--tone)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-target="${(c * (1 - Math.min(100, pct) / 100)).toFixed(2)}" transform="rotate(-90 30 30)"/></svg>`;
};

const whenText = (d) => (d < 0 ? `vencido hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

// ───────────────────────── pantalla ─────────────────────────
export function mount(screen, { query = {} } = {}) {
  ensureCss();
  const ui = readUI();
  let expanded = null; // id abierta en la pila
  const flipped = new Set();
  let peek = false; // mostrar montos mientras se sostiene el ojo
  let showArchived = false;
  let loaded = state.cards.length > 0;
  let carouselIdx = 0;
  const pendingDelete = new Map(); // id → timer (se borra a los 5 s si no se deshace)
  let prevTotals = null;
  let tapTimer = 0;

  screen.innerHTML = String(html`
    <header class="topbar cx-topbar">
      <div class="topbar-inner">
        <button class="icon-btn" data-back aria-label="Volver">${icon('chevron-left', { stroke: 2.2 })}</button>
        <h1 class="sr-only">Tarjetas</h1>
        <div class="cx-title"><div class="cx-views" role="group" aria-label="Vista"><span class="thumb" aria-hidden="true"></span>
          ${VIEWS.map(([v, ic, label]) => html`<button data-view="${v}" aria-label="${label}" aria-pressed="false">${icon(ic)}</button>`)}</div>
          <div class="cx-mini" aria-hidden="true"></div></div>
        <button class="icon-btn cx-eye" data-eye aria-label="Ocultar montos" aria-pressed="false">${icon('eye')}</button>
        <button class="icon-btn filled" data-new aria-label="Agregar tarjeta">${icon('plus', { stroke: 2.2 })}</button>
      </div>
    </header>
    <div class="scroller"><div class="content"><div class="cx-body"></div></div></div>
    <div class="cx-veil" hidden aria-hidden="true">${icon('lock', { size: 32 })}</div>
    <div class="cx-lock" hidden><div><div class="lock-ic">${icon('lock')}</div><h2>Tarjetas bloqueadas</h2><p>Usa Face ID o tu huella para ver tus tarjetas.</p>
      <button class="btn btn-primary" data-unlock>Desbloquear</button></div></div>`);
  const scroller = screen.querySelector('.scroller');
  const body = screen.querySelector('.cx-body');
  const bar = screen.querySelector('.cx-topbar');
  const mini = screen.querySelector('.cx-mini');
  const eye = screen.querySelector('[data-eye]');
  const today = () => todayISO();
  const hidden = () => isHidden(PRIV) && !peek;
  const active = () => sortCards(state.cards.filter((c) => !c.archived && !pendingDelete.has(c.id)), ui.sort);
  const archived = () => state.cards.filter((c) => c.archived && !pendingDelete.has(c.id));
  const find = (id) => state.cards.find((c) => c.id === id);

  // ── Encabezado de resumen ──
  const totalsOf = (cards) => {
    const debt = cards.reduce((s, c) => s + debtOf(c), 0);
    const limit = cards.reduce((s, c) => s + (Number(c.credit_limit) || 0), 0);
    const avail = cards.reduce((s, c) => s + (Number(c.available) || 0), 0);
    return { debt, limit, avail, usage: limit > 0 ? (debt * 100) / limit : 0 };
  };
  const headHtml = (cards) => {
    const t = totalsOf(cards);
    const tone = usageTone(t.usage);
    const np = nextPayment(cards, today());
    const best = cards.length > 1 ? bestCardToday(cards, today()) : null;
    const h = hidden();
    return html`<section class="cx-head" aria-label="Resumen de tarjetas">
      <div class="cx-sum">
        <button class="cx-total" data-fig="debt" aria-label="${h ? 'Deuda total oculta' : `Deuda total ${money(t.debt)}`}. Ver desglose">
          <span class="eyebrow">Deuda total</span><b class="num" data-total="debt">${sensitiveAmount(t.debt, { hidden: h })}</b></button>
        <div class="cx-ring tone-${tone}" role="img" aria-label="Uso global ${Math.round(t.usage)} por ciento">${usageRingBig(t.usage, tone)}<span><b class="num">${percent(t.usage)}</b><small>uso</small></span></div>
      </div>
      <div class="cx-figs">
        <button class="cx-fig" data-fig="limit">Cupo <b class="num" data-total="limit">${sensitiveAmount(t.limit, { hidden: h })}</b></button>
        <button class="cx-fig" data-fig="avail">Disponible <b class="num" data-total="avail">${sensitiveAmount(t.avail, { hidden: h })}</b></button>
        <button class="cx-sort ${ui.sort === 'due' ? '' : 'on'}" data-sort aria-haspopup="menu" aria-label="Ordenar: ${SORTS.find(([k]) => k === ui.sort)?.[1] ?? ''}">${icon('filter')}</button>
      </div>
      <div class="cx-pills">
        ${np ? html`<button class="cx-pill ${np.tone === 'ok' ? '' : np.tone}" data-next="${np.card.id}" aria-label="Próximo pago: ${shortName(np.card)}, ${h ? 'monto oculto' : money(np.amount)}, ${whenText(np.days)}. Registrar pago">
            <span class="pi">${icon(np.tone === 'danger' ? 'alert' : 'clock')}</span><span><b>${shortName(np.card)}</b> · ${sensitiveAmount(np.amount, { hidden: h })} · ${whenText(np.days)}</span></button>`
          : html`<span class="cx-pill"><span class="pi">${icon('check')}</span>Sin pagos pendientes</span>`}
        ${best ? html`<button class="cx-pill best" data-best aria-label="¿Con cuál pago hoy? ${shortName(best.card)}: ${best.daysToPay} días para pagar">
            <span class="pi">${icon('sparkles')}</span><span>Hoy paga con <b>${shortName(best.card)}</b> · ${best.daysToPay} días</span></button>` : ''}
      </div>
    </section>`;
  };

  // ── Vista apilada ──
  const stackHtml = (cards) => html`<div class="wallet" role="list" aria-label="Tarjetas apiladas">
      ${cards.map((c, i) => html`<div class="w-item" role="listitem" data-id="${c.id}" style="--z:${i + 1}">
        <div role="button" tabindex="0" class="w-hit" aria-expanded="false" aria-label="${cardLabel(c, { hidden: hidden(), today: today() })}">
          ${c.pinned ? html`<span class="w-pin" aria-hidden="true">${icon('pin')}</span>` : ''}
          ${creditCard(c, { hidden: hidden(), today: today(), flipped: flipped.has(c.id) })}</div></div>`)}
      <div class="w-actions" aria-hidden="true">
        <button class="w-act primary" data-act="pay">${icon('check')}Pagar</button>
        <button class="w-act" data-act="flip">${icon('repeat')}Girar</button>
        <button class="w-act" data-act="movements">${icon('list')}Movimientos</button>
        <button class="w-act" data-act="more" aria-haspopup="menu">${icon('dots')}Más</button>
      </div></div>
    <p class="wallet-hint">${cards.length > 1 ? 'Toca una tarjeta para abrirla · mantén presionado para más opciones o para moverla' : 'Toca la tarjeta para abrirla · doble toque para girarla'}</p>`;

  const cardH = (wallet) => (wallet.clientWidth || 340) / 1.586;
  /** Posiciones de la pila; order = ids en orden visual (para reordenar) */
  const layout = (order = null) => {
    const wallet = body.querySelector('.wallet');
    if (!wallet) return;
    const items = [...wallet.querySelectorAll('.w-item')];
    const ids = order ?? items.map((n) => n.dataset.id);
    const H = cardH(wallet);
    const e = ids.indexOf(expanded);
    let y = 0;
    ids.forEach((id, i) => {
      const node = items.find((n) => n.dataset.id === id);
      if (!node) return;
      if (!node.classList.contains('reordering')) node.style.setProperty('--y', `${y}px`);
      node.style.setProperty('--z', String(i + 1));
      node.dataset.y = String(y);
      const hit = node.querySelector('.w-hit');
      hit?.setAttribute('aria-expanded', String(id === expanded));
      y += i === e ? H + ACTS : STRIP;
    });
    const last = ids.length - 1;
    const height = ids.length ? (last === e ? y : y - STRIP + H) : 0;
    wallet.style.height = `${Math.max(0, height)}px`;
    const acts = wallet.querySelector('.w-actions');
    if (acts) {
      acts.classList.toggle('show', e >= 0);
      acts.setAttribute('aria-hidden', String(e < 0));
      acts.querySelectorAll('button').forEach((b) => { b.tabIndex = e >= 0 ? 0 : -1; });
      if (e >= 0) acts.style.setProperty('--y', `${Number(items.find((n) => n.dataset.id === expanded)?.dataset.y || 0) + H + 12}px`);
    }
  };
  const setExpanded = (id) => {
    const was = expanded;
    expanded = id;
    if (was && was !== id && flipped.has(was)) { flipped.delete(was); body.querySelector(`.w-item[data-id="${was}"] .cc`)?.classList.remove('flipped'); }
    layout();
    if (id) {
      haptic.tap();
      if ((Number(find(id)?.usage_pct) || 0) > 90) haptic.warning();
    }
  };
  const flip = (id) => {
    const node = body.querySelector(`[data-id="${id}"] .cc`) ?? body.querySelector(`.cr-item[data-id="${id}"] .cc`);
    if (!node) return;
    if (flipped.has(id)) flipped.delete(id); else flipped.add(id);
    node.classList.toggle('flipped', flipped.has(id));
    node.querySelectorAll('.cb-act').forEach((b) => { b.tabIndex = flipped.has(id) ? 0 : -1; });
    node.querySelector('.cc-back')?.setAttribute('aria-hidden', String(!flipped.has(id)));
    haptic.select();
  };

  // ── Vista lista ──
  const listHtml = (cards) => html`<div class="list cl" role="list">${cards.map((c) => {
    const tone = usageTone(c.usage_pct);
    const d = c.next_due_date ? diffDays(today(), c.next_due_date) : null;
    const dueCls = debtOf(c) && d != null ? (d <= 0 ? 'danger' : d <= 5 ? 'warn' : '') : '';
    return html`<div class="cl-row" role="listitem" data-id="${c.id}">
      <div class="cl-acts left" aria-hidden="true"><button class="a-mov" data-act="movements" tabindex="-1">${icon('list')}Movimientos</button>
        <button class="a-pin" data-act="pin" tabindex="-1">${icon('pin')}${c.pinned ? 'Desfijar' : 'Fijar'}</button></div>
      <div class="cl-acts right" aria-hidden="true"><button class="a-pay" data-act="pay" tabindex="-1">${icon('check')}Pagar</button>
        <button class="a-more" data-act="more" tabindex="-1">${icon('dots')}Más</button></div>
      <button class="cl-main" data-open aria-label="${cardLabel(c, { hidden: hidden(), today: today() })}">
        ${cardThumb(c)}
        <div class="cl-info"><div class="cl-title ellipsis">${c.pinned ? html`<span class="pin" aria-hidden="true">${icon('pin')}</span>` : ''}${c.nickname || c.name}</div>
          <div class="cl-sub ellipsis">${[c.bank, c.last4 ? `•••• ${c.last4}` : null].filter(Boolean).join(' · ')}</div>
          <div class="cl-bar tone-${tone}"><span style="--p:${Math.min(100, Number(c.usage_pct) || 0)}%"></span></div></div>
        <div class="cl-right"><b class="num">${sensitiveAmount(debtOf(c), { hidden: hidden() })}</b>
          <span class="${dueCls}">${d == null ? '' : debtOf(c) ? `Pago ${whenText(d)}` : `${percent(c.usage_pct)} de uso`}</span></div>
      </button></div>`;
  })}</div>`;

  // ── Vista carrusel ──
  const carouselHtml = (cards) => {
    carouselIdx = Math.min(carouselIdx, cards.length - 1);
    return html`<div class="cr-track" role="list" aria-label="Tarjetas">${cards.map((c, i) => html`<div class="cr-item ${i === carouselIdx ? 'on' : ''}" role="listitem" data-id="${c.id}">
        <div role="button" tabindex="0" class="w-hit" aria-label="${cardLabel(c, { hidden: hidden(), today: today() })}. Toca para girarla">${creditCard(c, { hidden: hidden(), today: today(), flipped: flipped.has(c.id) })}</div></div>`)}</div>
      <div class="cr-dots" aria-hidden="true">${cards.map((c, i) => html`<i class="${i === carouselIdx ? 'on' : ''}"></i>`)}</div>
      <div class="cr-detail" aria-live="polite">${cards[carouselIdx] ? cardStats(cards[carouselIdx], { hidden: hidden(), actions: true }) : ''}</div>`;
  };

  const skeletonHtml = () => html`<div class="cx-head"><div class="sk" style="height:14px;width:90px"></div><div class="sk mt-2" style="height:32px;width:200px"></div>
      <div class="sk mt-2" style="height:14px;width:240px"></div><div class="sk mt-4" style="height:40px;width:260px;border-radius:20px"></div></div>
    <div class="sk-stack mt-6" style="height:${STRIP * 3 + 214}px">${[0, 1, 2, 3].map((i) => html`<div class="sk sk-card" style="top:${i * STRIP}px"></div>`)}</div>`;

  const archivedHtml = () => {
    const list = archived();
    if (!list.length) return '';
    return html`<div class="cx-arch">
      <button class="cx-arch-toggle" data-arch aria-expanded="${String(showArchived)}"><span class="section-title">Archivadas <span class="muted">${list.length}</span></span>${icon('chevron-down', { size: 20 })}</button>
      ${showArchived ? html`<div class="list">${list.map((c) => html`<div class="list-row"><span>${cardThumb(c)}</span><div class="grow"><div class="row-title ellipsis">${c.nickname || c.name}</div><div class="row-sub">${c.bank ?? ''}</div></div>
        <button class="icon-btn" data-arch-menu="${c.id}" aria-label="Opciones de ${c.nickname || c.name}" aria-haspopup="menu">${icon('dots')}</button></div>`)}</div>` : ''}
    </div>`;
  };

  // ── Render ──
  const render = () => {
    const cards = active();
    eye.setAttribute('aria-pressed', String(isHidden(PRIV)));
    eye.setAttribute('aria-label', isHidden(PRIV) ? 'Mostrar montos (mantén presionado para ver sin cambiar)' : 'Ocultar montos');
    eye.innerHTML = String(icon(isHidden(PRIV) ? 'eye-off' : 'eye'));
    eye.classList.toggle('on', isHidden(PRIV));
    const views = screen.querySelector('.cx-views');
    views.style.setProperty('--vi', String(Math.max(0, VIEWS.findIndex(([v]) => v === ui.view))));
    views.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
    views.hidden = !active().length;
    if (!loaded && !cards.length) { body.innerHTML = String(skeletonHtml()); return; }
    if (!cards.length) {
      body.innerHTML = String(html`${emptyState({ illus: 'cards', title: 'Aún no tienes tarjetas', text: 'Agrega tu primera tarjeta y te aviso antes del corte y del pago, y te digo con cuál te conviene comprar.', action: { label: 'Agregar tu primera tarjeta', attrs: 'data-new' } })}${archivedHtml()}`);
      mini.innerHTML = '';
      return;
    }
    if (expanded && !cards.some((c) => c.id === expanded)) expanded = null;
    const view = ui.view === 'list' ? listHtml(cards) : ui.view === 'carousel' ? carouselHtml(cards) : stackHtml(cards);
    body.innerHTML = String(html`${headHtml(cards)}<div class="cx-view" data-view-root="${ui.view}">${view}</div>${archivedHtml()}`);
    const t = totalsOf(cards);
    const np = nextPayment(cards, today());
    mini.innerHTML = String(html`<b class="num">${hidden() ? 'Deuda oculta' : `Debes ${money(t.debt)}`}</b><span>${np ? `${shortName(np.card)} · ${whenText(np.days)}` : 'Sin pagos pendientes'}</span>`);
    // cifras que cuentan hasta su valor y anillos que se llenan
    if (!hidden()) {
      ['debt', 'limit', 'avail'].forEach((k) => {
        const n = body.querySelector(`[data-total="${k}"] .sens`);
        if (n && prevTotals && prevTotals[k] !== t[k]) countTo(n, prevTotals[k], t[k]);
      });
    }
    prevTotals = t;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      body.querySelectorAll('.cx-ring .ring-val').forEach((c) => { c.style.strokeDashoffset = c.dataset.target; });
    }));
    if (ui.view === 'stack') layout();
    if (ui.view === 'carousel') bindCarousel();
  };

  // ── Carrusel: índice, puntos, parallax del brillo ──
  let crOff = null;
  const bindCarousel = () => {
    crOff?.();
    const track = body.querySelector('.cr-track');
    if (!track) return;
    const items = [...track.querySelectorAll('.cr-item')];
    requestAnimationFrame(() => { const it = items[carouselIdx]; if (it) track.scrollLeft = it.offsetLeft - (track.clientWidth - it.clientWidth) / 2; });
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = track.scrollLeft + track.clientWidth / 2;
        let best = 0, bestD = Infinity;
        items.forEach((it, i) => {
          const center = it.offsetLeft + it.clientWidth / 2;
          const rel = (center - mid) / it.clientWidth; // -1..1
          if (!reducedMotion()) it.style.setProperty('--sx', String(Math.round(40 - rel * 45)));
          if (Math.abs(rel) < bestD) { bestD = Math.abs(rel); best = i; }
        });
        if (best !== carouselIdx) {
          carouselIdx = best;
          haptic.select();
          items.forEach((it, i) => it.classList.toggle('on', i === best));
          body.querySelectorAll('.cr-dots i').forEach((d, i) => d.classList.toggle('on', i === best));
          const c = find(items[best].dataset.id);
          const det = body.querySelector('.cr-detail');
          if (c && det) { det.innerHTML = String(cardStats(c, { hidden: hidden(), actions: true })); det.style.animation = 'none'; void det.offsetWidth; det.style.animation = ''; }
        }
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    crOff = () => track.removeEventListener('scroll', onScroll);
  };

  // ── Acciones ──
  const goMovements = (id) => {
    body.querySelectorAll('[style*="view-transition-name"]').forEach((n) => n.style.removeProperty('view-transition-name'));
    const node = body.querySelector(`[data-id="${id}"] .cc`);
    if (node && !reducedMotion()) node.style.viewTransitionName = 'cc-hero'; // la tarjeta "vuela" al detalle
    location.hash = `#/tarjetas/${id}`;
  };
  const setPinned = async (c, pinned) => {
    patchLocal(c.id, { pinned });
    haptic.tap();
    toast(pinned ? 'Fijada arriba' : 'Ya no está fijada', { type: 'info' });
    try { await updateCard(c.id, { pinned }); } catch (e) { patchLocal(c.id, { pinned: !pinned }); toast(e.message || 'No se pudo guardar', { type: 'err' }); }
  };
  const archive = async (c, value = true) => {
    patchLocal(c.id, { archived: value });
    try { await updateCard(c.id, { archived: value }); } catch (e) { patchLocal(c.id, { archived: !value }); toast(e.message || 'No se pudo guardar', { type: 'err' }); return; }
    toast(value ? 'Tarjeta archivada' : 'Tarjeta restaurada', value ? { action: { label: 'Deshacer', fn: () => archive(c, false) } } : {});
  };
  const flushDelete = (id) => {
    const t = pendingDelete.get(id);
    if (!t) return;
    clearTimeout(t);
    pendingDelete.delete(id);
    deleteCard(id).catch((e) => { toast(e.message || 'No se pudo eliminar', { type: 'err' }); render(); });
  };
  const remove = async (c) => {
    const ok = await confirmDialog({ title: `¿Eliminar ${c.nickname || c.name}?`, message: 'Se borra la tarjeta con su historial de movimientos. Los gastos hechos con ella se conservan en tus movimientos.', confirm: 'Eliminar', danger: true });
    if (!ok) return;
    if (expanded === c.id) expanded = null;
    pendingDelete.set(c.id, setTimeout(() => flushDelete(c.id), 5200));
    render();
    toast('Tarjeta eliminada', { action: { label: 'Deshacer', fn: () => { clearTimeout(pendingDelete.get(c.id)); pendingDelete.delete(c.id); render(); } } });
  };
  const copyLast4 = async (c) => {
    try { await navigator.clipboard.writeText(c.last4); haptic.tap(); toast(`Copiado: ${c.last4}`, { type: 'info' }); }
    catch { toast(`Últimos 4: ${c.last4}`, { type: 'info' }); }
  };

  const menu = async (id) => {
    const c = find(id);
    if (!c) return;
    const act = await actionMenu({
      label: `Opciones de ${c.nickname || c.name}`,
      header: html`<div class="am-card">${creditCard(c, { hidden: hidden(), today: today() })}</div>`,
      quick: [
        { id: 'pay', label: 'Pagar', icon: 'check', primary: true }, { id: 'movements', label: 'Movimientos', icon: 'list' },
        { id: 'installments', label: 'Cuotas', icon: 'layers' }, { id: 'simulate', label: 'Simular', icon: 'percent' },
      ],
      actions: c.archived ? [
        { id: 'restore', label: 'Restaurar tarjeta', icon: 'undo' },
        { id: 'delete', label: 'Eliminar', icon: 'trash', danger: true },
      ] : [
        { id: 'personalize', label: 'Personalizar (color, apodo, emoji)', icon: 'sparkles' },
        { id: 'pin', label: c.pinned ? 'Desfijar' : 'Fijar arriba', icon: 'pin' },
        ...(c.last4 ? [{ id: 'copy', label: `Copiar últimos 4 (${c.last4})`, icon: 'copy' }] : []),
        { id: 'reminders', label: 'Configurar recordatorios', icon: 'bell' },
        { id: 'edit', label: 'Editar datos (cupo, fechas, tasa)', icon: 'edit' },
        { id: 'archive', label: 'Archivar tarjeta', icon: 'archive' },
        { id: 'delete', label: 'Eliminar', icon: 'trash', danger: true },
      ],
    });
    run(act, c);
  };
  const run = (act, c) => {
    if (!act || !c) return;
    ({
      pay: () => openPay(c), movements: () => goMovements(c.id), installments: () => openInstallments(c), simulate: () => openSimulator(c),
      personalize: () => openPersonalize(c), pin: () => setPinned(c, !c.pinned), copy: () => copyLast4(c), reminders: () => openReminders(c),
      edit: () => openCardForm(c), archive: () => archive(c, true), restore: () => archive(c, false), delete: () => remove(c),
      flip: () => flip(c.id), more: () => menu(c.id),
    })[act]?.();
  };

  // Vista lista: la tarjeta en grande (toca para girarla) con su detalle y acciones
  const openCardSheet = (c) => {
    const s = openSheet({
      title: c.nickname || c.name, className: 'pay-sheet',
      body: html`<div class="w-hit" role="button" tabindex="0" data-sheet-card aria-label="${cardLabel(c, { hidden: hidden(), today: today() })}. Toca para girarla">${creditCard(c, { hidden: hidden(), today: today() })}</div>
        ${cardStats(c, { hidden: hidden(), actions: true })}`,
    });
    const flipHere = () => { const n = s.body.querySelector('.cc'); n.classList.toggle('flipped'); haptic.select(); };
    s.body.querySelector('[data-sheet-card]').addEventListener('click', (e) => {
      const a = e.target.closest('.cb-act');
      if (a) { s.close(); run(a.dataset.act, c); return; }
      flipHere();
    });
    on(s.body, 'click', '.cs2-acts [data-act]', (e, b) => { s.close(); run(b.dataset.act, c); });
  };

  // ── Reordenar arrastrando (pila y lista) ──
  let drag = null;
  const dragStart = (node, y) => {
    const isStack = node.classList.contains('w-item');
    if (isStack && expanded) { expanded = null; layout(); }
    const nodes = [...body.querySelectorAll(isStack ? '.w-item' : '.cl-row')];
    drag = { node, isStack, ids: nodes.map((n) => n.dataset.id), from: nodes.indexOf(node), to: nodes.indexOf(node), step: isStack ? STRIP : node.offsetHeight, y0: y, base: isStack ? Number(node.dataset.y) || 0 : 0 };
    node.classList.add('reordering');
  };
  const dragMove = (node, dy) => {
    if (!drag) return;
    const { isStack, ids, from, step } = drag;
    const to = Math.max(0, Math.min(ids.length - 1, Math.round(from + dy / step)));
    if (isStack) node.style.setProperty('--y', `${drag.base + dy}px`);
    else node.style.transform = `translate3d(0,${dy}px,0)`;
    if (to !== drag.to) {
      drag.to = to;
      haptic.select();
      const order = ids.filter((id) => id !== node.dataset.id);
      order.splice(to, 0, node.dataset.id);
      if (isStack) layout(order);
      else {
        body.querySelectorAll('.cl-row').forEach((r) => {
          if (r === node) return;
          const i = ids.indexOf(r.dataset.id), j = order.indexOf(r.dataset.id);
          r.classList.add('shift');
          r.style.transform = i === j ? '' : `translate3d(0,${(j - i) * step}px,0)`;
        });
      }
    }
  };
  const dragEnd = async (node) => {
    if (!drag) return;
    const { ids, to } = drag;
    const order = ids.filter((id) => id !== node.dataset.id);
    order.splice(to, 0, node.dataset.id);
    node.classList.remove('reordering');
    drag = null;
    if (order.join() === ids.join()) { render(); return; }
    haptic.tap();
    // Pasa a orden personalizado respetando lo fijado (las fijadas siguen arriba)
    order.forEach((id, i) => patchLocal(id, { sort_order: i + 1 }));
    if (ui.sort !== 'custom') { ui.sort = 'custom'; saveUI(ui); toast('Orden personalizado', { type: 'info' }); }
    render();
    try { await reorderCards([...order, ...state.cards.filter((c) => !order.includes(c.id)).map((c) => c.id)]); } catch (e) { toast(e.message || 'No se pudo guardar el orden', { type: 'err' }); }
  };

  // ── Toques ──
  const onCardTap = (id) => {
    if (ui.view === 'carousel') {
      const items = [...body.querySelectorAll('.cr-item')];
      const i = items.findIndex((n) => n.dataset.id === id);
      if (i !== carouselIdx) { const track = body.querySelector('.cr-track'); track.scrollTo({ left: items[i].offsetLeft - (track.clientWidth - items[i].clientWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' }); return; }
      flip(id);
      return;
    }
    if (expanded !== id) { clearTimeout(tapTimer); tapTimer = 0; setExpanded(id); return; }
    // tarjeta abierta: un toque la cierra; doble toque la gira
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0; flip(id); return; }
    tapTimer = setTimeout(() => { tapTimer = 0; if (flipped.has(id)) flip(id); setExpanded(null); }, 260);
  };

  // Deslizar hacia abajo la tarjeta abierta para cerrarla (sigue el dedo; si sueltas antes, regresa)
  let sd = null;
  const sdStart = (e) => {
    const item = e.target.closest('.w-item');
    if (!item || item.dataset.id !== expanded || e.touches.length !== 1 || scroller.scrollTop > 0 || e.target.closest('.cb-act')) return;
    sd = { item, y0: e.touches[0].clientY, x0: e.touches[0].clientX, dy: 0, on: false };
  };
  const sdMove = (e) => {
    if (!sd) return;
    const dy = e.touches[0].clientY - sd.y0, dx = e.touches[0].clientX - sd.x0;
    if (!sd.on) {
      if (dy > 10 && dy > Math.abs(dx) * 1.2 && !sd.item.classList.contains('lifted')) sd.on = true;
      else if (Math.abs(dx) > 10 || dy < -10) { sd = null; return; } else return;
    }
    e.preventDefault(); e.stopPropagation();
    sd.dy = Math.max(0, dy);
    sd.item.classList.add('dragging');
    sd.item.style.setProperty('--y', `${Number(sd.item.dataset.y) + sd.dy * 0.7}px`);
  };
  const sdEnd = () => {
    if (!sd) return;
    const { item, dy, on: was } = sd;
    sd = null;
    item.classList.remove('dragging');
    if (!was) return;
    if (dy > 70) { haptic.tap(); if (flipped.has(item.dataset.id)) flip(item.dataset.id); setExpanded(null); }
    else layout();
  };

  // ── Ojo de privacidad: toque = alternar (persistente); mantener = ver mientras lo sostienes ──
  let eyeT = 0, eyePeeked = false;
  const eyeDown = () => {
    eyePeeked = false;
    if (!isHidden(PRIV)) return;
    eyeT = setTimeout(() => { eyePeeked = true; peek = true; haptic.start(); render(); }, 320);
  };
  const eyeUp = () => {
    clearTimeout(eyeT);
    if (eyePeeked) { peek = false; render(); }
  };
  const eyeClick = (e) => {
    if (eyePeeked) { e.preventDefault(); eyePeeked = false; return; }
    togglePrivacy(PRIV);
    haptic.tap();
  };

  // ── Gestos e interacciones ──
  const swipeOff = enableRowSwipe(body, '.cl-row', { full: (row) => { const c = find(row.dataset.id); if (c) openPay(c); } });
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openCardForm()),
    on(body, 'click', '.w-item .w-hit, .cr-item .w-hit', (e, hit) => {
      const act = e.target.closest('.cb-act');
      const id = hit.closest('[data-id]').dataset.id;
      if (act) { e.stopPropagation(); run(act.dataset.act, find(id)); return; }
      onCardTap(id);
    }),
    on(body, 'keydown', '.w-hit', (e, hit) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardTap(hit.closest('[data-id]').dataset.id); }
    }),
    on(body, 'click', '.w-actions [data-act]', (e, b) => run(b.dataset.act, find(expanded))),
    on(body, 'click', '.cs2-acts [data-act]', (e, b) => run(b.dataset.act, find(b.dataset.id))),
    on(body, 'click', '.cl-acts [data-act]', (e, b) => run(b.dataset.act, find(b.closest('.cl-row').dataset.id))),
    on(body, 'click', '.cl-main', (e, b) => {
      const c = find(b.closest('.cl-row').dataset.id);
      if (!c) return;
      haptic.tap();
      openCardSheet(c);
    }),
    on(screen, 'click', '[data-view]', (e, b) => { if (ui.view === b.dataset.view) return; ui.view = b.dataset.view; saveUI(ui); haptic.select(); expanded = null; render(); }),
    on(body, 'click', '[data-sort]', async () => {
      const k = await actionMenu({ label: 'Ordenar por', actions: SORTS.map(([v, l]) => ({ id: v, label: l, icon: v === ui.sort ? 'check' : null })) });
      if (k && k !== ui.sort) { ui.sort = k; saveUI(ui); haptic.select(); render(); }
    }),
    on(body, 'click', '[data-fig]', (e, b) => { haptic.tap(); openBreakdown(b.dataset.fig, active(), { hidden: hidden() }); }),
    on(body, 'click', '[data-next]', (e, b) => { const c = find(b.dataset.next); if (c) openPay(c); }),
    on(body, 'click', '[data-best]', () => openBest(active(), { onPick: (id) => menu(id) })),
    on(body, 'click', '[data-arch]', () => { showArchived = !showArchived; haptic.select(); render(); }),
    on(body, 'click', '[data-arch-menu]', (e, b) => menu(b.dataset.archMenu)),
    on(screen, 'click', '[data-unlock]', () => tryUnlock()),
    enablePressDrag(body, '.w-item, .cr-item, .cl-row', {
      onMenu: (node) => menu(node.dataset.id),
      onDragStart: (node, y) => { if (!node.classList.contains('cr-item') && active().length > 1) dragStart(node, y); },
      onDragMove: (node, dy) => dragMove(node, dy),
      onDragEnd: (node) => { if (drag) dragEnd(node); else menu(node.dataset.id); },
    }, { ignore: '.cb-act, .w-actions, .cl-acts' }),
    swipeOff,
    subscribe('cards', () => { loaded = true; render(); }),
    onPrivacyChange(render),
    pullToRefresh(scroller, () => refresh('cards')),
  ];
  eye.addEventListener('pointerdown', eyeDown);
  eye.addEventListener('pointerup', eyeUp);
  eye.addEventListener('pointerleave', eyeUp);
  eye.addEventListener('pointercancel', eyeUp);
  eye.addEventListener('click', eyeClick);
  eye.addEventListener('contextmenu', (e) => e.preventDefault());

  body.addEventListener('touchstart', sdStart, { passive: true });
  body.addEventListener('touchmove', sdMove, { passive: false });
  body.addEventListener('touchend', sdEnd);
  body.addEventListener('touchcancel', sdEnd);

  // Encabezado colapsable: al bajar, el resumen pasa a la barra superior
  const onScroll = () => {
    const head = body.querySelector('.cx-head');
    bar.classList.toggle('mini', !!head && scroller.scrollTop > head.offsetTop + head.offsetHeight - 20);
    if (!reducedMotion()) screen.style.setProperty('--sx', String(Math.round(40 + Math.min(30, scroller.scrollTop * 0.06) + tilt)));
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // Brillo que reacciona al giroscopio (Android: sin permiso; en iPhone se queda con el del scroll)
  let tilt = 0, tiltRaf = 0;
  const onTilt = (e) => {
    if (reducedMotion() || e.gamma == null) return;
    cancelAnimationFrame(tiltRaf);
    tiltRaf = requestAnimationFrame(() => { tilt = Math.max(-25, Math.min(25, e.gamma * 0.6)); onScroll(); });
  };
  const needsPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  if (!needsPermission) window.addEventListener('deviceorientation', onTilt);

  // Velo en el selector de apps: los montos no quedan en la miniatura
  const veil = screen.querySelector('.cx-veil');
  const onVis = () => {
    if (document.hidden) veil.hidden = false;
    else { setTimeout(() => { veil.hidden = true; }, 120); if (needsUnlock()) showLock(); }
  };
  document.addEventListener('visibilitychange', onVis);

  // Gesto de volver desde el borde izquierdo (como en iOS)
  let edge = null;
  const edgeStart = (e) => { const t = e.touches[0]; edge = t.clientX < 22 ? { x: t.clientX, y: t.clientY } : null; };
  const edgeEnd = (e) => {
    if (!edge) return;
    const t = e.changedTouches[0];
    if (t.clientX - edge.x > 80 && Math.abs(t.clientY - edge.y) < 60) { haptic.tap(); history.back(); }
    edge = null;
  };
  screen.addEventListener('touchstart', edgeStart, { passive: true });
  screen.addEventListener('touchend', edgeEnd);

  const ro = new ResizeObserver(() => { if (ui.view === 'stack') layout(); });
  ro.observe(body);

  // Bloqueo con Face ID / huella (opcional, Ajustes)
  const lock = screen.querySelector('.cx-lock');
  const showLock = () => { lock.hidden = false; };
  const tryUnlock = async () => { if (await unlock()) { lock.hidden = true; haptic.success(); } else haptic.error(); };
  if (needsUnlock()) showLock();

  render();
  refresh('cards').finally(() => { loaded = true; render(); handleQuery(); });

  // Atajos: #/tarjetas?pagar=<id|1> · #/tarjetas?mejor=1 (accesos rápidos del ícono y notificaciones)
  let handled = false;
  async function handleQuery() {
    if (handled) return;
    handled = true;
    const cards = active();
    if (query.pagar) {
      let c = find(query.pagar);
      if (!c && cards.length === 1) [c] = cards;
      if (!c && cards.length) c = await pickCard(cards.filter((x) => debtOf(x) > 0).length ? cards.filter((x) => debtOf(x) > 0) : cards, '¿A cuál tarjeta le pagas?');
      if (c) openPay(c);
    } else if (query.mejor && cards.length) openBest(cards, { onPick: (id) => menu(id) });
  }

  return () => {
    offs.forEach((f) => f());
    crOff?.();
    ro.disconnect();
    clearTimeout(tapTimer);
    [...pendingDelete.keys()].forEach(flushDelete); // lo que estaba por borrarse se borra ya
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('deviceorientation', onTilt);
    body.removeEventListener('touchstart', sdStart);
    body.removeEventListener('touchmove', sdMove);
    body.removeEventListener('touchend', sdEnd);
    body.removeEventListener('touchcancel', sdEnd);
  };
}
