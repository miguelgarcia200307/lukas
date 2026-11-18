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
import { confirmDialog } from '../ui/modal.js';
import { actionMenu } from '../ui/action-menu.js';
import { runSave } from '../ui/submit.js';
import { enableSwipe, enableLongPress } from '../ui/gestures.js';

export const title = 'Metas';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Qué se pierde al eliminar: la meta y sus aportes; los movimientos en cuentas se quedan */
function deleteCopy(g) {
  const saved = Number(g.saved) || 0;
  return {
    title: `¿Eliminar “${g.name}”?`,
    message: saved > 0
      ? `Se borran la meta y su historial de aportes (${money(saved)}). Lo que ya moviste desde tus cuentas sigue en tus movimientos.`
      : 'Se borra la meta. Esta acción no se puede deshacer.',
  };
}

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
    deleteLabel: 'Eliminar meta',
    deleteConfirm: g ? deleteCopy(g) : undefined,
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

/** Menú de la meta (botón ⋯, mantener presionado o clic derecho) → 'edit' | 'archive' | 'restore' | 'delete' | null */
function goalMenu(g) {
  const pct = Number(g.progress_pct) / 100;
  return actionMenu({
    label: `Opciones de ${g.name}`,
    header: html`${ring(pct, { size: 44, stroke: 5, color: g.color })}
      <div class="grow"><div class="row-title ellipsis">${g.name}</div>
      <div class="row-sub">${money(g.saved)} de ${money(g.target_amount)}</div></div>`,
    actions: [
      { id: 'edit', label: 'Editar meta', icon: 'edit' },
      g.archived ? { id: 'restore', label: 'Restaurar meta', icon: 'undo' } : { id: 'archive', label: 'Archivar', icon: 'archive' },
      { id: 'delete', label: 'Eliminar meta', icon: 'trash', danger: true },
    ],
    onOpen: (s) => animateRings(s.body),
  });
}

const goalCard = (g, i) => {
  const pct = Number(g.progress_pct) / 100;
  const left = Math.max(0, Number(g.target_amount) - Number(g.saved));
  const days = g.target_date ? daysBetween(todayISO(), g.target_date) : null;
  const perMonth = days && days > 0 && left > 0 ? Math.ceil(left / Math.max(1, days / 30)) : null;
  return html`<div class="swipe goal-swipe" data-id="${g.id}" style="--i:${i}">
    <div class="swipe-actions" aria-hidden="true">
      <button class="act-edit" data-swipe="edit" tabindex="-1">${icon('edit', { size: 20 })}Editar</button>
      <button class="act-delete" data-swipe="delete" tabindex="-1">${icon('trash', { size: 20 })}Eliminar</button>
    </div>
    <div class="swipe-content card card-pad goal-card">
      <button class="icon-btn goal-more" data-menu="${g.id}" aria-label="Opciones de ${g.name}" aria-haspopup="menu">${icon('dots')}</button>
      <div class="row gap-4">
        ${ring(pct, { size: 76, stroke: 8, color: g.color, children: html`<b class="num small">${number(g.progress_pct)}%</b>` })}
        <div class="grow goal-info">
          <button class="row-title goal-name" data-edit="${g.id}">${g.name}</button>
          <div class="num bold goal-saved">${money(g.saved)} <span class="muted small">de ${money(g.target_amount)}</span></div>
          <div class="row-sub">${left ? `Faltan ${money(left)}` : '¡Meta cumplida!'}${g.target_date ? ` · ${dateShort(g.target_date)}` : ''}${perMonth ? ` · ~${money(perMonth)}/mes` : ''}</div>
        </div>
      </div>
      <div class="row gap-2 mt-4">
        <button class="btn btn-secondary btn-sm grow" data-add="${g.id}">${icon('plus', { size: 16 })}Aportar</button>
        <button class="btn btn-ghost btn-sm" data-withdraw="${g.id}">Retirar</button>
      </div>
    </div>
  </div>`;
};

