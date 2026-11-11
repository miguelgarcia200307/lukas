// Metas de ahorro con aportes
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number } from '../utils/format.js';
import { dateShort, daysBetween, todayISO, inputParts, toTimestamp } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe } from '../state.js';
import { createGoal, updateGoal, deleteGoal, contribute } from '../api/goals.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar, ring, animateRings } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { toast } from '../ui/toast.js';

export const title = 'Metas';

function openGoalForm(g = null) {
  formSheet({
    title: g ? 'Editar meta' : 'Nueva meta',
    fields: [
      { name: 'name', label: 'Meta', value: g?.name, required: true, placeholder: 'Viaje a Cartagena, fondo de emergencia…' },
      { name: 'target_amount', label: 'Cuánto necesitas', type: 'amount', value: g?.target_amount, required: true },
      { name: 'target_date', label: 'Para cuándo (opcional)', type: 'date', value: g?.target_date ?? '' },
      { name: 'color', label: 'Color', type: 'color', value: g?.color ?? '#2FB3A6' },
      ...(g ? [{ name: 'archived', label: 'Archivar', type: 'switch', value: g.archived }] : []),
    ],
    onSubmit: async (v) => {
      const row = { ...v, target_date: v.target_date || null };
      if (g) await updateGoal(g.id, row); else await createGoal(row);
      toast(g ? 'Meta actualizada' : 'Meta creada');
    },
    onDelete: g ? async () => { await deleteGoal(g.id); toast('Meta eliminada'); } : null,
  });
}

function openContribution(g, withdraw = false) {
  formSheet({
    title: withdraw ? `Retirar de ${g.name}` : `Aportar a ${g.name}`,
    submitLabel: withdraw ? 'Retirar' : 'Aportar',
    fields: [
      { name: 'amount', label: 'Monto', type: 'amount', required: true },
      { name: 'account_id', label: withdraw ? 'Solo registro (no mueve plata)' : 'Sale de la cuenta', type: 'select', value: withdraw ? '' : state.profile?.default_account_id ?? '',
        options: [{ value: '', label: 'No mover plata (solo registrar)' }, ...state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))],
        show: () => !withdraw },
      { name: 'date', label: 'Fecha', type: 'date', value: inputParts().date },
    ],
    onSubmit: async (v) => {
      await contribute({ goalId: g.id, amount: withdraw ? -v.amount : v.amount, accountId: withdraw ? null : v.account_id || null, date: toTimestamp(v.date, inputParts().time) });
      haptic.success();
      toast(withdraw ? 'Retiro registrado' : `¡Vas por buen camino! +${money(v.amount)}`);
    },
  });
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Metas de ahorro', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nueva meta">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="goals-body"></div></div></div>`);
  const body = screen.querySelector('.goals-body');
  const render = () => {
    const list = state.goals.filter((g) => !g.archived);
    if (!list.length) {
      body.innerHTML = String(emptyState({ illus: 'target', title: 'Aún no tienes metas', text: 'Crea una meta y dime “ahorré 100 lucas para el viaje” cuando aportes.', action: { label: 'Crear meta', attrs: 'data-new' } }));
      return;
    }
    body.innerHTML = String(html`<div class="stack gap-4 stagger">${list.map((g, i) => {
      const pct = Number(g.progress_pct) / 100;
      const left = Math.max(0, Number(g.target_amount) - Number(g.saved));
      const days = g.target_date ? daysBetween(todayISO(), g.target_date) : null;
      const perMonth = days && days > 0 && left > 0 ? Math.ceil(left / Math.max(1, days / 30)) : null;
      return html`<div class="card card-pad goal-card" style="--i:${i}">
        <div class="row gap-4">
          ${ring(pct, { size: 76, stroke: 8, color: g.color, children: html`<b class="num small">${number(g.progress_pct)}%</b>` })}
          <div class="grow">
            <button class="row-title goal-name" data-edit="${g.id}">${g.name}</button>
            <div class="num bold goal-saved">${money(g.saved)} <span class="muted small">de ${money(g.target_amount)}</span></div>
            <div class="row-sub">${left ? `Faltan ${money(left)}` : '¡Meta cumplida!'}${g.target_date ? ` · ${dateShort(g.target_date)}` : ''}${perMonth ? ` · ~${money(perMonth)}/mes` : ''}</div>
          </div>
        </div>
        <div class="row gap-2 mt-4">
          <button class="btn btn-secondary btn-sm grow" data-add="${g.id}">${icon('plus', { size: 16 })}Aportar</button>
          <button class="btn btn-ghost btn-sm" data-withdraw="${g.id}">Retirar</button>
        </div>
      </div>`;
    })}</div>`);
    animateRings(body);
  };
  const find = (id) => state.goals.find((g) => g.id === id);
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openGoalForm()),
    on(screen, 'click', '[data-edit]', (e, b) => openGoalForm(find(b.dataset.edit))),
    on(screen, 'click', '[data-add]', (e, b) => openContribution(find(b.dataset.add))),
    on(screen, 'click', '[data-withdraw]', (e, b) => openContribution(find(b.dataset.withdraw), true)),
    subscribe('goals', render),
  ];
  render();
  refresh('goals');
  return () => offs.forEach((f) => f());
}
