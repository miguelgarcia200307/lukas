// Reportes: periodo (día, semana, mes, trimestre, año o rango), KPIs con comparación, gráficas (Chart.js),
// calendario de calor, gastos hormiga, insights y CSV. Un solo día tiene su propia vista: límite diario,
// movimientos del día y los últimos 7 días.
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, moneyShort, percent, number } from '../utils/format.js';
import { todayISO, addDays, addMonths, startOfWeek, startOfMonth, endOfMonth, daysBetween, monthLabel, monthShort, dateShort, dayLabel, bogota, weekdayLong, weekdayShort, timeLabel } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, onChanged } from '../state.js';
import { reportData } from '../api/reports.js';
import { listTransactions, listFlows } from '../api/transactions.js';
import { projectMonth } from '../utils/projection.js';
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
const PERIODS = ['day', 'week', 'month', 'quarter', 'year', 'custom'];
const UI_KEY = 'lukas-reports-ui';
const readPeriod = () => { try { const p = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}').period; return PERIODS.includes(p) ? p : 'month'; } catch { return 'month'; } };
const savePeriod = (period) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ period })); } catch { /* modo privado */ } };
const sel = { period: null, anchor: null, from: null, to: null };

function rangeFor(period, anchor) {
  const t = anchor ?? todayISO();
  if (period === 'day') return [t, t];
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
  if (from === to) {
    const today = todayISO();
    const rel = from === today ? 'Hoy' : from === addDays(today, -1) ? 'Ayer' : weekdayLong(from);
    return `${rel} · ${dateShort(from)}`;
  }
  if (period === 'month') return monthLabel(from);
  if (period === 'year') return from.slice(0, 4);
  if (period === 'quarter') return `T${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1} · ${from.slice(0, 4)}`;
  return `${dateShort(from)} – ${dateShort(to)}`;
}

function delta(cur, prev, { invert = false, vs = '' } = {}) {
  if (!prev) return '';
  const d = Math.round(((cur - prev) / prev) * 100);
  const tail = vs ? ` ${vs}` : '';
  if (!Number.isFinite(d) || d === 0) return html`<span class="delta">= igual${tail}</span>`;
  const good = invert ? d < 0 : d > 0;
  return html`<span class="delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%${tail}</span>`;
}

/** Ingresos y gastos por día (Bogotá) de los 7 días que terminan en `day`, desde la lista de movimientos */
export function lastDays(txs, day, n = 7) {
  const out = Array.from({ length: n }, (_, i) => ({ d: addDays(day, i - (n - 1)), income: 0, expense: 0 }));
  const idx = new Map(out.map((x, i) => [x.d, i]));
  for (const t of txs) {
    if (t.type !== 'income' && t.type !== 'expense') continue;
    const i = idx.get(bogota(t.occurred_at).date);
    if (i != null) out[i][t.type] += Number(t.amount);
  }
  return out;
}

