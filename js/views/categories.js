// Categorías: crear, editar (color, ícono, padre), reordenar y archivar
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe, topCategories, childCategories } from '../state.js';
import { createCategory, updateCategory, reorderCategories } from '../api/categories.js';
import { topbar, bindTopbar, segmented, selectSegment, catIcon } from '../ui/common.js';
import { formSheet } from '../ui/form.js';
import { toast } from '../ui/toast.js';

export const title = 'Categorías';

function openCategoryForm(kind, cat = null) {
  formSheet({
    title: cat ? 'Editar categoría' : 'Nueva categoría',
    fields: [
      { name: 'name', label: 'Nombre', value: cat?.name, required: true, placeholder: 'Ej. Gimnasio' },
      { name: 'parent_id', label: 'Dentro de', type: 'select', value: cat?.parent_id ?? '',
        options: [{ value: '', label: 'Ninguna (categoría principal)' }, ...topCategories(kind).filter((c) => c.id !== cat?.id).map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'icon', label: 'Ícono', type: 'icon', value: cat?.icon ?? 'tag' },
      { name: 'color', label: 'Color', type: 'color', value: cat?.color ?? '#4B3BF5' },
      ...(cat ? [{ name: 'archived', label: 'Archivar', type: 'switch', value: cat.archived, hint: 'No aparece al registrar, pero se conserva en reportes.' }] : []),
    ],
    onSubmit: async (v) => {
      const row = { ...v, parent_id: v.parent_id || null };
      if (cat) await updateCategory(cat.id, row);
      else await createCategory({ ...row, kind, sort_order: 999 });
      toast(cat ? 'Categoría actualizada' : 'Categoría creada');
    },
  });
}

export function mount(screen) {
  let kind = 'expense';
  let ordering = false;
  screen.innerHTML = String(html`
    ${topbar({ title: 'Categorías', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nueva categoría">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content">
      ${segmented('kind', [{ value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }], kind)}
      <div class="row between mt-4"><span class="muted small">Toca para editar</span><button class="link-btn" data-order>Ordenar</button></div>
      <div class="cat-body"></div>
    </div></div>`);
  const body = screen.querySelector('.cat-body');

  const render = () => {
    const parents = state.categories.filter((c) => c.kind === kind && !c.parent_id);
    const active = parents.filter((c) => !c.archived);
    const archived = state.categories.filter((c) => c.kind === kind && c.archived);
    screen.querySelector('[data-order]').textContent = ordering ? 'Listo' : 'Ordenar';
    const row = (c, i, len) => html`<div class="list-row cat-row ${c.parent_id ? 'child' : ''}">
      <button class="row gap-3 grow" data-edit="${c.id}" style="text-align:left">${catIcon(c)}<span class="row-title grow">${c.name}</span></button>
      ${ordering && !c.parent_id ? html`<div class="row"><button class="icon-btn" data-up="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('arrow-up', { size: 18 })}</button>
        <button class="icon-btn" data-down="${c.id}" ${i === len - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('arrow-down', { size: 18 })}</button></div>` : ''}
    </div>`;
    body.innerHTML = String(html`<div class="list mt-3">${active.map((c, i) => html`${row(c, i, active.length)}${ordering ? '' : childCategories(c.id).map((k) => row(k, 0, 0))}`)}</div>
      ${archived.length ? html`<div class="eyebrow mt-8 mb-2">Archivadas</div><div class="list muted-list">${archived.map((c) => row(c, 0, 0))}</div>` : ''}`);
  };

  const move = async (id, dir) => {
    const list = state.categories.filter((c) => c.kind === kind && !c.parent_id && !c.archived).map((c) => c.id);
    const i = list.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    haptic.select();
    try { await reorderCategories(list); } catch (err) { toast(err.message, { type: 'err' }); }
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-seg] button', (e, b) => { kind = selectSegment(b.parentElement, b.dataset.value); render(); }),
    on(screen, 'click', '[data-new]', () => openCategoryForm(kind)),
    on(screen, 'click', '[data-order]', () => { ordering = !ordering; render(); }),
    on(screen, 'click', '[data-edit]', (e, b) => { if (!ordering) openCategoryForm(kind, state.categories.find((c) => c.id === b.dataset.edit)); }),
    on(screen, 'click', '[data-up]', (e, b) => move(b.dataset.up, -1)),
    on(screen, 'click', '[data-down]', (e, b) => move(b.dataset.down, 1)),
    subscribe('categories', render),
  ];
  render();
  return () => offs.forEach((f) => f());
}
