// Reportes: periodo, KPIs con comparación, gráficas (Chart.js), calendario de calor, gastos hormiga, insights y CSV
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, moneyShort, percent, number } from '../utils/format.js';
import { todayISO, addDays, addMonths, startOfWeek, startOfMonth, endOfMonth, daysBetween, monthLabel, monthShort, dateShort, dayLabel } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, onChanged } from '../state.js';
import { reportData } from '../api/reports.js';
import { listTransactions } from '../api/transactions.js';
import { topbar, bindTopbar, segmented, selectSegment, txRow, animateCounts } from '../ui/common.js';
import { loaderHtml, settle, orbError, loadErrorText, online } from '../ui/orb-loader.js';
import { emptyState } from '../ui/empty.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { loadChart, axisMoney, theme } from '../ui/charts.js';
import { downloadCSV } from '../utils/export.js';
import { openTransactionDetail } from './transaction-form.js';

export const title = 'Reportes';
const WEEKDAYS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const sel = { period: 'month', anchor: null, from: null, to: null };

function rangeFor(period, anchor) {
  const t = anchor ?? todayISO();
  if (period === 'week') { const f = startOfWeek(t); return [f, addDays(f, 6)]; }
  if (period === 'month') return [startOfMonth(t), endOfMonth(t)];
  if (period === 'quarter') {
    const m = Number(t.slice(5, 7));
    const qStart = `${t.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    return [qStart, endOfMonth(addMonths(qStart, 2))];
  }
  if (period === 'year') return [`${t.slice(0, 4)}-01-01`, `${t.slice(0, 4)}-12-31`];
  return [sel.from ?? startOfMonth(t), sel.to ?? t];
}

function periodLabel(period, from, to) {
  if (period === 'month') return monthLabel(from);
  if (period === 'year') return from.slice(0, 4);
  if (period === 'quarter') return `T${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1} · ${from.slice(0, 4)}`;
  return `${dateShort(from)} – ${dateShort(to)}`;
}

function delta(cur, prev, { invert = false } = {}) {
  if (!prev) return '';
  const d = Math.round(((cur - prev) / prev) * 100);
  if (!Number.isFinite(d) || d === 0) return html`<span class="delta">= igual</span>`;
  const good = invert ? d < 0 : d > 0;
  return html`<span class="delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
}

function insights(r, from, to) {
  const out = [];
  const label = sel.period === 'week' ? 'esta semana' : sel.period === 'month' ? 'este mes' : 'en este periodo';
  const prevLabel = sel.period === 'week' ? 'la semana pasada' : sel.period === 'month' ? 'el mes pasado' : 'el periodo anterior';
  const changes = (r.by_category ?? []).filter((c) => c.prev_total > 0 && c.total > 20000)
    .map((c) => ({ ...c, d: Math.round(((c.total - c.prev_total) / c.prev_total) * 100) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (changes[0] && Math.abs(changes[0].d) >= 10) {
    const c = changes[0];
    out.push({ icon: c.d > 0 ? 'arrow-up' : 'arrow-down', tone: c.d > 0 ? 'bad' : 'good', text: `${label[0].toUpperCase() + label.slice(1)} gastaste ${Math.abs(c.d)}% ${c.d > 0 ? 'más' : 'menos'} en ${c.name} que ${prevLabel}.` });
  }
  if (r.income > 0) {
    const rate = Math.round(((r.income - r.expense) / r.income) * 100);
    out.push({ icon: 'target', tone: rate >= 20 ? 'good' : rate < 0 ? 'bad' : '', text: rate >= 0 ? `Ahorraste el ${rate}% de lo que te entró ${label}.` : `Gastaste ${money(r.expense - r.income)} más de lo que te entró ${label}.` });
  }
  if (r.ant?.count >= 5) out.push({ icon: 'coffee', tone: '', text: `Tus gastos hormiga (${r.ant.count} compras pequeñas) suman ${money(r.ant.total)}.` });
  const byWd = Array(7).fill(0);
  (r.by_day ?? []).forEach((d) => { byWd[new Date(`${d.d}T12:00:00Z`).getUTCDay()] += Number(d.expense); });
  const maxWd = byWd.indexOf(Math.max(...byWd));
  if (byWd[maxWd] > 0 && daysBetween(from, to) >= 13) out.push({ icon: 'calendar', tone: '', text: `Los ${WEEKDAYS[maxWd]} son tus días de más gasto.` });
  if (r.top_descriptions?.[0]?.count >= 3) out.push({ icon: 'repeat', tone: '', text: `Lo más frecuente: ${r.top_descriptions[0].name} (${r.top_descriptions[0].count} veces, ${money(r.top_descriptions[0].total)}).` });
  return out;
}

export function mount(screen) {
  if (!sel.anchor) sel.anchor = todayISO();
  const charts = [];
  let data = null;

  screen.innerHTML = String(html`
    ${topbar({ title: 'Reportes', large: true, right: html`<button class="icon-btn filled" data-export aria-label="Exportar CSV">${icon('download')}</button>` })}
    <div class="scroller"><div class="content reports">
      ${segmented('period', [{ value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }, { value: 'quarter', label: 'Trim.' }, { value: 'year', label: 'Año' }, { value: 'custom', label: 'Rango' }], sel.period)}
      <div class="period-nav">
        <button class="icon-btn" data-nav="-1" aria-label="Periodo anterior">${icon('chevron-left', { stroke: 2.2 })}</button>
        <div class="period-label"></div>
        <button class="icon-btn" data-nav="1" aria-label="Periodo siguiente">${icon('chevron-right', { stroke: 2.2 })}</button>
      </div>
      <div class="custom-range" hidden><input class="input" type="date" data-from aria-label="Desde"><input class="input" type="date" data-to aria-label="Hasta"></div>
      <div class="rep-body">${loaderHtml()}</div>
    </div></div>`);

  const body = screen.querySelector('.rep-body');
  const destroyCharts = () => { charts.splice(0).forEach((c) => c.destroy()); };

  const render = async (r, from, to) => {
    destroyCharts();
    const days = daysBetween(from, to) + 1;
    const today = todayISO();
    const elapsed = Math.max(1, Math.min(days, daysBetween(from, today) + 1));
    const avg = r.expense / elapsed;
    const isCurrentMonth = sel.period === 'month' && from === startOfMonth(today);
    const projection = isCurrentMonth ? Math.round(avg * days) : null;
    const rate = r.income > 0 ? Math.round(((r.income - r.expense) / r.income) * 100) : null;
    const balance = r.income - r.expense;
    const ins = insights(r, from, to);

    if (!r.expense && !r.income) {
      body.innerHTML = String(emptyState({ illus: 'chart', title: 'Sin movimientos en este periodo', text: 'Cuando registres gastos e ingresos, aquí verás tus gráficas.' }));
      return;
    }

    body.innerHTML = String(html`
      <div class="kpis stagger">
        <div class="kpi" style="--i:0"><span class="eyebrow">Ingresos</span><b class="num income" data-count="${r.income}">$0</b>${delta(r.income, r.prev_income)}</div>
        <div class="kpi" style="--i:1"><span class="eyebrow">Gastos</span><b class="num" data-count="${r.expense}">$0</b>${delta(r.expense, r.prev_expense, { invert: true })}</div>
        <div class="kpi" style="--i:2"><span class="eyebrow">Balance</span><b class="num ${balance < 0 ? 'expense-txt' : ''}">${money(balance)}</b></div>
        <div class="kpi" style="--i:3"><span class="eyebrow">Tasa de ahorro</span><b class="num">${rate == null ? '—' : percent(rate)}</b></div>
        <div class="kpi" style="--i:4"><span class="eyebrow">Promedio diario</span><b class="num">${money(avg)}</b></div>
        <div class="kpi" style="--i:5"><span class="eyebrow">${projection != null ? 'Proyección del mes' : 'Movimientos'}</span><b class="num">${projection != null ? money(projection) : number(r.expense_count)}</b></div>
      </div>

      ${ins.length ? html`<section class="section insights">${ins.map((x) => html`<div class="insight ${x.tone}">${icon(x.icon, { size: 18 })}<span>${x.text}</span></div>`)}</section>` : ''}

      <section class="chart-card"><div class="cc-head"><h3>Ingresos vs gastos</h3><span class="muted small">Últimos 12 meses</span></div>
        <div class="chart-box"><canvas data-chart="monthly" aria-label="Gráfica de ingresos y gastos por mes"></canvas></div></section>

      ${r.by_category.length ? html`<section class="chart-card"><div class="cc-head"><h3>Gastos por categoría</h3><span class="muted small">Toca para ver detalle</span></div>
        <div class="donut-wrap"><div class="chart-box donut"><canvas data-chart="donut" aria-label="Gastos por categoría"></canvas>
          <div class="donut-center"><span class="eyebrow">Total</span><b class="num">${moneyShort(r.expense)}</b></div></div>
        <div class="legend">${r.by_category.slice(0, 8).map((c, i) => html`<button class="legend-row" data-cat="${c.id ?? ''}" data-i="${i}">
          <span class="dot-lg" style="--c:${c.color ?? '#9A9A92'}"></span><span class="grow ellipsis">${c.name ?? 'Sin categoría'}</span>
          <b class="num">${money(c.total)}</b><span class="muted xsmall">${percent((c.total / r.expense) * 100)}</span></button>`)}</div></div></section>` : ''}

      <section class="chart-card"><div class="cc-head"><h3>Gasto acumulado</h3><span class="muted small">${r.monthly_budget || r.daily_limit ? 'vs presupuesto' : 'en el periodo'}</span></div>
        <div class="chart-box"><canvas data-chart="cumulative" aria-label="Gasto acumulado"></canvas></div></section>

      <section class="chart-card"><div class="cc-head"><h3>Calendario de gasto</h3><span class="muted small">Más oscuro = más gasto</span></div>
        ${heatmap(r.by_day, from)}</section>

      ${r.ant?.count ? html`<section class="chart-card ant"><div class="cc-head"><h3>${icon('coffee', { size: 18 })}Gastos hormiga</h3><span class="muted small">Compras de ${moneyShort(r.ant.threshold)} o menos</span></div>
        <div class="ant-big"><b class="num">${money(r.ant.total)}</b><span class="muted">en ${r.ant.count} compras pequeñas</span></div>
        <div class="bars">${(r.ant.top ?? []).map((t) => barRow(t.name, t.total, r.ant.top[0].total, `${t.count}×`))}</div></section>` : ''}

      ${r.top_descriptions.length ? html`<section class="chart-card"><div class="cc-head"><h3>Lo más frecuente</h3><span class="muted small">Comercios y descripciones</span></div>
        <div class="bars">${r.top_descriptions.map((t) => barRow(t.name, t.total, Math.max(...r.top_descriptions.map((x) => x.total)), `${t.count}×`))}</div></section>` : ''}

      ${r.cards.length ? html`<section class="chart-card"><div class="cc-head"><h3>Tarjetas de crédito</h3><span class="muted small">Uso de cupo y deuda</span></div>
        <div class="bars">${r.cards.map((c) => barRow(c.name, Math.max(0, c.debt), c.limit || 1, percent(c.usage_pct), c.color))}</div>
        <div class="chart-box mt-4"><canvas data-chart="cards" aria-label="Evolución de la deuda de tarjetas"></canvas></div></section>` : ''}

      ${r.debts.length ? html`<section class="chart-card"><div class="cc-head"><h3>Créditos</h3><span class="muted small">Saldo pendiente</span></div>
        <div class="chart-box"><canvas data-chart="debts" aria-label="Evolución de créditos"></canvas></div></section>` : ''}

      ${r.subscriptions.items.length ? html`<section class="chart-card"><div class="cc-head"><h3>Suscripciones</h3></div>
        <div class="totals-strip inner"><div><span class="eyebrow">Al mes</span><b class="num">${money(r.subscriptions.monthly)}</b></div>
          <div><span class="eyebrow">Al año</span><b class="num">${money(r.subscriptions.yearly)}</b></div></div>
        <div class="bars">${r.subscriptions.items.map((s) => barRow(s.name, s.monthly, r.subscriptions.items[0].monthly, '/mes', s.color))}</div></section>` : ''}
    `);
    animateCounts(body);

    const Chart = await loadChart();
    if (!body.isConnected) return;
    const t = theme();
    const mk = (name, cfg) => {
      const cv = body.querySelector(`[data-chart="${name}"]`);
      if (cv) charts.push(new Chart(cv, cfg));
    };

    mk('monthly', {
      type: 'bar',
      data: {
        labels: r.monthly.map((m) => monthShort(m.m)),
        datasets: [
          { label: 'Ingresos', data: r.monthly.map((m) => m.income), backgroundColor: t.income, borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.7 },
          { label: 'Gastos', data: r.monthly.map((m) => m.expense), backgroundColor: t.ink, borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.7 },
        ],
      },
      options: {
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false } }, y: { ticks: axisMoney, border: { display: false } } },
      },
    });

    if (r.by_category.length) {
      mk('donut', {
        type: 'doughnut',
        data: { labels: r.by_category.map((c) => c.name ?? 'Sin categoría'),
          datasets: [{ data: r.by_category.map((c) => c.total), backgroundColor: r.by_category.map((c) => c.color ?? '#9A9A92'), borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
        options: { cutout: '72%', animation: { animateRotate: true, duration: 1100 },
          plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } },
          onClick: (evt, els) => { if (els[0]) openCategoryDetail(r.by_category[els[0].index], from, to); } },
      });
    }

    let acc = 0;
    const cumulative = r.by_day.map((d) => (acc += Number(d.expense)));
    const lastIdx = Math.min(r.by_day.length, Math.max(0, daysBetween(from, today) + 1));
    const budgetTotal = r.monthly_budget && sel.period === 'month' ? r.monthly_budget : r.daily_limit ? r.daily_limit * days : null;
    mk('cumulative', {
      type: 'line',
      data: {
        labels: r.by_day.map((d) => Number(d.d.slice(8))),
        datasets: [
          { label: 'Gastado', data: cumulative.map((v, i) => (i < lastIdx ? v : null)), borderColor: t.accent, backgroundColor: 'rgba(75,59,245,0.10)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2.5 },
          ...(budgetTotal ? [{ label: 'Presupuesto', data: r.by_day.map((_, i) => Math.round((budgetTotal / days) * (i + 1))), borderColor: t.ink3, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5, fill: false }] : []),
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { title: (c) => `Día ${c[0].label}`, label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { ticks: axisMoney, border: { display: false } } },
      },
    });

    const lineSet = (items, key) => items.map((it, i) => ({
      label: it.name, data: (it.history ?? []).map((h) => h[key]), borderColor: it.color ?? ['#4B3BF5', '#F08A4B', '#2FB3A6', '#E5527A'][i % 4],
      tension: 0.35, pointRadius: 3, pointBackgroundColor: '#fff', borderWidth: 2.5,
    }));
    const lineOpts = { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
      scales: { x: { grid: { display: false } }, y: { ticks: axisMoney, border: { display: false } } } };
    if (r.cards.length) mk('cards', { type: 'line', data: { labels: (r.cards[0].history ?? []).map((h) => monthShort(h.m)), datasets: lineSet(r.cards, 'debt') }, options: lineOpts });
    if (r.debts.length) mk('debts', { type: 'line', data: { labels: (r.debts[0].history ?? []).map((h) => monthShort(h.m)), datasets: lineSet(r.debts, 'balance') }, options: lineOpts });
  };

  const load = async () => {
    const [from, to] = rangeFor(sel.period, sel.anchor);
    screen.querySelector('.period-label').textContent = periodLabel(sel.period, from, to);
    screen.querySelector('[data-nav="1"]').disabled = sel.period === 'custom' || to >= todayISO();
    screen.querySelector('[data-nav="-1"]').disabled = sel.period === 'custom';
    const cr = screen.querySelector('.custom-range');
    cr.hidden = sel.period !== 'custom';
    cr.querySelector('[data-from]').value = from;
    cr.querySelector('[data-to]').value = to;
    try {
      data = { r: await online(() => reportData(from, to)), from, to };
      await settle(body);
      await render(data.r, from, to);
    } catch (err) {
      console.error(err);
      await settle(body);
      body.innerHTML = String(orbError({ title: 'No pudimos cargar tus reportes', text: loadErrorText(err) }));
    }
  };

  const shift = (dir) => {
    const a = sel.anchor;
    sel.anchor = sel.period === 'week' ? addDays(a, 7 * dir) : sel.period === 'month' ? addMonths(a, dir) : sel.period === 'quarter' ? addMonths(a, 3 * dir) : addMonths(a, 12 * dir);
    if (sel.anchor > todayISO()) sel.anchor = todayISO();
    haptic.select();
    body.innerHTML = String(loaderHtml());
    load();
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-seg="period"] button', (e, b) => {
      sel.period = selectSegment(b.parentElement, b.dataset.value);
      sel.anchor = todayISO();
      if (sel.period === 'custom') { sel.from = startOfMonth(todayISO()); sel.to = todayISO(); }
      haptic.select();
      body.innerHTML = String(loaderHtml());
      load();
    }),
    on(screen, 'click', '[data-nav]', (e, b) => shift(Number(b.dataset.nav))),
    on(screen, 'change', '.custom-range input', () => {
      const f = screen.querySelector('[data-from]').value;
      const t = screen.querySelector('[data-to]').value;
      if (f && t && f <= t) { sel.from = f; sel.to = t; load(); } else toast('Revisa el rango de fechas', { type: 'err' });
    }),
    on(screen, 'click', '[data-cat]', (e, b) => { if (data) openCategoryDetail(data.r.by_category[Number(b.dataset.i)], data.from, data.to); }),
    on(screen, 'click', '[data-retry]', load),
    on(screen, 'click', '[data-export]', () => {
      if (!data) return;
      const { r, from, to } = data;
      downloadCSV(`lukas-reporte-${from}_${to}.csv`, ['Sección', 'Concepto', 'Valor'], [
        ['Resumen', 'Ingresos', r.income], ['Resumen', 'Gastos', r.expense], ['Resumen', 'Balance', r.income - r.expense],
        ...r.by_category.map((c) => ['Gastos por categoría', c.name ?? 'Sin categoría', c.total]),
        ...r.by_day.map((d) => ['Gasto diario', d.d, d.expense]),
        ...r.top_descriptions.map((t) => ['Frecuentes', `${t.name} (${t.count})`, t.total]),
      ]);
      toast('Reporte exportado');
    }),
    onChanged((ents) => { if (ents.includes('transactions')) load(); }),
  ];
  load();
  return () => { offs.forEach((f) => f()); destroyCharts(); };
}

function barRow(label, value, max, extra = '', color) {
  const pct = Math.max(2, Math.min(100, (value / (max || 1)) * 100));
  return html`<div class="bar-row"><div class="row between"><span class="ellipsis">${label}</span><span><b class="num">${money(value)}</b> <span class="muted xsmall">${extra}</span></span></div>
    <div class="bar"><span style="width:${pct}%;${color ? `--c:${color}` : ''}"></span></div></div>`;
}

function heatmap(byDay, from) {
  const max = Math.max(1, ...byDay.map((d) => Number(d.expense)));
  const lead = (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes primero
  const many = byDay.length > 62;
  return html`<div class="heat ${many ? 'dense' : ''}">
    ${many ? '' : html`<div class="heat-wd">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => html`<span>${d}</span>`)}</div>`}
    <div class="heat-grid">${Array.from({ length: many ? 0 : lead }, () => html`<span class="hc empty"></span>`)}
      ${byDay.map((d) => {
        const v = Number(d.expense);
        const lvl = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
        return html`<span class="hc l${lvl}" title="${dayLabel(d.d)}: ${money(v)}" aria-label="${dayLabel(d.d)}: ${money(v)}">${many ? '' : Number(d.d.slice(8))}</span>`;
      })}</div>
    <div class="heat-legend"><span class="muted xsmall">Menos</span>${[0, 1, 2, 3, 4].map((l) => html`<span class="hc l${l}"></span>`)}<span class="muted xsmall">Más</span></div>
  </div>`;
}

