// Presupuestos por categoría y periodo (más el límite diario del perfil)
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number } from '../utils/format.js';
import { state, subscribe, topCategories } from '../state.js';
import { budgetStatus, saveBudget, deleteBudget } from '../api/budgets.js';
import { updateProfile } from '../api/profile.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar, progressBar } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { toast } from '../ui/toast.js';

export const title = 'Presupuestos';
const PERIOD = { daily: 'Hoy', weekly: 'Esta semana', monthly: 'Este mes' };

function openBudgetForm(b = null) {
  formSheet({
    title: b ? 'Editar presupuesto' : 'Nuevo presupuesto',
    fields: [
      { name: 'category_id', label: 'Categoría', type: 'select', value: b?.category_id ?? '',
        options: [{ value: '', label: 'Todos los gastos' }, ...topCategories('expense').map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'period', label: 'Periodo', type: 'select', value: b?.period ?? 'monthly', options: [
        { value: 'monthly', label: 'Mensual' }, { value: 'weekly', label: 'Semanal' }, { value: 'daily', label: 'Diario' }] },
      { name: 'amount', label: 'Límite', type: 'amount', value: b?.amount, required: true },
      { name: 'warn', label: 'Avisarme también al…', type: 'select', value: String(b?.alert_thresholds?.[0] ?? 80), options: [
        { value: '50', label: '50%' }, { value: '70', label: '70%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }],
        hint: 'Siempre te aviso al 100% y si te pasas.' },
    ],
    onSubmit: async (v) => {
      await saveBudget({ id: b?.id, category_id: v.category_id || null, period: v.period, amount: v.amount, alert_thresholds: [Number(v.warn), 100] });
      toast('Presupuesto guardado');
    },
    onDelete: b ? async () => { await deleteBudget(b.id); toast('Presupuesto eliminado'); } : null,
  });
}

function openDailyLimit() {
  formSheet({
    title: 'Límite diario',
    intro: 'Lo ves en Inicio alrededor del orbe. Te aviso al 80%, al 100% y si te pasas.',
    fields: [{ name: 'daily_limit', label: 'Puedo gastar al día', type: 'amount', value: state.profile?.daily_limit, hint: 'Déjalo en 0 para desactivarlo.' }],
    onSubmit: async (v) => { await updateProfile({ daily_limit: v.daily_limit || 0 }); toast('Límite actualizado'); },
  });
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Presupuestos', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nuevo presupuesto">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="bud-body"><div class="sk" style="height:120px;border-radius:20px"></div></div></div></div>`);
  const body = screen.querySelector('.bud-body');

  const load = async () => {
    try {
      const status = await budgetStatus();
      const daily = status.find((s) => !s.budget_id);
      const rest = status.filter((s) => s.budget_id);
      const card = (s, i) => html`<button class="card card-pad budget-card pressable" style="--i:${i}" ${s.budget_id ? html`data-id="${s.budget_id}"` : 'data-daily'}>
        <div class="row between"><div class="row gap-2"><span class="dot-lg" style="--c:${s.color}"></span><span class="row-title">${s.name}</span></div>
          <span class="tag">${PERIOD[s.period]}</span></div>
        <div class="row between mt-3"><b class="num">${money(s.spent)}</b><span class="muted small">de ${money(s.amount)}</span></div>
        <div class="mt-2">${progressBar(Number(s.pct), { color: s.color })}</div>
        <div class="row-sub mt-2">${Number(s.pct) >= 100 ? `Te pasaste por ${money(s.spent - s.amount)}` : `Te quedan ${money(s.amount - s.spent)} · ${number(s.pct)}%`}</div>
      </button>`;
      body.innerHTML = String(html`
        <div class="stack gap-3 stagger">
          ${daily ? card(daily, 0) : html`<button class="card card-pad pressable" data-daily><div class="row gap-3">${icon('target')}<span class="row-title">Define tu límite diario</span></div></button>`}
          ${rest.map((s, i) => card(s, i + 1))}
        </div>
        ${rest.length ? '' : emptyState({ illus: 'chart', title: 'Presupuestos por categoría', text: 'Ponle un tope mensual a Comida, Transporte o lo que quieras cuidar.', action: { label: 'Crear presupuesto', attrs: 'data-new' } })}`);
    } catch (err) {
      body.innerHTML = String(emptyState({ illus: 'chart', title: 'No pudimos cargar tus presupuestos', text: err.message }));
    }
  };
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openBudgetForm()),
    on(screen, 'click', '[data-daily]', openDailyLimit),
    on(screen, 'click', '[data-id]', (e, b) => openBudgetForm(state.budgets.find((x) => x.id === b.dataset.id))),
    subscribe('budgets', load),
    subscribe('profile', load),
  ];
  load();
  refresh('budgets');
  return () => offs.forEach((f) => f());
}
