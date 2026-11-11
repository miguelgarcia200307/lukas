// Piezas de UI compartidas: barra superior, control segmentado, íconos de categoría, filas de movimientos
import { html, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { timeLabel } from '../utils/dates.js';
import { categoryById, accountById, cardById, state } from '../state.js';

/** topbar({ title, back, right, large }) */
export function topbar({ title = '', back = false, right = '', large = false } = {}) {
  return html`<header class="topbar">
    <div class="topbar-inner">
      ${back ? html`<button class="icon-btn" data-back aria-label="Volver">${icon('chevron-left', { stroke: 2.2 })}</button>` : ''}
      ${large ? html`<h1>${title}</h1>` : html`<div class="title-sm">${title}</div>`}
      ${right || (back ? html`<span style="width:44px"></span>` : '')}
    </div>
  </header>`;
}

/** Sombra de la barra superior al hacer scroll */
export function bindTopbar(screen) {
  const bar = screen.querySelector('.topbar');
  const sc = screen.querySelector('.scroller');
  if (!bar || !sc) return () => {};
  const f = () => bar.classList.toggle('scrolled', sc.scrollTop > 4);
  sc.addEventListener('scroll', f, { passive: true });
  return () => sc.removeEventListener('scroll', f);
}

/** segmented(name, options [{value,label}], selected) */
export function segmented(name, options, selected) {
  const idx = Math.max(0, options.findIndex((o) => o.value === selected));
  return html`<div class="segmented" role="tablist" data-seg="${name}" style="--n:${options.length}">
    <span class="seg-thumb" style="width:calc((100% - 8px) / ${options.length});transform:translateX(${idx * 100}%)"></span>
    ${options.map((o) => html`<button type="button" role="tab" aria-selected="${o.value === selected}" class="${o.value === selected ? 'active' : ''}" data-value="${o.value}">${o.label}</button>`)}
  </div>`;
}

/** Mueve el thumb y marca activo; devuelve el valor */
export function selectSegment(seg, value) {
  const btns = [...seg.querySelectorAll('button')];
  const i = Math.max(0, btns.findIndex((b) => b.dataset.value === value));
  btns.forEach((b, j) => { b.classList.toggle('active', j === i); b.setAttribute('aria-selected', String(j === i)); });
  seg.querySelector('.seg-thumb').style.transform = `translateX(${i * 100}%)`;
  return value;
}

export function catIcon(cat, { lg = false } = {}) {
  const c = cat ?? { icon: 'dots', color: '#9A9A92' };
  return html`<span class="cat-icon ${lg ? 'lg' : ''}" style="--c:${c.color}">${icon(c.icon, { size: lg ? 24 : 20 })}</span>`;
}

function paymentLabel(t) {
  if (t.type === 'transfer') {
    const src = accountById(t.account_id)?.name ?? 'Cuenta';
    const dst = t.to_card_id ? cardById(t.to_card_id)?.name : t.to_account_id ? accountById(t.to_account_id)?.name
      : t.debt_id ? state.debts.find((d) => d.id === t.debt_id)?.name : t.goal_id ? state.goals.find((g) => g.id === t.goal_id)?.name : null;
    return dst ? `${src} → ${dst}` : src;
  }
  if (t.card_id) return cardById(t.card_id)?.name ?? 'Tarjeta';
  return accountById(t.account_id)?.name ?? 'Sin cuenta';
}

function txVisual(t) {
  if (t.type === 'transfer') {
    return { icon: html`<span class="cat-icon" style="--c:#6F6F69">${icon(t.to_card_id ? 'card' : t.goal_id ? 'target' : 'swap', { size: 20 })}</span>`, cls: 'transfer', sign: '' };
  }
  const cat = categoryById(t.category_id) ?? (t.category_name ? { icon: t.category_icon, color: t.category_color, name: t.category_name } : null);
  return { icon: catIcon(cat), cls: t.type === 'income' ? 'in' : '', sign: t.type === 'income' ? '+' : '', cat };
}

/** Fila de movimiento. swipe=true agrega acciones de deslizar. */
export function txRow(t, { swipe = false, showTime = true } = {}) {
  const v = txVisual(t);
  const sub = [v.cat?.name ?? (t.type === 'transfer' ? 'Transferencia' : 'Sin categoría'), paymentLabel(t), showTime ? timeLabel(t.occurred_at) : null]
    .filter(Boolean).join(' · ');
  const inner = html`<button class="list-row tappable" data-tx="${t.id}">
      ${v.icon}
      <div class="grow">
        <div class="row-title ellipsis">${t.description || v.cat?.name || 'Movimiento'}</div>
        <div class="row-sub ellipsis">${sub}</div>
      </div>
      <div class="row-amount ${v.cls}">${v.sign}${money(t.amount)}</div>
    </button>`;
  if (!swipe) return inner;
  return html`<div class="swipe" data-id="${t.id}">
    ${raw(swipeActionsHtml)}
    <div class="swipe-content">${inner}</div>
  </div>`;
}

const swipeActionsHtml = `<div class="swipe-actions" aria-hidden="true">
  <button class="act-edit" data-swipe="edit" tabindex="-1">${icon('edit', { size: 20 })}Editar</button>
  <button class="act-delete" data-swipe="delete" tabindex="-1">${icon('trash', { size: 20 })}Eliminar</button>
</div>`;

/** Anillo de progreso SVG */
export function ring(pct, { size = 176, stroke = 14, color = 'var(--accent)', track = 'var(--surface-3)', children = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return html`<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - p)}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="ring-center">${children}</div>
  </div>`;
}

export function animateRings(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.ring-val').forEach((c) => { c.style.strokeDashoffset = c.dataset.target; });
  }));
}

/** Cuenta animada de cifras: <span data-count="62000"> */
export function animateCounts(root, duration = 900) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-count]').forEach((node) => {
    const target = Number(node.dataset.count) || 0;
    const fmt = node.dataset.fmt === 'plain' ? (n) => Math.round(n).toLocaleString('es-CO') : (n) => money(n);
    if (reduce || !target) { node.textContent = fmt(target); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      node.textContent = fmt(target * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function progressBar(pct, { color } = {}) {
  const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
  return html`<div class="bar ${cls}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100">
    <span style="width:${Math.min(100, Math.max(0, pct))}%;${color ? `--c:${color}` : ''}"></span>
  </div>`;
}