const archivedRow = (g) => html`<div class="list-row goal-arch" data-id="${g.id}">
    <span class="dot-lg" style="--c:${g.color}"></span>
    <div class="grow"><div class="row-title ellipsis">${g.name}</div>
      <div class="row-sub">${money(g.saved)} de ${money(g.target_amount)}</div></div>
    <button class="icon-btn" data-menu="${g.id}" aria-label="Opciones de ${g.name}" aria-haspopup="menu">${icon('dots')}</button>
  </div>`;

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Metas de ahorro', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nueva meta">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="goals-body"></div></div></div>`);
  const body = screen.querySelector('.goals-body');
  let showArchived = false;
  const render = () => {
    const list = state.goals.filter((g) => !g.archived);
    const archived = state.goals.filter((g) => g.archived);
    const arch = archived.length ? html`<div class="section goal-archived">
        <button class="section-head goal-arch-toggle" data-arch-toggle aria-expanded="${showArchived ? 'true' : 'false'}">
          <span class="section-title">Archivadas <span class="muted">${archived.length}</span></span>${icon('chevron-down', { size: 20 })}</button>
        ${showArchived ? html`<div class="list">${archived.map(archivedRow)}</div>` : ''}
      </div>` : '';
    if (!list.length) {
      body.innerHTML = String(html`${emptyState({ illus: 'target', title: 'Aún no tienes metas', text: 'Crea una meta y dime “ahorré 100 lucas para el viaje” cuando aportes.', action: { label: 'Crear meta', attrs: 'data-new' } })}${arch}`);
      return;
    }
    body.innerHTML = String(html`<div class="stack gap-4 stagger">${list.map(goalCard)}</div>${arch}`);
    animateRings(body);
  };
  const find = (id) => state.goals.find((g) => g.id === id);
  const patchLocal = (id, patch) => { state.goals = state.goals.map((x) => (x.id === id ? { ...x, ...patch } : x)); };

  const remove = async (g) => {
    if (!g) return;
    if (!(await confirmDialog({ ...deleteCopy(g), confirm: 'Eliminar', danger: true }))) return;
    // Optimista, como en las apps nativas: la tarjeta se va de inmediato; si el servidor falla, vuelve y se avisa
    body.querySelector(`[data-id="${g.id}"]`)?.classList.add('removing');
    await wait(320);
    const before = state.goals;
    state.goals = before.filter((x) => x.id !== g.id);
    const r = await runSave(() => deleteGoal(g.id), { fallbackMessage: 'No se pudo eliminar. Intenta de nuevo.' });
    if (!r.ok) { state.goals = before; return; }
    haptic.success();
    toast('Meta eliminada');
  };
  const setArchived = async (g, archived) => {
    const r = await runSave(() => updateGoal(g.id, { archived }));
    if (!r.ok) return;
    patchLocal(g.id, { archived });
    toast(archived ? 'Meta archivada' : 'Meta restaurada', archived
      ? { action: { label: 'Deshacer', fn: async () => { await updateGoal(g.id, { archived: false }); patchLocal(g.id, { archived: false }); } } }
      : {});
  };
  const openMenu = async (id) => {
    const g = find(id);
    if (!g) return;
    const act = await goalMenu(g);
    if (act === 'edit') openGoalForm(g);
    else if (act === 'archive') setArchived(g, true);
    else if (act === 'restore') setArchived(g, false);
    else if (act === 'delete') remove(g);
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openGoalForm()),
    on(screen, 'click', '[data-edit]', (e, b) => openGoalForm(find(b.dataset.edit))),
    on(screen, 'click', '[data-menu]', (e, b) => { haptic.tap(); openMenu(b.dataset.menu); }),
    on(screen, 'click', '[data-arch-toggle]', () => { showArchived = !showArchived; haptic.select(); render(); }),
    on(screen, 'click', '[data-add]', (e, b) => openContribution(find(b.dataset.add))),
    on(screen, 'click', '[data-withdraw]', (e, b) => openContribution(find(b.dataset.withdraw), true)),
    enableSwipe(body, {
      edit: (id) => openGoalForm(find(id)),
      delete: (id) => remove(find(id)),
    }),
    enableLongPress(body, '.goal-swipe, .goal-arch', (node) => openMenu(node.dataset.id), { ignore: '[data-menu], [data-add], [data-withdraw], .swipe-actions' }),
    subscribe('goals', render),
  ];
  render();
  refresh('goals');
  return () => offs.forEach((f) => f());
}
