// Más: acceso a todas las secciones. Modo privado: los saldos de Cuentas, Tarjetas, Créditos y Suscripciones se
// pueden ocultar todos a la vez (ojito del encabezado) o uno por uno (ojito de cada tarjeta).
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe } from '../state.js';
import { APP_NAME, APP_VERSION } from '../config.js';
import { topbar, bindTopbar } from '../ui/common.js';
import { sensitiveLine } from '../ui/sensitive.js';
import { isHidden, allHidden, toggle, toggleAll, onPrivacyChange } from '../privacy.js';

export const title = 'Más';

// Estado de cada botón (ícono, etiqueta de la ACCIÓN y aria-pressed), usado al pintar y al actualizar en su lugar
const globalState = () => { const all = allHidden(); return { pressed: all, label: all ? 'Mostrar todos los saldos' : 'Ocultar todos los saldos', icon: all ? 'eye-off' : 'eye' }; };
const eyeState = (key, name) => { const h = isHidden(key); return { pressed: h, label: `${h ? 'Mostrar' : 'Ocultar'} saldo de ${name}`, icon: h ? 'eye-off' : 'eye' }; };
const globalBtn = () => { const g = globalState(); return html`<button type="button" class="icon-btn privacy-all" data-privacy-all aria-pressed="${g.pressed}" aria-label="${g.label}">${icon(g.icon, { size: 22 })}</button>`; };
const eyeBtn = (key, name) => { const e = eyeState(key, name); return html`<button type="button" class="privacy-eye" data-privacy="${key}" aria-pressed="${e.pressed}" aria-label="${e.label}">${icon(e.icon, { size: 18 })}</button>`; };
/** Actualiza el botón sin reemplazarlo (el foco del teclado se conserva) */
function syncBtn(btn, st, size) {
  if (!btn || btn.getAttribute('aria-pressed') === String(st.pressed)) return false;
  btn.setAttribute('aria-pressed', String(st.pressed));
  btn.setAttribute('aria-label', st.label);
  btn.innerHTML = String(icon(st.icon, { size }));
  return true;
}