function dayInsights(r, day, series) {
  const out = [];
  const isToday = day === todayISO();
  const label = isToday ? 'hoy' : 'ese día';
  const Label = isToday ? 'Hoy' : 'Ese día';
  const prevLabel = isToday ? 'ayer' : 'el día anterior';
  const before = series.slice(0, -1);
  const avg = before.reduce((s, x) => s + x.expense, 0) / Math.max(1, before.length);
  if (r.expense > 0 && avg > 0) {
    const d = Math.round(((r.expense - avg) / avg) * 100);
    if (Math.abs(d) >= 10) out.push({ icon: d > 0 ? 'arrow-up' : 'arrow-down', tone: d > 0 ? 'bad' : 'good', text: `${Label} gastaste ${Math.abs(d)}% ${d > 0 ? 'más' : 'menos'} que tu promedio de los 6 días anteriores (${money(avg)}).` });
  }
  if (!r.expense && r.income) out.push({ icon: 'check', tone: 'good', text: `No registraste gastos ${label}.` });
  const top = r.by_category?.[0];
  if (top && r.expense > 0 && (r.by_category.length > 1 || top.count > 1)) {
    out.push({ icon: 'pie', tone: '', text: `Lo que más se llevó tu plata ${label}: ${top.name ?? 'Sin categoría'} (${money(top.total)}, ${percent((top.total / r.expense) * 100)}).` });
  }
  const changes = (r.by_category ?? []).filter((c) => c.prev_total > 0 && c.total > 20000)
    .map((c) => ({ ...c, d: Math.round(((c.total - c.prev_total) / c.prev_total) * 100) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (changes[0] && Math.abs(changes[0].d) >= 25) {
    const c = changes[0];
    out.push({ icon: c.d > 0 ? 'arrow-up' : 'arrow-down', tone: c.d > 0 ? 'bad' : 'good', text: `En ${c.name} gastaste ${Math.abs(c.d)}% ${c.d > 0 ? 'más' : 'menos'} que ${prevLabel}.` });
  }
  if (r.income > 0 && r.expense > 0) {
    const bal = r.income - r.expense;
    out.push({ icon: 'target', tone: bal >= 0 ? 'good' : 'bad', text: bal >= 0 ? `${Label} te entró más de lo que gastaste: te quedaron ${money(bal)}.` : `${Label} gastaste ${money(-bal)} más de lo que te entró.` });
  }
  if (r.ant?.count >= 3) out.push({ icon: 'coffee', tone: '', text: `${r.ant.count} compras pequeñas ${label} suman ${money(r.ant.total)}.` });
  return out;
}

/** Tarjeta del límite diario del perfil para un día */
function limitCard(r, day) {
  const lim = Number(r.daily_limit) || 0;
  if (!lim) return '';
  const spent = Number(r.expense) || 0;
  const pct = Math.round((spent / lim) * 100);
  const over = spent > lim;
  const isToday = day === todayISO();
  const tone = over ? 'bad' : pct >= 80 ? 'warn' : 'good';
  const msg = over ? `Te pasaste por ${money(spent - lim)}` : spent === lim ? 'Llegaste justo al límite' : isToday ? `Te quedan ${money(lim - spent)}` : `Te sobraron ${money(lim - spent)}`;
  return html`<section class="chart-card day-limit ${tone}"><div class="cc-head"><h3>${icon('target', { size: 18 })}Límite diario</h3><span class="muted small">${percent(pct)}</span></div>
    <div class="dl-line"><b class="num">${money(spent)}</b><span class="muted">de ${money(lim)}</span></div>
    <div class="bar"><span style="width:${Math.max(2, Math.min(100, pct))}%"></span></div>
    <p class="dl-msg">${msg}</p></section>`;
}

function categoryCard(r) {
  if (!r.by_category.length) return '';
  return html`<section class="chart-card"><div class="cc-head"><h3>Gastos por categoría</h3><span class="muted small">Toca para ver detalle</span></div>
    <div class="donut-wrap"><div class="chart-box donut"><canvas data-chart="donut" aria-label="Gastos por categoría"></canvas>
      <div class="donut-center"><span class="eyebrow">Total</span><b class="num">${moneyShort(r.expense)}</b></div></div>
    <div class="legend">${r.by_category.slice(0, 8).map((c, i) => html`<button class="legend-row" data-cat="${c.id ?? ''}" data-i="${i}">
      <span class="dot-lg" style="--c:${c.color ?? '#9A9A92'}"></span><span class="grow ellipsis">${c.name ?? 'Sin categoría'}</span>
      <b class="num">${money(c.total)}</b><span class="muted xsmall">${percent((c.total / r.expense) * 100)}</span></button>`)}</div></div></section>`;
}

const donutConfig = (r, from, to) => ({
  type: 'doughnut',
  data: { labels: r.by_category.map((c) => c.name ?? 'Sin categoría'),
    datasets: [{ data: r.by_category.map((c) => c.total), backgroundColor: r.by_category.map((c) => c.color ?? '#9A9A92'), borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
  options: { cutout: '72%', animation: { animateRotate: true, duration: 1100 },
    plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } },
    onClick: (evt, els) => { if (els[0]) openCategoryDetail(r.by_category[els[0].index], from, to); } },
});

function antCard(r) {
  if (!r.ant?.count) return '';
  return html`<section class="chart-card ant"><div class="cc-head"><h3>${icon('coffee', { size: 18 })}Gastos hormiga</h3><span class="muted small">Compras de ${moneyShort(r.ant.threshold)} o menos</span></div>
    <div class="ant-big"><b class="num">${money(r.ant.total)}</b><span class="muted">en ${r.ant.count} compras pequeñas</span></div>
    <div class="bars">${(r.ant.top ?? []).map((t) => barRow(t.name, t.total, r.ant.top[0].total, `${t.count}×`))}</div></section>`;
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
  if (!sel.period) sel.period = readPeriod();
  if (!sel.anchor) sel.anchor = todayISO();
  const charts = [];
  let data = null;

  screen.innerHTML = String(html`
    ${topbar({ title: 'Reportes', large: true, right: html`<button class="icon-btn filled" data-export aria-label="Exportar CSV">${icon('download')}</button>` })}
    <div class="scroller"><div class="content reports">
      ${segmented('period', [{ value: 'day', label: 'Día' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }, { value: 'quarter', label: 'Trim.' }, { value: 'year', label: 'Año' }, { value: 'custom', label: 'Rango' }], sel.period)}
      <div class="period-nav">
        <button class="icon-btn" data-nav="-1" aria-label="Periodo anterior">${icon('chevron-left', { stroke: 2.2 })}</button>
        <div class="period-mid">
          <div class="period-label"></div>
          <input class="day-pick" type="date" data-day-pick aria-label="Elegir día" hidden>
        </div>
        <button class="icon-btn" data-nav="1" aria-label="Periodo siguiente">${icon('chevron-right', { stroke: 2.2 })}</button>
      </div>
      <div class="period-today" hidden><button class="chip-link" data-go-today>${icon('calendar', { size: 14 })}Volver a hoy</button></div>
      <div class="custom-range" hidden><input class="input" type="date" data-from aria-label="Desde"><input class="input" type="date" data-to aria-label="Hasta"></div>
      <div class="rep-body">${loaderHtml()}</div>
    </div></div>`);

  const body = screen.querySelector('.rep-body');
  const destroyCharts = () => { charts.splice(0).forEach((c) => c.destroy()); };
  const chartMaker = async () => {
    const Chart = await loadChart();
    if (!body.isConnected) return null;
    return (name, cfg) => {
      const cv = body.querySelector(`[data-chart="${name}"]`);
      if (cv) charts.push(new Chart(cv, cfg));
    };
  };

  // ── Un solo día ──
  const renderDay = async (r, day, txs) => {
    destroyCharts();
    const today = todayISO();
    const isToday = day === today;
    const dayTx = txs.filter((t) => bogota(t.occurred_at).date === day);
    const series = lastDays(txs, day);
    const balance = r.income - r.expense;
    const nIn = dayTx.filter((t) => t.type === 'income').length;
    const nOut = dayTx.filter((t) => t.type === 'expense').length;
    const vs = isToday ? 'vs ayer' : 'vs día anterior';

    if (!dayTx.length && !r.expense && !r.income) {
      body.innerHTML = String(html`${emptyState({ illus: 'chart', title: isToday ? 'Hoy aún no hay movimientos' : 'Sin movimientos ese día',
        text: isToday ? 'Cuando registres un gasto o un ingreso, aquí verás cómo va tu día.' : 'Usa las flechas o toca la fecha para ver otro día.' })}
        ${series.some((s) => s.income || s.expense) ? weekCard() : ''}`);
      await drawWeek(series, day);
      return;
    }

    body.innerHTML = String(html`
      <div class="kpis day-kpis stagger">
        <div class="kpi" style="--i:0"><span class="eyebrow">Ingresos</span><b class="num income" data-count="${r.income}">$0</b>${delta(r.income, r.prev_income, { vs })}</div>
        <div class="kpi" style="--i:1"><span class="eyebrow">Gastos</span><b class="num" data-count="${r.expense}">$0</b>${delta(r.expense, r.prev_expense, { invert: true, vs })}</div>
        <div class="kpi" style="--i:2"><span class="eyebrow">Balance del día</span><b class="num ${balance < 0 ? 'expense-txt' : balance > 0 ? 'income' : ''}" data-balance>${balance > 0 ? '+' : ''}${money(balance)}</b></div>
        <div class="kpi" style="--i:3"><span class="eyebrow">Movimientos</span><b class="num">${number(nIn + nOut)}</b><span class="delta">${nOut} ${nOut === 1 ? 'gasto' : 'gastos'} · ${nIn} ${nIn === 1 ? 'ingreso' : 'ingresos'}</span></div>
      </div>

      ${limitCard(r, day)}

      ${(() => { const ins = dayInsights(r, day, series); return ins.length ? html`<section class="section insights">${ins.map((x) => html`<div class="insight ${x.tone}">${icon(x.icon, { size: 18 })}<span>${x.text}</span></div>`)}</section>` : ''; })()}

      <section class="section day-moves"><div class="section-head"><h2 class="section-title">${isToday ? 'Movimientos de hoy' : 'Movimientos del día'}</h2><span class="muted small">${dayTx.length}</span></div>
        ${dayTx.length ? html`<div class="list stagger">${dayTx.map((t, i) => html`<div style="--i:${Math.min(i, 10)}">${txRow(t)}</div>`)}</div>`
          : html`<p class="muted small">Sin movimientos registrados.</p>`}</section>

      ${categoryCard(r)}
      ${weekCard()}
      ${antCard(r)}
    `);
    animateCounts(body);
    const mk = await chartMaker();
    if (!mk) return;
    if (r.by_category.length) mk('donut', donutConfig(r, day, day));
    drawWeek(series, day, mk);
  };

  const weekCard = () => html`<section class="chart-card"><div class="cc-head"><h3>Últimos 7 días</h3><span class="muted small">Toca un día para verlo</span></div>
    <div class="chart-box"><canvas data-chart="week" aria-label="Ingresos y gastos de los últimos 7 días"></canvas></div></section>`;

  const drawWeek = async (series, day, mk) => {
    mk ??= await chartMaker();
    if (!mk) return;
    const t = theme();
    const today = todayISO();
    const fade = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? `${c}${a}` : c);
    mk('week', {
      type: 'bar',
      data: {
        labels: series.map((s) => (s.d === today ? ['Hoy', String(Number(s.d.slice(8)))] : [weekdayShort(s.d), String(Number(s.d.slice(8)))])),
        datasets: [
          { label: 'Ingresos', data: series.map((s) => s.income), backgroundColor: series.map((s) => (s.d === day ? t.income : fade(t.income, '55'))), borderRadius: 6, barPercentage: 0.8, categoryPercentage: 0.7 },
          { label: 'Gastos', data: series.map((s) => s.expense), backgroundColor: series.map((s) => (s.d === day ? t.ink : fade(t.ink, '38'))), borderRadius: 6, barPercentage: 0.8, categoryPercentage: 0.7 },
        ],
      },
      options: {
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle',
            // Colores llenos en la leyenda (las barras de otros días van atenuadas)
            generateLabels: (ch) => ch.data.datasets.map((ds, i) => ({ text: ds.label, fillStyle: [t.income, t.ink][i], strokeStyle: [t.income, t.ink][i], lineWidth: 0,
              pointStyle: 'circle', fontColor: t.ink3, hidden: !ch.isDatasetVisible(i), datasetIndex: i })) } },
          tooltip: { callbacks: { title: (c) => dayLabel(series[c[0].dataIndex].d), label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false } }, y: { ticks: axisMoney, border: { display: false } } },
        onHover: (evt, els) => { if (evt.native?.target) evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: (evt, els) => { const i = els[0]?.index; if (i != null && series[i].d !== day) goDay(series[i].d); },
      },
    });
  };

  const render = async (r, from, to, proj = null) => {
    destroyCharts();
    const days = daysBetween(from, to) + 1;
    const today = todayISO();
    const elapsed = Math.max(1, Math.min(days, daysBetween(from, today) + 1));
    const avg = r.expense / elapsed;
    const isCurrentMonth = sel.period === 'month' && from === startOfMonth(today);
    // Sin datos para el modelo (falló la consulta) se usa el cálculo lineal de antes
    const projection = proj ? proj.total : isCurrentMonth ? Math.round(avg * days) : null;
    const overBudget = proj && r.monthly_budget ? proj.total - r.monthly_budget : null;
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
        <div class="kpi" style="--i:3"><span class="eyebrow">Tasa de ahorro</span><b class="num">${rate == null ? '—' : percent(rate)}</b>${proj?.savingsRate != null && proj.income.pending.length ? html`<span class="delta" data-proj-rate>Al cierre: ~${percent(proj.savingsRate)}</span>` : ''}</div>
        <div class="kpi" style="--i:4"><span class="eyebrow">Promedio diario</span><b class="num">${money(avg)}</b><span class="delta">en ${elapsed} ${elapsed === 1 ? 'día' : 'días'}</span></div>
        ${proj ? html`<button class="kpi kpi-btn" style="--i:5" data-projection aria-label="Ver cómo se calcula la proyección">
            <span class="eyebrow">Proyección ${icon('chevron-right', { size: 14, stroke: 2.4 })}</span><b class="num" data-proj-total>${money(projection)}</b>
            <span class="delta ${overBudget > 0 ? 'bad' : overBudget != null ? 'good' : ''}" data-proj-sub>${overBudget != null ? (overBudget > 0 ? `${moneyShort(overBudget)} sobre el presupuesto` : 'Dentro del presupuesto') : `${moneyShort(proj.low)} – ${moneyShort(proj.high)}`}</span></button>`
          : html`<div class="kpi" style="--i:5"><span class="eyebrow">${projection != null ? 'Proyección del mes' : 'Movimientos'}</span><b class="num">${projection != null ? money(projection) : number(r.expense_count)}</b></div>`}
      </div>

      ${ins.length ? html`<section class="section insights">${ins.map((x) => html`<div class="insight ${x.tone}">${icon(x.icon, { size: 18 })}<span>${x.text}</span></div>`)}</section>` : ''}

      <section class="chart-card"><div class="cc-head"><h3>Ingresos vs gastos</h3><span class="muted small">Últimos 12 meses</span></div>
        <div class="chart-box"><canvas data-chart="monthly" aria-label="Gráfica de ingresos y gastos por mes"></canvas></div></section>

      ${categoryCard(r)}

      <section class="chart-card"><div class="cc-head"><h3>Gasto acumulado</h3><span class="muted small">${proj ? (r.monthly_budget || r.daily_limit ? 'proyección y presupuesto' : 'con proyección') : r.monthly_budget || r.daily_limit ? 'vs presupuesto' : 'en el periodo'}</span></div>
        <div class="chart-box"><canvas data-chart="cumulative" aria-label="Gasto acumulado"></canvas></div></section>

      <section class="chart-card"><div class="cc-head"><h3>Calendario de gasto</h3><span class="muted small">Más oscuro = más gasto</span></div>
        ${heatmap(r.by_day, from)}</section>

      ${antCard(r)}

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

    const mk = await chartMaker();
    if (!mk) return;
    const t = theme();

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

    if (r.by_category.length) mk('donut', donutConfig(r, from, to));

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
          // Proyección: arranca en lo gastado hoy y sigue la curva del modelo hasta fin de mes
          ...(proj && lastIdx > 0 ? [{ label: 'Proyección', borderColor: t.accent, borderDash: [3, 4], pointRadius: 0, borderWidth: 2, fill: false, tension: 0.25,
            data: r.by_day.map((_, i) => (i < lastIdx - 1 ? null : i === lastIdx - 1 ? cumulative[i] : proj.curve[i - lastIdx + 1]?.value ?? null)) }] : []),
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

  let seq = 0;
  const load = async () => {
    const [from, to] = rangeFor(sel.period, sel.anchor);
    const today = todayISO();
    const isDay = from === to;
    const my = ++seq;
    screen.querySelector('.period-label').textContent = periodLabel(sel.period, from, to);
    screen.querySelector('[data-nav="1"]').disabled = sel.period === 'custom' || to >= today;
    screen.querySelector('[data-nav="-1"]').disabled = sel.period === 'custom';
    const pick = screen.querySelector('[data-day-pick]');
    pick.hidden = sel.period !== 'day';
    pick.max = today;
    pick.value = from;
    screen.querySelector('.period-mid').classList.toggle('pickable', sel.period === 'day');
    screen.querySelector('.period-today').hidden = sel.period !== 'day' || from === today;
    const cr = screen.querySelector('.custom-range');
    cr.hidden = sel.period !== 'custom';
    cr.querySelector('[data-from]').value = from;
    cr.querySelector('[data-to]').value = to;
    try {
      // Un día: además de los totales, los movimientos de los últimos 7 días (lista del día + gráfica semanal)
      // Mes en curso: ingresos y gastos desde 3 meses antes para la proyección (historial, pagos mensuales)
      const isCurrentMonth = sel.period === 'month' && from <= today && today <= to;
      const [r, txs, flows] = await online(() => Promise.all([
        reportData(from, to),
        isDay ? listTransactions({ from: addDays(from, -6), to, limit: 1000 }) : null,
        isCurrentMonth ? listFlows(addMonths(from, -3), today).catch((err) => { console.error('[proyección]', err); return null; }) : null,
      ]));
      if (my !== seq) return;
      const proj = flows ? projectMonth({ today, from, to, txs: flows, subscriptions: state.subscriptions ?? [] }) : null;
      data = { r, from, to, txs, proj };
      await settle(body);
      if (my !== seq) return;
      if (isDay) await renderDay(r, from, txs ?? []);
      else await render(r, from, to, proj);
    } catch (err) {
      if (my !== seq) return;
      console.error(err);
      await settle(body);
      body.innerHTML = String(orbError({ title: 'No pudimos cargar tus reportes', text: loadErrorText(err) }));
    }
  };

  const shift = (dir) => {
    const a = sel.anchor;
    sel.anchor = sel.period === 'day' ? addDays(a, dir) : sel.period === 'week' ? addDays(a, 7 * dir) : sel.period === 'month' ? addMonths(a, dir) : sel.period === 'quarter' ? addMonths(a, 3 * dir) : addMonths(a, 12 * dir);
    if (sel.anchor > todayISO()) sel.anchor = todayISO();
    haptic.select();
    body.innerHTML = String(loaderHtml());
    load();
  };

  function goDay(d) {
    const today = todayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '')) return;
    if (sel.period !== 'day') { sel.period = selectSegment(screen.querySelector('[data-seg="period"]'), 'day'); savePeriod('day'); }
    sel.anchor = d > today ? today : d;
    haptic.select();
    body.innerHTML = String(loaderHtml());
    load();
  }

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-seg="period"] button', (e, b) => {
      sel.period = selectSegment(b.parentElement, b.dataset.value);
      savePeriod(sel.period);
      sel.anchor = todayISO();
      if (sel.period === 'custom') { sel.from = startOfMonth(todayISO()); sel.to = todayISO(); }
      haptic.select();
      body.innerHTML = String(loaderHtml());
      load();
    }),
    on(screen, 'click', '[data-nav]', (e, b) => shift(Number(b.dataset.nav))),
    on(screen, 'click', '[data-day-pick]', (e, b) => { try { b.showPicker?.(); } catch { /* sin gesto o no soportado */ } }),
    on(screen, 'change', '[data-day-pick]', (e, b) => { if (b.value && b.value !== sel.anchor) goDay(b.value); }),
    on(screen, 'click', '[data-go-today]', () => goDay(todayISO())),
    on(screen, 'click', '[data-projection]', () => { if (data?.proj) { haptic.select(); openProjection(data.proj, data.r); } }),
    on(screen, 'click', '.day-moves [data-tx]', (e, b) => openTransactionDetail(b.dataset.tx)),
    on(screen, 'change', '.custom-range input', () => {
      const f = screen.querySelector('[data-from]').value;
      const t = screen.querySelector('[data-to]').value;
      if (f && t && f <= t) { sel.from = f; sel.to = t; load(); } else toast('Revisa el rango de fechas', { type: 'err' });
    }),
    on(screen, 'click', '[data-cat]', (e, b) => { if (data) openCategoryDetail(data.r.by_category[Number(b.dataset.i)], data.from, data.to); }),
    on(screen, 'click', '[data-retry]', load),
    on(screen, 'click', '[data-export]', () => {
      if (!data) return;
      const { r, from, to, txs } = data;
      const sign = { income: 1, expense: -1 };
      const dayRows = (txs ?? []).filter((t) => sign[t.type] && bogota(t.occurred_at).date === from)
        .map((t) => ['Movimientos del día', `${timeLabel(t.occurred_at)} · ${t.description || (t.type === 'income' ? 'Ingreso' : 'Gasto')}`, sign[t.type] * Number(t.amount)]);
      downloadCSV(from === to ? `lukas-reporte-${from}.csv` : `lukas-reporte-${from}_${to}.csv`, ['Sección', 'Concepto', 'Valor'], [
        ['Resumen', 'Ingresos', r.income], ['Resumen', 'Gastos', r.expense], ['Resumen', 'Balance', r.income - r.expense],
        ...r.by_category.map((c) => ['Gastos por categoría', c.name ?? 'Sin categoría', c.total]),
        ...(from === to ? dayRows : r.by_day.map((d) => ['Gasto diario', d.d, d.expense])),
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

const CONF_TEXT = {
  alta: (p) => `Confianza alta · ${Math.round(p.histDays / 7)} semanas de historial`,
  media: () => 'Confianza media · aún hay poco historial',
  baja: () => 'Confianza baja · mejora a medida que registres',
};

/** Detalle de la proyección del mes: de dónde sale cada peso */
export function openProjection(p, r) {
  const shortDate = (d) => dateShort(d);
  const items = (list, sub) => list.map((x) => html`<div class="pj-item"><span class="ellipsis">${x.name}</span><span class="muted xsmall">${sub(x)}</span><b class="num">${money(x.amount)}</b></div>`);
  const budget = Number(r.monthly_budget) || 0;
  const saved = p.income.total - p.total;
  openSheet({
    title: 'Proyección del mes',
    className: 'pj-sheet',
    body: html`
      <div class="pj-hero">
        <b class="num pj-total">${money(p.total)}</b>
        <div class="muted small">Lo más probable: entre ${money(p.low)} y ${money(p.high)}</div>
        <span class="pj-conf ${p.confidence}">${CONF_TEXT[p.confidence](p)}</span>
      </div>
      <div class="pj-rows">
        <div class="pj-row"><div><b>Ya gastaste</b><span class="muted xsmall">Hasta hoy, real</span></div><b class="num">${money(p.spent)}</b></div>
        <div class="pj-row"><div><b>Día a día que falta</b><span class="muted xsmall">${p.restDays} ${p.restDays === 1 ? 'día' : 'días'} · ~${money(p.perDay)} al día, según el día de la semana</span></div><b class="num">${money(p.variableRemaining)}</b></div>
        ${p.scheduled.length ? html`<div class="pj-row"><div><b>Suscripciones por cobrar</b></div><b class="num">${money(p.scheduledTotal)}</b></div>
          <div class="pj-items">${items(p.scheduled, (x) => shortDate(x.date))}</div>` : ''}
        ${p.pending.length ? html`<div class="pj-row"><div><b>Pagos de cada mes que faltan</b><span class="muted xsmall">Los haces todos los meses y aún no aparecen</span></div><b class="num">${money(p.pendingTotal)}</b></div>
          <div class="pj-items">${items(p.pending, (x) => (x.late ? `suele ser el día ${x.day}` : `~${shortDate(x.date)}`))}</div>` : ''}
        <div class="pj-row total"><b>Proyección</b><b class="num">${money(p.total)}</b></div>
      </div>
      ${budget ? html`<div class="pj-note ${p.total > budget ? 'bad' : 'good'}">${icon('target', { size: 18 })}<span>Tu presupuesto del mes es ${money(budget)}: ${p.total > budget ? `te pasarías por ${money(p.total - budget)}.` : `te sobrarían ${money(budget - p.total)}.`}
        ${p.restDays > 0 && p.total > budget ? (budget - p.spent - p.scheduledTotal - p.pendingTotal > 0
          ? ` Para cumplirlo, gasta máximo ${money((budget - p.spent - p.scheduledTotal - p.pendingTotal) / p.restDays)} al día en el día a día.`
          : ' Con los pagos que faltan ya no alcanza, aunque no gastes nada más.') : ''}</span></div>` : ''}
      ${p.income.total > 0 ? html`<div class="pj-note ${saved >= 0 ? 'good' : 'bad'}">${icon('arrow-in', { size: 18 })}<span>Te han entrado ${money(p.income.soFar)} este mes${p.income.pending.length ? html` y esperamos ${money(p.income.total - p.income.soFar)} más (${p.income.pending.map((x) => `${x.name}, ~${shortDate(x.date)}`).join(' · ')})` : ''}.
        ${saved >= 0 ? `Cerrarías el mes ahorrando ~${money(saved)} (${percent(p.savingsRate)}).` : `Gastarías ~${money(-saved)} más de lo que te entra.`}</span></div>` : ''}
      <details class="pj-how"><summary>¿Cómo lo calculo?</summary>
        <p>Sumo lo que ya gastaste, lo que sueles gastar cada día de la semana (mezclo tus últimas 8 semanas con el ritmo de este mes: al principio pesa más tu historial y a medida que avanza el mes pesa más este mes), las suscripciones que se cobran antes de fin de mes y los pagos que haces cada mes y todavía no aparecen.</p>
        <p>Las compras muy grandes y poco comunes ya están en "Ya gastaste", pero no se repiten hacia adelante. El rango muestra cuánto suele variar tu gasto diario.</p>
      </details>`,
  });
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
