// Extracto de una cuenta: saldo, gráfica del saldo que se recorre con el dedo, períodos (Mes · 3M · Año · Todo),
// cuánto entró y salió con su desglose (¿a dónde se fue? / ¿de dónde vino?) y todos los movimientos con el saldo
// que quedó después de cada uno, hasta el saldo inicial. Todo sale de los movimientos: no hay cálculos en el servidor
// aparte de account_balances (misma fórmula, ver js/utils/account-ledger.js).
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { bogota, todayISO, addDays, addMonths, startOfMonth, dayLabel, dateShort, timeLabel } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { reducedMotion } from '../utils/motion.js';
import { state, subscribe, onChanged, accountById, cardById, categoryById } from '../state.js';
import { listTransactions } from '../api/transactions.js';
import { refresh } from '../api/catalog.js';
import { catIcon, segmented, selectSegment } from '../ui/common.js';
import { orbError, loadErrorText, online } from '../ui/orb-loader.js';
import { emptyState } from '../ui/empty.js';
import { enableSwipe, pullToRefresh } from '../ui/gestures.js';
import { toast } from '../ui/toast.js';
import { isHidden, toggle as togglePrivacy, onPrivacyChange } from '../privacy.js';
import { MASK } from '../ui/sensitive.js';
import { ledger, summarize, dailySeries, breakdown, changePct } from '../utils/account-ledger.js';
import { openTransactionForm, openTransactionDetail, deleteWithUndo } from './transaction-form.js';
import { PRIV, TYPES, accountIcon, isDefault, accountMenu, openReconcile } from './accounts.js';

export const title = 'Cuenta';

const PERIODS = [
  { id: 'month', label: 'Mes', since: 'este mes', from: (t) => startOfMonth(t) },
  { id: '3m', label: '3M', since: 'en 3 meses', from: (t) => addDays(addMonths(t, -3), 1) },
  { id: '1y', label: 'Año', since: 'en el último año', from: (t) => addDays(addMonths(t, -12), 1) },
  { id: 'all', label: 'Todo', since: 'desde el inicio', from: () => null },
];
const UI_KEY = 'lukas-account-ui';
const FETCH = 500; // movimientos por petición
const CAP = 5000; // tope por período (se avisa si se alcanza)
const CHUNK = 80; // filas que se pintan por tanda al hacer scroll
const CH = 132; // alto de la gráfica

const readUI = () => { try { return { period: 'month', ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; } catch { return { period: 'month' }; } };
const saveUI = (ui) => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* modo privado */ } };
const periodOf = (id) => PERIODS.find((p) => p.id === id) ?? PERIODS[0];
const dateOf = (t) => bogota(new Date(t.occurred_at)).date;
const signed = (v) => (v > 0 ? `+${money(v)}` : money(v)); // money ya pone "−" a los negativos
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "Jueves, 5 de noviembre"; de otro año, con el año ("Lunes, 22 de diciembre de 2025") */
const dayHead = (iso) => (iso.slice(0, 4) !== todayISO().slice(0, 4) && !/^(Hoy|Ayer|Mañana)$/.test(dayLabel(iso)) ? `${dayLabel(iso)} de ${iso.slice(0, 4)}` : dayLabel(iso));

async function fetchAll(accountId, from) {
  const txs = [];
  for (let offset = 0; offset < CAP; offset += FETCH) {
    const batch = await listTransactions({ accountId, from: from ?? undefined, limit: FETCH, offset });
    txs.push(...batch);
    if (batch.length < FETCH) return { txs, complete: true };
  }
  return { txs, complete: false };
}

/** A dónde fue (o de dónde vino) un movimiento, para agrupar y para el subtítulo de la fila */
function bucketOf(r, dir) {
  const t = r.tx;
  if (t.type === 'transfer') {
    if (dir === 'in') {
      const a = accountById(t.account_id);
      return { key: `from:${t.account_id ?? 'x'}`, label: a ? `Desde ${a.name}` : 'Transferencia recibida', icon: 'arrow-in', color: a?.color ?? '#6F6F69' };
    }
    if (t.to_card_id) {
      const c = cardById(t.to_card_id);
      return { key: `card:${t.to_card_id}`, label: c ? `Pago ${c.nickname || c.name}` : 'Pago de tarjeta', icon: 'card', color: c?.color ?? '#6F6F69' };
    }
    if (t.debt_id) {
      const d = state.debts.find((x) => x.id === t.debt_id);
      return { key: `debt:${t.debt_id}`, label: d ? `Cuota ${d.name}` : 'Pago de crédito', icon: 'bank', color: '#B87600' };
    }
    if (t.goal_id) {
      const g = state.goals.find((x) => x.id === t.goal_id);
      return { key: `goal:${t.goal_id}`, label: g ? `Ahorro: ${g.name}` : 'Aporte a meta', icon: g?.icon ?? 'target', color: g?.color ?? '#4B3BF5' };
    }
    const a = accountById(t.to_account_id);
    return { key: `to:${t.to_account_id ?? 'x'}`, label: a ? `A ${a.name}` : 'Transferencia', icon: 'swap', color: a?.color ?? '#6F6F69' };
  }
  const c = categoryById(t.category_id);
  const top = c?.parent_id ? categoryById(c.parent_id) ?? c : c;
  if (top) return { key: `cat:${top.id}`, label: top.name, icon: top.icon, color: top.color };
  return t.type === 'income'
    ? { key: 'cat:none:in', label: 'Ingresos sin categoría', icon: 'arrow-in', color: '#12875A' }
    : { key: 'cat:none:out', label: 'Sin categoría', icon: 'tag', color: '#9A9A92' };
}