export function mount(screen) {
  let items = [];

  const render = () => {
    const accTotal = state.accounts.filter((a) => !a.archived).reduce((s, a) => s + Number(a.balance), 0);
    const cardDebt = state.cards.filter((c) => !c.archived).reduce((s, c) => s + Math.max(0, Number(c.debt)), 0);
    const debtTotal = state.debts.filter((d) => !d.archived).reduce((s, d) => s + Number(d.balance), 0);
    const subsMonthly = state.subscriptions.filter((s) => s.active).reduce((s, x) => s + Number(x.monthly_equivalent), 0);
    const goals = state.goals.filter((g) => !g.archived);
    // key: tarjeta con saldo sensible; sub(h) pinta el monto o la máscara manteniendo el texto de contexto
    items = [
      { key: 'accounts', href: '#/cuentas', icon: 'wallet', c: '#3FA672', t: 'Cuentas', sub: (h) => sensitiveLine(accTotal, { hidden: h, after: ' en total' }) },
      { key: 'creditCards', href: '#/tarjetas', icon: 'card', c: '#4B3BF5', t: 'Tarjetas de crédito',
        sub: (h) => (cardDebt ? sensitiveLine(cardDebt, { hidden: h, before: 'Debes ' }) : `${state.cards.length} tarjetas`) },
      { key: 'loans', href: '#/creditos', icon: 'bank', c: '#6B7280', t: 'Créditos',
        sub: (h) => (debtTotal ? sensitiveLine(debtTotal, { hidden: h, before: 'Saldo ' }) : 'Préstamos y obligaciones') },
      { key: 'subscriptions', href: '#/suscripciones', icon: 'repeat', c: '#E0606B', t: 'Suscripciones',
        sub: (h) => (subsMonthly ? sensitiveLine(subsMonthly, { hidden: h, after: ' al mes' }) : 'Netflix, Spotify…') },
      { href: '#/presupuestos', icon: 'pie', c: '#E6B422', t: 'Presupuestos', s: `${state.budgets.length} activos` },
      { href: '#/metas', icon: 'target', c: '#2FB3A6', t: 'Metas de ahorro', s: goals.length ? `${goals.length} metas` : 'Ahorra para lo que quieres' },
      { href: '#/categorias', icon: 'tag', c: '#A65BE0', t: 'Categorías', s: `${state.categories.filter((c) => !c.archived).length} categorías` },
      { href: '#/notificaciones', icon: 'bell', c: '#F08A4B', t: 'Notificaciones', s: state.unread ? `${state.unread} sin leer` : 'Al día' },
      { href: '#/ajustes', icon: 'settings', c: '#1D1D1B', t: 'Ajustes', s: 'Perfil, avisos y app' },
    ];
    const tile = (it, style = '') => html`<a class="more-tile pressable" href="${it.href}" style="${style}">
      <span class="cat-icon lg">${icon(it.icon, { size: 24 })}</span>
      <span class="mt-title">${it.t}</span>${it.key
        ? html`<span class="mt-sub one-line" data-sens-sub>${it.sub(isHidden(it.key))}</span>`
        : html`<span class="mt-sub">${it.s}</span>`}</a>`;
    // Las tarjetas con saldo van en un contenedor con el ojito al lado del enlace (no dentro): tocarlo nunca navega
    screen.querySelector('.more-grid').innerHTML = String(html`${items.map((it, i) => (it.key
      ? html`<div class="more-cell" data-sens-key="${it.key}" style="--i:${i};--c:${it.c}">${tile(it)}${eyeBtn(it.key, it.t)}</div>`
      : tile(it, `--i:${i};--c:${it.c}`)))}`);
  };

  /** Cambio de privacidad: solo se reemplazan los montos y los íconos (con un fundido corto), sin re-pintar la cuadrícula */
  const paintPrivacy = () => {
    for (const it of items.filter((x) => x.key)) {
      const cell = screen.querySelector(`[data-sens-key="${it.key}"]`);
      if (!cell) continue;
      const sub = cell.querySelector('[data-sens-sub]');
      const next = String(it.sub(isHidden(it.key)));
      if (sub.innerHTML !== next) { sub.innerHTML = next; fade(sub); }
      const eye = cell.querySelector('[data-privacy]');
      if (syncBtn(eye, eyeState(it.key, it.t), 18)) fade(eye.querySelector('svg'));
    }
    const g = screen.querySelector('[data-privacy-all]');
    if (syncBtn(g, globalState(), 22)) fade(g.querySelector('svg'));
  };
  const fade = (el) => { if (!el) return; el.classList.remove('sens-fade'); void el.offsetWidth; el.classList.add('sens-fade'); };

  screen.innerHTML = String(html`
    ${topbar({ title: 'Más', large: true, right: globalBtn() })}
    <div class="scroller"><div class="content">
      <div class="more-grid stagger"></div>
      <p class="center muted xsmall mt-8">${APP_NAME} · versión ${APP_VERSION}</p>
    </div></div>`);
  const offs = ['accounts', 'cards', 'debts', 'subscriptions', 'goals', 'budgets', 'categories', 'unread'].map((k) => subscribe(k, render));
  offs.push(bindTopbar(screen));
  offs.push(onPrivacyChange(paintPrivacy));
  // Ojito de una tarjeta: alterna solo esa; nunca navega (está fuera del enlace y además se detiene el evento)
  offs.push(on(screen, 'click', '[data-privacy]', (e, b) => {
    e.preventDefault();
    e.stopPropagation();
    haptic.select();
    toggle(b.dataset.privacy);
  }));
  offs.push(on(screen, 'click', '[data-privacy-all]', (e) => { e.preventDefault(); haptic.select(); toggleAll(); }));
  render();
  return () => offs.forEach((f) => f());
}
