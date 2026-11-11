// Formularios declarativos dentro de un bottom sheet (crear/editar entidades)
import { html, raw } from '../utils/dom.js';
import { ORB_SPINNER } from './orb-loader.js';
import { icon, ICON_NAMES } from '../utils/icons.js';
import { number, PALETTE } from '../utils/format.js';
import { haptic } from '../utils/haptics.js';
import { openSheet } from './sheet.js';
import { bindAmountInput } from './number-input.js';
import { confirmDialog } from './modal.js';
import { runSave } from './submit.js';

/**
 * fields: [{ name, label, type: text|amount|select|date|day|number|color|icon|switch|textarea|percent, value, options, required, placeholder, hint, show(values) }]
 * onSubmit(values) → Promise; onDelete() → Promise (opcional)
 */
export function formSheet({ title, fields, submitLabel = 'Guardar', onSubmit, onDelete, deleteLabel = 'Eliminar', deleteConfirm, intro = '' }) {
  const fieldHtml = (f) => {
    const id = `f-${f.name}`;
    const req = f.required ? 'required' : '';
    let control;
    switch (f.type) {
      case 'amount':
        control = html`<div class="input-prefix"><span>$</span><input id="${id}" class="input" name="${f.name}" value="${f.value ? number(f.value) : ''}" placeholder="${f.placeholder ?? '0'}" ${raw(req)}></div>`;
        break;
      case 'select':
        control = html`<select id="${id}" class="input" name="${f.name}" ${raw(req)}>
          ${f.options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${o.label}</option>`)}</select>`;
        break;
      case 'textarea':
        control = html`<textarea id="${id}" class="input" name="${f.name}" placeholder="${f.placeholder ?? ''}" maxlength="500">${f.value ?? ''}</textarea>`;
        break;
      case 'switch':
        control = html`<label class="switch-row" for="${id}"><span class="grow">${f.label}${f.hint ? html`<span class="row-sub">${f.hint}</span>` : ''}</span>
          <span class="switch"><input id="${id}" type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}><span class="track"></span></span></label>`;
        return html`<div class="field" data-field="${f.name}">${control}</div>`;
      case 'color':
        control = html`<div class="swatches" role="radiogroup" aria-label="${f.label}">${PALETTE.map((c) => html`<label class="swatch" style="--c:${c}">
          <input type="radio" name="${f.name}" value="${c}" ${c.toLowerCase() === String(f.value ?? PALETTE[0]).toLowerCase() ? 'checked' : ''} aria-label="${c}"><span></span></label>`)}</div>`;
        break;
      case 'icon':
        control = html`<div class="icon-grid" role="radiogroup" aria-label="${f.label}">${ICON_NAMES.map((n) => html`<label class="icon-opt">
          <input type="radio" name="${f.name}" value="${n}" ${n === (f.value ?? 'tag') ? 'checked' : ''} aria-label="${n}"><span>${icon(n, { size: 20 })}</span></label>`)}</div>`;
        break;
      case 'day':
        control = html`<input id="${id}" class="input" type="number" name="${f.name}" min="1" max="31" inputmode="numeric" value="${f.value ?? ''}" placeholder="${f.placeholder ?? '1–31'}" ${raw(req)}>`;
        break;
      case 'percent':
        control = html`<div class="input-prefix suffix"><input id="${id}" class="input" type="text" inputmode="decimal" name="${f.name}" value="${f.value ?? ''}" placeholder="${f.placeholder ?? '0,0'}"><span>%</span></div>`;
        break;
      case 'date':
        control = html`<input id="${id}" class="input" type="date" name="${f.name}" value="${f.value ?? ''}" ${raw(req)}>`;
        break;
      default:
        control = html`<input id="${id}" class="input" type="text" name="${f.name}" value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}" maxlength="${f.maxlength ?? 60}" ${raw(f.inputmode ? `inputmode="${f.inputmode}"` : '')} ${raw(req)}>`;
    }
    return html`<div class="field" data-field="${f.name}">
      <label for="${id}">${f.label}</label>${control}
      ${f.hint ? html`<span class="field-hint">${f.hint}</span>` : ''}
      <span class="field-error" data-err="${f.name}"></span>
    </div>`;
  };

  const s = openSheet({
    title,
    body: html`<form class="form-sheet" novalidate>${intro ? html`<p class="muted small mb-4">${intro}</p>` : ''}${fields.map(fieldHtml)}
      ${onDelete ? html`<button type="button" class="btn btn-danger btn-block mt-8" data-delete>${icon('trash')}${deleteLabel}</button>` : ''}</form>`,
    footer: html`<button class="btn btn-primary btn-block" data-submit><span class="btn-label">${submitLabel}</span>${raw(ORB_SPINNER)}</button>`,
  });
  const form = s.body.querySelector('form');
  const amounts = {};
  fields.filter((f) => f.type === 'amount').forEach((f) => { amounts[f.name] = bindAmountInput(form.elements[f.name]); });

  const values = () => {
    const out = {};
    for (const f of fields) {
      const elx = form.elements[f.name];
      if (!elx) continue;
      if (f.type === 'amount') out[f.name] = amounts[f.name].value;
      else if (f.type === 'switch') out[f.name] = elx.checked;
      else if (f.type === 'day' || f.type === 'number') out[f.name] = elx.value === '' ? null : Number(elx.value);
      else if (f.type === 'percent') out[f.name] = elx.value === '' ? null : Number(String(elx.value).replace(',', '.'));
      else out[f.name] = (elx.value ?? '').trim?.() ?? elx.value;
    }
    return out;
  };
  const applyVisibility = () => {
    const v = values();
    fields.forEach((f) => { if (f.show) form.querySelector(`[data-field="${f.name}"]`).hidden = !f.show(v); });
  };
  form.addEventListener('change', applyVisibility);
  applyVisibility();

  const setError = (name, msg) => {
    const e = form.querySelector(`[data-err="${name}"]`);
    if (e) e.textContent = msg ?? '';
    form.elements[name]?.classList?.toggle('invalid', !!msg);
  };

  const submit = async () => {
    const v = values();
    let bad = false;
    for (const f of fields) {
      setError(f.name, '');
      const hidden = f.show && !f.show(v);
      if (hidden) continue;
      if (f.required && (v[f.name] === '' || v[f.name] == null || (f.type === 'amount' && !v[f.name]))) { setError(f.name, 'Este dato es necesario'); bad = true; }
      if (f.type === 'day' && v[f.name] != null && (v[f.name] < 1 || v[f.name] > 31)) { setError(f.name, 'Escribe un día entre 1 y 31'); bad = true; }
      const custom = f.validate?.(v[f.name], v);
      if (custom) { setError(f.name, custom); bad = true; }
    }
    if (bad) { haptic.error(); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return; }
    // Carga local a este botón, liberada siempre; si falla, error visible y los datos quedan para reintentar
    const r = await runSave(() => onSubmit(v), { button: s.foot.querySelector('[data-submit]') });
    if (r.ok) { haptic.success(); s.close(); }
  };
  s.foot.querySelector('[data-submit]').addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  form.querySelector('[data-delete]')?.addEventListener('click', async (e) => {
    const delBtn = e.currentTarget;
    const ok = await confirmDialog({ title: deleteConfirm?.title ?? '¿Eliminar?', message: deleteConfirm?.message ?? 'Esta acción no se puede deshacer.', confirm: deleteLabel, danger: true });
    if (!ok) return;
    const r = await runSave(() => onDelete(), { button: delBtn, fallbackMessage: 'No se pudo eliminar. Intenta de nuevo.' });
    if (r.ok) s.close();
  });
  return s;
}