export function mount(screen, { params, navigate }) {
  const id = params.id;
  const ui = readUI();
  let period = periodOf(ui.period).id;
  let flowDir = 'out';
  let filter = { dir: '', bucket: null }; // dir: '' | 'in' | 'out'; bucket: { keys, label, dir }
  let limit = CHUNK;
  let peek = false;
  const cache = new Map(); // período → { txs, complete }
  let status = 'loading'; // loading | ready | error
  let errText = '';
  let token = 0;
  let view = null; // derivado: { rows, startBalance, series, from, to, sum, complete }
  let shownBalance = null;
  let scrub = null;
  let catalogReady = state.accounts.length > 0;

  const acc = () => accountById(id);
  const hidden = () => isHidden(PRIV) && !peek;
  const amt = (v, fmt = money) => (hidden() ? MASK : fmt(v));

  screen.innerHTML = String(html`
    <header class="topbar ad-topbar">
      <div class="topbar-inner">
        <button class="icon-btn" data-back aria-label="Volver">${icon('chevron-left', { stroke: 2.2 })}</button>
        <div class="ad-mini" aria-hidden="true"><b class="ellipsis"></b><span class="num"></span></div>
        <button class="icon-btn ad-eye" data-eye aria-pressed="false">${icon('eye')}</button>
        <button class="icon-btn" data-more aria-haspopup="menu" aria-label="Opciones de la cuenta">${icon('dots')}</button>
      </div>
    </header>
    <div class="scroller"><div class="content ad">
      <section class="ad-hero" aria-label="Saldo de la cuenta">
        <div class="ad-id"></div>
        <div class="ad-bal">
          <span class="eyebrow" data-bal-label>Saldo disponible</span>
          <b class="num ad-big" data-bal aria-live="off"></b>
          <span class="ad-delta" data-delta></span>
        </div>
        <div class="ad-chart" data-chart><div class="sk ad-sk-chart"></div></div>
        <div class="ad-periods">${segmented('period', PERIODS.map((p) => ({ value: p.id, label: p.label })), period)}</div>
      </section>
      <div class="ad-quick" role="group" aria-label="Acciones rápidas">
        <button class="pressable" data-quick="income"><span class="q-in">${icon('arrow-in', { stroke: 2 })}</span>Ingreso</button>
        <button class="pressable" data-quick="expense"><span class="q-out">${icon('arrow-out', { stroke: 2 })}</span>Gasto</button>
        <button class="pressable" data-quick="transfer"><span>${icon('swap', { stroke: 2 })}</span>Transferir</button>
        <button class="pressable" data-quick="reconcile"><span>${icon('check', { stroke: 2.2 })}</span>Cuadrar</button>
      </div>
      <section class="ad-flow" data-flow aria-label="Entradas y salidas"></section>
      <section class="section ad-moves">
        <div class="section-head"><h2 class="section-title">Movimientos</h2><span class="muted small num" data-count></span></div>
        <div class="chips scroll ad-filters" data-filters></div>
        <div class="ad-list" data-list></div>
        <div class="ad-sentinel" aria-hidden="true"></div>
      </section>
    </div></div>`);

  const scroller = screen.querySelector('.scroller');
  const bar = screen.querySelector('.ad-topbar');
  const mini = screen.querySelector('.ad-mini');
  const eye = screen.querySelector('[data-eye]');
  const idEl = screen.querySelector('.ad-id');
  const balEl = screen.querySelector('[data-bal]');
  const balLabel = screen.querySelector('[data-bal-label]');
  const deltaEl = screen.querySelector('[data-delta]');
  const chartEl = screen.querySelector('[data-chart]');
  const flowEl = screen.querySelector('[data-flow]');
  const listEl = screen.querySelector('[data-list]');
  const filtersEl = screen.querySelector('[data-filters]');
  const countEl = screen.querySelector('[data-count]');
  const sentinel = screen.querySelector('.ad-sentinel');

  // ── Derivados ──
  const derive = () => {
    const a = acc();
    const data = cache.get(period);
    if (!a || !data) { view = null; return; }
    const { rows, startBalance } = ledger(data.txs, a.id, a.balance);
    const today = todayISO();
    const oldest = rows.length ? dateOf(rows.at(-1).tx) : today;
    const newest = rows.length ? dateOf(rows[0].tx) : today;
    let from = periodOf(period).from(today) ?? (oldest < today ? oldest : today);
    if (!data.complete && oldest > from) from = oldest; // con tope: la gráfica empieza donde hay datos
    const to = newest > today ? newest : today;
    view = { rows, startBalance, from, to, today, complete: data.complete, sum: summarize(rows),
      series: dailySeries(rows, { from, to, startBalance, dateOf }) };
  };

  // ── Encabezado ──
  const paintTop = () => {
    const a = acc();
    const h = isHidden(PRIV);
    eye.innerHTML = String(icon(h ? 'eye-off' : 'eye'));
    eye.classList.toggle('on', h);
    eye.setAttribute('aria-pressed', String(h));
    eye.setAttribute('aria-label', h ? 'Mostrar saldos (mantén presionado para ver sin cambiar)' : 'Ocultar saldos');
    if (!a) return;
    mini.querySelector('b').textContent = a.name;
    mini.querySelector('span').textContent = amt(a.balance);
  };

  const paintId = () => {
    const a = acc();
    if (!a) return;
    idEl.innerHTML = String(html`${accountIcon(a, { lg: true, vt: !reducedMotion() })}
      <div class="grow"><h1 class="ad-name ellipsis">${a.name}</h1>
        <div class="ad-type">${TYPES[a.type] ?? 'Cuenta'}${isDefault(a) ? html`<span class="tag accent">Por defecto</span>` : ''}${a.archived ? html`<span class="tag">Archivada</span>` : ''}</div></div>`);
  };

  const countTo = (from, to) => {
    if (hidden() || reducedMotion() || from == null || from === to) { balEl.textContent = amt(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (scrub) return;
      const p = Math.min(1, (now - t0) / 700);
      balEl.textContent = money(from + (to - from) * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /** Número grande + variación. Con el dedo sobre la gráfica muestra el saldo de ese día */
  const paintBalance = (point = null) => {
    const a = acc();
    if (!a) return;
    const s = view?.series;
    const value = point ? point.balance : Number(a.balance);
    balEl.classList.toggle('expense-txt', value < 0);
    if (point) balEl.textContent = amt(value);
    else { countTo(shownBalance, value); shownBalance = value; }
    balEl.setAttribute('aria-label', hidden() ? 'Saldo oculto' : `Saldo ${money(value)}`);
    balLabel.textContent = !point ? 'Saldo disponible'
      : point.opening ? (period === 'all' && view?.complete ? 'Saldo inicial' : `Al empezar · ${dateShort(point.date)}`)
        : point.date === view?.today ? 'Hoy' : dayLabel(point.date);
    if (!s || s.length < 2) { deltaEl.innerHTML = ''; return; }
    const base = s[0].balance;
    const d = value - base;
    const pct = changePct(base, value);
    const tone = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const since = point ? (point.opening ? '' : `desde ${dateShort(s[0].date)}`) : periodOf(period).since;
    deltaEl.className = `ad-delta ${tone}`;
    deltaEl.innerHTML = point?.opening ? '' : String(html`<span class="pill">${icon(d > 0 ? 'arrow-up' : d < 0 ? 'arrow-down' : 'swap', { size: 13, stroke: 2.4 })}
      <b class="num">${hidden() ? MASK : money(Math.abs(d))}</b>${pct != null && Math.abs(pct) >= 0.5 && !hidden() ? html`<i class="num">${Math.round(Math.abs(pct))} %</i>` : ''}</span><span class="since">${since}</span>`);
  };

  // ── Gráfica ──
  let geo = null; // { W, X(i), Y(v) }
  const paintChart = ({ animate = true } = {}) => {
    if (status === 'error' && !view) { chartEl.innerHTML = ''; return; }
    if (!view) { if (!chartEl.querySelector('.sk')) chartEl.innerHTML = '<div class="sk ad-sk-chart"></div>'; return; }
    const s = view.series;
    const W = Math.max(200, Math.round(chartEl.clientWidth || 350));
    const PT = 14, PB = 12;
    const vals = s.map((p) => p.balance);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    min -= pad; max += pad;
    const n = s.length;
    const X = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - 8) + 4);
    const Y = (v) => PT + (1 - (v - min) / (max - min)) * (CH - PT - PB);
    geo = { W, X, Y };
    const pts = s.map((p, i) => [X(i), Y(p.balance)]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const area = `${line}L${pts.at(-1)[0].toFixed(1)} ${CH}L${pts[0][0].toFixed(1)} ${CH}Z`;
    const [ex, ey] = pts.at(-1);
    const yBase = Y(s[0].balance);
    const zero = min < 0 && max > 0 ? Y(0) : null;
    const gid = `adg-${id.slice(0, 8)}`;
    const first = s[0];
    const lastDate = s.at(-1).date;
    const label = `Evolución del saldo ${periodOf(period).since}: ${hidden() ? 'montos ocultos' : `de ${money(first.balance)} a ${money(s.at(-1).balance)}`}`;
    chartEl.innerHTML = String(html`<svg class="ad-svg ${animate && !reducedMotion() ? 'draw' : ''}" viewBox="0 0 ${W} ${CH}" width="${W}" height="${CH}" role="img" aria-label="${label}">
        <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.2"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
        <line class="ad-base" x1="0" x2="${W}" y1="${yBase.toFixed(1)}" y2="${yBase.toFixed(1)}"/>
        ${zero != null ? html`<line class="ad-zero" x1="0" x2="${W}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}"/>` : ''}
        <path class="ad-area" d="${area}" fill="url(#${gid})"/>
        <path class="ad-line" d="${line}" pathLength="1"/>
        <line class="ad-cursor" x1="0" x2="0" y1="4" y2="${CH}" visibility="hidden"/>
        <circle class="ad-end-pulse" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5"/>
        <circle class="ad-end" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4"/>
        <circle class="ad-knob" cx="0" cy="0" r="6" visibility="hidden"/>
      </svg>
      <div class="ad-axis" aria-hidden="true"><span>${period === 'all' && view.complete ? 'Inicio' : dateShort(first.date)}</span><span>${lastDate === view.today ? 'Hoy' : dateShort(lastDate)}</span></div>`);
  };

  const scrubTo = (clientX) => {
    if (!view || !geo) return;
    const s = view.series;
    const rect = chartEl.querySelector('svg').getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * geo.W;
    const i = Math.max(0, Math.min(s.length - 1, Math.round(((x - 4) / (geo.W - 8)) * (s.length - 1))));
    if (scrub.i === i) return;
    // vibra solo al pasar por días con movimientos (no en cada píxel)
    if (scrub.i != null && i > 0 && s[i].balance !== s[i - 1].balance) haptic.select();
    scrub.i = i;
    const cx = geo.X(i), cy = geo.Y(s[i].balance);
    const svg = chartEl.querySelector('svg');
    const cur = svg.querySelector('.ad-cursor');
    const knob = svg.querySelector('.ad-knob');
    cur.setAttribute('x1', cx.toFixed(1)); cur.setAttribute('x2', cx.toFixed(1)); cur.setAttribute('visibility', 'visible');
    knob.setAttribute('cx', cx.toFixed(1)); knob.setAttribute('cy', cy.toFixed(1)); knob.setAttribute('visibility', 'visible');
    paintBalance(s[i]);
  };
  const endScrub = () => {
    if (!scrub) return;
    clearTimeout(scrub.timer);
    const was = scrub.active;
    scrub = null;
    chartEl.classList.remove('scrubbing');
    if (!was) return;
    chartEl.querySelectorAll('.ad-cursor, .ad-knob').forEach((n) => n.setAttribute('visibility', 'hidden'));
    paintBalance();
  };
  const startScrub = () => {
    if (!scrub || scrub.active) return;
    scrub.active = true;
    chartEl.classList.add('scrubbing');
    haptic.tap();
    scrubTo(scrub.x);
  };
  const onChartDown = (e) => {
    if (!view || e.button > 0) return;
    scrub = { x: e.clientX, y: e.clientY, x0: e.clientX, active: false, i: null, id: e.pointerId };
    try { chartEl.setPointerCapture(e.pointerId); } catch { /* nada */ }
    // con mouse se activa al instante; con el dedo, al sostener un momento o al moverse en horizontal
    if (e.pointerType === 'mouse') startScrub();
    else scrub.timer = setTimeout(startScrub, 140);
  };
  const onChartMove = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    scrub.x = e.clientX;
    if (!scrub.active) {
      const dx = Math.abs(e.clientX - scrub.x0), dy = Math.abs(e.clientY - scrub.y);
      if (dy > 8 && dy > dx) { endScrub(); return; }
      if (dx > 4) startScrub();
      return;
    }
    scrubTo(e.clientX);
  };

  // ── Entró / salió ──
  const paintFlow = () => {
    if (!view) {
      flowEl.innerHTML = status === 'error' ? '' : '<div class="ad-flow-card"><div class="sk" style="height:62px"></div><div class="sk mt-4" style="height:14px;width:60%"></div><div class="sk mt-3" style="height:14px;width:80%"></div></div>';
      return;
    }
    const { sum } = view;
    const groups = breakdown(view.rows, flowDir, bucketOf, { top: 5 });
    const total = flowDir === 'in' ? sum.inflow : sum.outflow;
    const h = hidden();
    const tab = (dir, label, value, n) => html`<button role="tab" class="ad-ft ${dir} ${flowDir === dir ? 'on' : ''}" data-flowdir="${dir}" aria-selected="${flowDir === dir}">
        <span class="lbl">${icon(dir === 'in' ? 'arrow-in' : 'arrow-out', { size: 15, stroke: 2.2 })}${label}</span>
        <b class="num">${h ? MASK : `${dir === 'in' ? '+' : '−'}${money(value)}`}</b>
        <small>${plural(n, 'movimiento', 'movimientos')}</small></button>`;
    const ratio = sum.inflow + sum.outflow > 0 ? (sum.inflow * 100) / (sum.inflow + sum.outflow) : 50;
    flowEl.innerHTML = String(html`<div class="ad-flow-card">
      <div class="ad-flow-tabs" role="tablist" aria-label="Ver desglose de">${tab('in', 'Entró', sum.inflow, sum.nIn)}${tab('out', 'Salió', sum.outflow, sum.nOut)}</div>
      <div class="ad-ratio" aria-hidden="true"><span class="in" style="width:${ratio.toFixed(1)}%"></span><span class="out"></span></div>
      <div class="ad-bd">
        <div class="ad-bd-head"><span>${flowDir === 'in' ? '¿De dónde vino?' : '¿A dónde se fue?'}</span>${total > 0 ? html`<span class="muted">Toca para filtrar</span>` : ''}</div>
        ${groups.length ? html`<div class="ad-stack" aria-hidden="true">${groups.map((g) => html`<span style="width:${g.pct.toFixed(2)}%;--c:${g.color}"></span>`)}</div>
          ${groups.map((g) => html`<button class="ad-bd-row ${filter.bucket?.key === g.key ? 'on' : ''}" data-bucket="${g.key}" aria-label="${g.label}: ${h ? 'monto oculto' : money(g.amount)}, ${Math.round(g.pct)} por ciento. Filtrar movimientos">
            <span class="cat-icon sm" style="--c:${g.color}">${icon(g.icon, { size: 16 })}</span>
            <span class="grow ad-bd-mid"><span class="ad-bd-top"><span class="ellipsis">${g.label}</span><b class="num">${h ? MASK : money(g.amount)}</b></span>
              <span class="ad-bd-sub"><span class="ad-bd-bar"><i style="width:${Math.max(2, g.pct).toFixed(1)}%;--c:${g.color}"></i></span><span class="num">${g.pct < 1 ? '<1' : Math.round(g.pct)} %</span></span></span>
          </button>`)}`
        : html`<p class="ad-bd-empty">${flowDir === 'in' ? 'No entró plata' : 'No salió plata'} ${periodOf(period).since}.</p>`}
      </div></div>`);
    // mantiene la lista de grupos para resolver filtros
    flowEl._groups = groups;
  };

  // ── Lista ──
  const filteredRows = () => {
    if (!view) return [];
    let rows = view.rows;
    if (filter.dir === 'in') rows = rows.filter((r) => r.effect > 0);
    if (filter.dir === 'out') rows = rows.filter((r) => r.effect < 0);
    if (filter.bucket) {
      const keys = new Set(filter.bucket.keys);
      rows = rows.filter((r) => (filter.bucket.dir === 'in' ? r.effect > 0 : r.effect < 0) && keys.has(bucketOf(r, filter.bucket.dir).key));
    }
    return rows;
  };

  const paintFilters = () => {
    if (!view || !view.rows.length) { filtersEl.innerHTML = ''; return; }
    const { nIn, nOut } = view.sum;
    filtersEl.innerHTML = String(html`
      ${filter.bucket ? html`<button class="chip selected" data-clear-bucket aria-label="Quitar filtro ${filter.bucket.label}">${filter.bucket.label}${icon('x', { size: 14 })}</button>` : ''}
      ${[['', 'Todos', view.rows.length], ['in', 'Entradas', nIn], ['out', 'Salidas', nOut]].map(([v, l, n]) => html`<button class="chip ${!filter.bucket && filter.dir === v ? 'selected' : ''}" data-fdir="${v}" aria-pressed="${!filter.bucket && filter.dir === v}">${l} <span class="chip-n num">${n}</span></button>`)}`);
  };

  const rowHtml = (r) => {
    const t = r.tx;
    const dir = r.effect >= 0 ? 'in' : 'out';
    const b = bucketOf(r, dir);
    const isTransfer = t.type === 'transfer';
    const cat = isTransfer ? null : categoryById(t.category_id);
    const ic = isTransfer ? html`<span class="cat-icon" style="--c:${b.color}">${icon(b.icon, { size: 20 })}</span>` : catIcon(cat);
    const titleTx = t.description || (isTransfer ? b.label : cat?.name) || (t.type === 'income' ? 'Ingreso' : 'Gasto');
    const sub = [isTransfer ? (t.description ? b.label : 'Transferencia') : (cat?.name ?? 'Sin categoría'), timeLabel(t.occurred_at)].join(' · ');
    const sign = r.effect > 0 ? '+' : r.effect < 0 ? '−' : '';
    const cls = r.effect > 0 ? 'in' : r.effect === 0 ? 'transfer' : '';
    const h = hidden();
    return html`<div class="swipe" data-id="${t.id}">
      <div class="swipe-actions" aria-hidden="true">
        <button class="act-edit" data-swipe="edit" tabindex="-1">${icon('edit', { size: 20 })}Editar</button>
        <button class="act-delete" data-swipe="delete" tabindex="-1">${icon('trash', { size: 20 })}Eliminar</button></div>
      <div class="swipe-content"><button class="list-row tappable ad-row" data-tx="${t.id}"
          aria-label="${titleTx}, ${h ? 'monto oculto' : `${r.effect >= 0 ? 'entró' : 'salió'} ${money(Math.abs(r.effect || t.amount))}, quedó ${money(r.after)}`}. ${sub}">
        ${ic}
        <div class="grow"><div class="row-title ellipsis">${titleTx}</div><div class="row-sub ellipsis">${sub}</div></div>
        <div class="ad-amt"><span class="row-amount ${cls}">${h ? MASK : `${sign}${money(Math.abs(r.effect || t.amount))}`}</span>
          <span class="ad-after ${r.after < 0 ? 'neg' : ''}">${h ? MASK : money(r.after)}</span></div>
      </button></div></div>`;
  };

  const anchorHtml = () => {
    if (!view || filter.dir || filter.bucket) return '';
    if (!view.complete) return html`<p class="ad-cap">${icon('info', { size: 16 })}Mostrando los ${CAP.toLocaleString('es-CO')} movimientos más recientes de este período.</p>`;
    const opening = period === 'all';
    const a = acc();
    const initialMismatch = opening && a && Math.round(view.startBalance) !== Math.round(Number(a.initial_balance));
    return html`<div class="ad-anchor">
      <div class="ad-anchor-dot" aria-hidden="true">${icon(opening ? 'sparkles' : 'calendar', { size: 18 })}</div>
      <div class="grow"><div class="row-title">${opening ? 'Saldo inicial' : 'Saldo al empezar'}</div>
        <div class="row-sub">${opening ? 'Con esto arrancó la cuenta' : dayHead(view.from)}</div></div>
      <b class="num">${amt(initialMismatch ? Number(a.initial_balance) : view.startBalance)}</b></div>
      ${opening ? '' : html`<button class="link-btn ad-more-hist" data-period="all">${icon('clock', { size: 16 })}Ver todo el historial</button>`}`;
  };

  const paintList = () => {
    if (status === 'error' && !view) {
      listEl.innerHTML = String(orbError({ title: 'No pudimos cargar los movimientos', text: errText }));
      countEl.textContent = '';
      return;
    }
    if (!view) {
      listEl.innerHTML = String(html`<div class="list">${[0, 1, 2, 3, 4].map(() => html`<div class="list-row"><div class="sk" style="width:40px;height:40px;border-radius:13px"></div>
        <div class="grow"><div class="sk" style="height:13px;width:58%"></div><div class="sk mt-2" style="height:11px;width:38%"></div></div>
        <div><div class="sk" style="height:13px;width:76px"></div><div class="sk mt-2" style="height:11px;width:60px;margin-left:auto"></div></div></div>`)}</div>`);
      return;
    }
    const rows = filteredRows();
    countEl.textContent = rows.length ? plural(rows.length, 'movimiento', 'movimientos') : '';
    if (!view.rows.length) {
      listEl.innerHTML = String(period === 'all'
        ? emptyState({ illus: 'wallet', title: 'Aún no hay movimientos', text: 'Cuando registres ingresos, gastos o transferencias con esta cuenta, aquí verás cómo cambia su saldo.', action: { label: 'Registrar un ingreso', attrs: 'data-quick="income"' } })
        : emptyState({ illus: 'list', title: `Sin movimientos ${periodOf(period).since}`, text: 'Prueba con un rango más amplio para ver el historial.', action: { label: 'Ver todo', attrs: 'data-period="all"' } }));
      listEl.insertAdjacentHTML('beforeend', String(anchorHtml()));
      return;
    }
    if (!rows.length) {
      listEl.innerHTML = String(emptyState({ illus: 'search', title: 'Nada por aquí', text: 'No hay movimientos con ese filtro.', action: { label: 'Ver todos', attrs: 'data-fdir=""' } }));
      return;
    }
    const slice = rows.slice(0, limit);
    const groups = [];
    for (const r of slice) {
      const d = dateOf(r.tx);
      if (groups.at(-1)?.d !== d) groups.push({ d, rows: [] });
      groups.at(-1).rows.push(r);
    }
    const h = hidden();
    listEl.innerHTML = String(html`${groups.map((g, i) => {
      const net = g.rows.reduce((s, r) => s + r.effect, 0);
      return html`<div class="day-group" style="--i:${Math.min(i, 8)}">
        <div class="day-head"><span class="d">${dayHead(g.d)}</span><span class="t ${net > 0 ? 'income' : ''}">${net === 0 ? '' : h ? MASK : signed(net)}</span></div>
        <div class="list">${g.rows.map(rowHtml)}</div></div>`;
    })}${slice.length >= rows.length ? anchorHtml() : ''}`);
  };

  const paintAll = ({ animate = true } = {}) => {
    paintTop();
    paintId();
    paintBalance();
    paintChart({ animate });
    paintFlow();
    paintFilters();
    paintList();
  };

  // ── Datos ──
  const load = async ({ force = false } = {}) => {
    const p = period;
    if (!force && cache.has(p)) { status = 'ready'; derive(); paintAll(); return; }
    const my = ++token;
    if (!cache.has(p)) { status = 'loading'; view = null; paintAll(); }
    try {
      const data = await online(() => fetchAll(id, periodOf(p).from(todayISO())));
      if (my !== token) return;
      cache.set(p, data);
      status = 'ready';
      if (p === period) { derive(); paintAll({ animate: !force }); }
    } catch (err) {
      if (my !== token) return;
      errText = loadErrorText(err);
      if (view) toast(err.message || errText, { type: 'err' });
      else { status = 'error'; paintAll(); }
      throw err;
    }
  };

  /** Los otros períodos se vuelven a pedir al abrirlos; el actual se conserva en pantalla mientras se recarga */
  const invalidate = () => { const keep = cache.get(period); cache.clear(); if (keep) cache.set(period, keep); };

  const setPeriod = (p) => {
    if (p === period) return;
    period = p;
    ui.period = p;
    saveUI(ui);
    limit = CHUNK;
    filter = { dir: filter.dir, bucket: null };
    selectSegment(screen.querySelector('[data-seg="period"]'), p);
    haptic.select();
    load().catch(() => {});
  };

  const notFound = () => {
    screen.querySelector('.content').innerHTML = String(emptyState({ illus: 'wallet', title: 'No encontramos esta cuenta', text: 'Puede que la hayas eliminado.', action: { label: 'Ver mis cuentas', attrs: 'data-go-accounts' } }));
    bar.querySelectorAll('[data-eye], [data-more]').forEach((b) => { b.hidden = true; });
  };

  // ── Eventos ──
  let eyeT = 0, eyePeeked = false;
  const eyeDown = () => { eyePeeked = false; clearTimeout(eyeT); eyeT = setTimeout(() => { eyePeeked = true; peek = true; haptic.start(); paintAll({ animate: false }); }, 320); };
  const eyeUp = () => { clearTimeout(eyeT); if (eyePeeked) { peek = false; paintAll({ animate: false }); } };
  const eyeClick = (e) => { if (eyePeeked) { e.preventDefault(); eyePeeked = false; return; } haptic.select(); togglePrivacy(PRIV); };

  const quick = (kind) => {
    const a = acc();
    if (!a) return;
    haptic.tap();
    if (kind === 'reconcile') openReconcile(a);
    else openTransactionForm({ type: kind, accountId: a.id });
  };

  const onScroll = () => {
    const big = screen.querySelector('.ad-big');
    // el título compacto aparece cuando el saldo grande se esconde bajo la barra
    bar.classList.toggle('mini', !!big && big.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom + 4);
    bar.classList.toggle('scrolled', scroller.scrollTop > 4);
  };

  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting) || !view) return;
    if (filteredRows().length > limit) { limit += CHUNK; paintList(); }
  }, { root: scroller, rootMargin: '600px' });
  io.observe(sentinel);

  let resizeT = 0;
  const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (view && geo && Math.round(chartEl.clientWidth) !== geo.W) paintChart({ animate: false }); }, 80); });
  ro.observe(chartEl);

  const offs = [
    on(screen, 'click', '[data-more]', () => { const a = acc(); if (a) accountMenu(a, { onDeleted: () => navigate('cuentas', { replace: true }) }); }),
    on(screen, 'click', '[data-quick]', (e, b) => quick(b.dataset.quick)),
    on(screen, 'click', '[data-seg="period"] button', (e, b) => setPeriod(b.dataset.value)),
    on(screen, 'click', '[data-period]', (e, b) => { setPeriod(b.dataset.period); scroller.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); }),
    on(screen, 'click', '[data-flowdir]', (e, b) => { if (flowDir === b.dataset.flowdir) return; flowDir = b.dataset.flowdir; haptic.select(); paintFlow(); }),
    on(screen, 'click', '[data-bucket]', (e, b) => {
      const g = (flowEl._groups ?? []).find((x) => x.key === b.dataset.bucket);
      if (!g) return;
      haptic.select();
      filter = filter.bucket?.key === g.key ? { dir: '', bucket: null } : { dir: '', bucket: { key: g.key, keys: g.keys, label: g.label, dir: flowDir } };
      limit = CHUNK;
      paintFlow(); paintFilters(); paintList();
      if (filter.bucket) screen.querySelector('.ad-moves').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }),
    on(screen, 'click', '[data-fdir]', (e, b) => { haptic.select(); filter = { dir: b.dataset.fdir, bucket: null }; limit = CHUNK; paintFlow(); paintFilters(); paintList(); }),
    on(screen, 'click', '[data-clear-bucket]', () => { haptic.select(); filter = { dir: '', bucket: null }; limit = CHUNK; paintFlow(); paintFilters(); paintList(); }),
    on(screen, 'click', '[data-tx]', (e, b) => openTransactionDetail(b.dataset.tx)),
    on(screen, 'click', '[data-retry]', () => load({ force: true }).catch(() => {})),
    on(screen, 'click', '[data-go-accounts]', () => navigate('cuentas', { replace: true })),
    enableSwipe(listEl, {
      edit: (txId) => openTransactionDetail(txId),
      delete: async (txId) => {
        const r = view?.rows.find((x) => x.tx.id === txId);
        if (!r) return;
        const node = listEl.querySelector(`.swipe[data-id="${txId}"]`);
        node?.classList.add('removing');
        try { await deleteWithUndo([r.tx]); } catch (err) { node?.classList.remove('removing'); toast(err.message, { type: 'err' }); }
      },
    }),
    pullToRefresh(scroller, () => { invalidate(); return Promise.all([refresh('accounts'), load({ force: true })]); }),
    onChanged((ents) => { if (ents.includes('transactions')) { invalidate(); load({ force: true }).catch(() => {}); } }),
    subscribe('accounts', () => {
      catalogReady = true;
      if (!acc()) { notFound(); return; }
      derive(); paintTop(); paintId(); paintBalance(); paintChart({ animate: false }); paintFlow(); paintFilters(); paintList();
    }),
    subscribe('profile', paintId),
    subscribe('categories', () => { if (view) { paintFlow(); paintList(); } }),
    onPrivacyChange(() => paintAll({ animate: false })),
  ];
  chartEl.addEventListener('pointerdown', onChartDown);
  chartEl.addEventListener('pointermove', onChartMove);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => chartEl.addEventListener(ev, endScrub));
  eye.addEventListener('pointerdown', eyeDown);
  eye.addEventListener('pointerup', eyeUp);
  eye.addEventListener('pointerleave', eyeUp);
  eye.addEventListener('pointercancel', eyeUp);
  eye.addEventListener('click', eyeClick);
  eye.addEventListener('contextmenu', (e) => e.preventDefault());
  scroller.addEventListener('scroll', onScroll, { passive: true });

  if (acc()) paintAll();
  else if (catalogReady) notFound();
  else paintTop();
  load().catch(() => {});
  refresh('accounts').then(() => { if (!acc()) notFound(); }).catch(() => {});

  return () => {
    offs.forEach((f) => f());
    io.disconnect();
    ro.disconnect();
    clearTimeout(eyeT); clearTimeout(resizeT);
    scroller.removeEventListener('scroll', onScroll);
    token++;
  };
}
