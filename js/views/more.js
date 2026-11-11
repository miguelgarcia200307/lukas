// Más: acceso a todas las secciones
import { html } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { state, subscribe } from '../state.js';
import { APP_NAME, APP_VERSION } from '../config.js';
import { topbar, bindTopbar } from '../ui/common.js';

export const title = 'Más';

export function mount(screen) {
  const render = () => {
    const accTotal = state.accounts.filter((a) => !a.archived).reduce((s, a) => s + Number(a.balance), 0);
    const cardDebt = state.cards.filter((c) => !c.archived).reduce((s, c) => s + Math.max(0, Number(c.debt)), 0);
    const debtTotal = state.debts.filter((d) => !d.archived).reduce((s, d) => s + Number(d.balance), 0);
    const subsMonthly = state.subscriptions.filter((s) => s.active).reduce((s, x) => s + Number(x.monthly_equivalent), 0);
    const goals = state.goals.filter((g) => !g.archived);
    const items = [
      { href: '#/cuentas', icon: 'wallet', c: '#3FA672', t: 'Cuentas', s: `${money(accTotal)} en total` },
      { href: '#/tarjetas', icon: 'card', c: '#4B3BF5', t: 'Tarjetas de crédito', s: cardDebt ? `Debes ${money(cardDebt)}` : `${state.cards.length} tarjetas` },
      { href: '#/creditos', icon: 'bank', c: '#6B7280', t: 'Créditos', s: debtTotal ? `Saldo ${money(debtTotal)}` : 'Préstamos y obligaciones' },
      { href: '#/suscripciones', icon: 'repeat', c: '#E0606B', t: 'Suscripciones', s: subsMonthly ? `${money(subsMonthly)} al mes` : 'Netflix, Spotify…' },
      { href: '#/presupuestos', icon: 'pie', c: '#E6B422', t: 'Presupuestos', s: `${state.budgets.length} activos` },
      { href: '#/metas', icon: 'target', c: '#2FB3A6', t: 'Metas de ahorro', s: goals.length ? `${goals.length} metas` : 'Ahorra para lo que quieres' },
      { href: '#/categorias', icon: 'tag', c: '#A65BE0', t: 'Categorías', s: `${state.categories.filter((c) => !c.archived).length} categorías` },
      { href: '#/notificaciones', icon: 'bell', c: '#F08A4B', t: 'Notificaciones', s: state.unread ? `${state.unread} sin leer` : 'Al día' },
      { href: '#/ajustes', icon: 'settings', c: '#1D1D1B', t: 'Ajustes', s: 'Perfil, avisos y app' },
    ];
    screen.querySelector('.more-grid').innerHTML = String(html`${items.map((it, i) => html`<a class="more-tile pressable" href="${it.href}" style="--i:${i};--c:${it.c}">
      <span class="cat-icon lg">${icon(it.icon, { size: 24 })}</span>
      <span class="mt-title">${it.t}</span><span class="mt-sub">${it.s}</span></a>`)}`);
  };

  screen.innerHTML = String(html`
    ${topbar({ title: 'Más', large: true })}
    <div class="scroller"><div class="content">
      <div class="more-grid stagger"></div>
      <p class="center muted xsmall mt-8">${APP_NAME} · versión ${APP_VERSION}</p>
    </div></div>`);
  const offs = ['accounts', 'cards', 'debts', 'subscriptions', 'goals', 'budgets', 'categories', 'unread'].map((k) => subscribe(k, render));
  offs.push(bindTopbar(screen));
  render();
  return () => offs.forEach((f) => f());
}