async function openCategoryDetail(cat, from, to) {
  if (!cat) return;
  const s = openSheet({
    title: cat.name ?? 'Sin categoría',
    body: html`<div class="center mb-4"><b class="num cat-detail-total">${money(cat.total)}</b><div class="muted small">${cat.count} movimientos · ${dateShort(from)} – ${dateShort(to)}</div></div><div class="cd-list">${loaderHtml()}</div>`,
  });
  try {
    const ids = cat.id ? [cat.id] : [];
    if (cat.id) state.categories.filter((c) => c.parent_id === cat.id).forEach((c) => ids.push(c.id));
    const rows = (await listTransactions({ from, to, type: 'expense', categoryIds: ids.length ? ids : undefined, limit: 200 }))
      .filter((t) => (cat.id ? true : !t.category_id));
    await settle(s.body.querySelector('.cd-list'));
    s.body.querySelector('.cd-list').innerHTML = String(html`<div class="list stagger">${rows.map((t, i) => html`<div style="--i:${Math.min(i, 10)}">${txRow(t)}</div>`)}</div>`);
    on(s.body, 'click', '[data-tx]', (e, b) => openTransactionDetail(b.dataset.tx));
  } catch (err) {
    s.body.querySelector('.cd-list').innerHTML = String(html`<p class="muted">${err.message}</p>`);
  }
}
