// Plantillas HTML seguras + atajos del DOM
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));

function fmt(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  if (v == null || v === false || v === true) return '';
  return esc(v);
}

/** html`...` escapa interpolaciones (salvo raw() o resultados de html). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ''); });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tpl) {
  const t = document.createElement('template');
  t.innerHTML = String(tpl).trim();
  return t.content.firstElementChild;
}

/** Delegación: on(root, 'click', '[data-act]', (e, target) => …). Devuelve la función para quitarlo. */
export function on(root, type, selector, fn, opts) {
  const handler = (e) => {
    const t = e.target.closest?.(selector);
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(type, handler, opts);
  return () => root.removeEventListener(type, handler, opts);
}
