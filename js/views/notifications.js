// Centro de notificaciones in-app
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { relativeTime, bogota, todayISO, addDays } from '../utils/dates.js';
import { listNotifications, markRead, clearAll } from '../api/notifications.js';
import { topbar, bindTopbar } from '../ui/common.js';
import { loaderHtml, settle, orbError, loadErrorText, online } from '../ui/orb-loader.js';
import { emptyState } from '../ui/empty.js';
import { confirmDialog } from '../ui/modal.js';
import { pullToRefresh } from '../ui/gestures.js';
import { toast } from '../ui/toast.js';

export const title = 'Notificaciones';
const TYPE = {
  card_cut: ['calendar', '#4B3BF5'], card_due: ['card', '#D9503E'], debt_due: ['bank', '#6B7280'], subscription: ['repeat', '#E0606B'],
  weekly_summary: ['chart', '#2FB3A6'], no_activity: ['mic', '#4B3BF5'], budget: ['alert', '#B87600'], test: ['bell', '#12875A'],
};

// Lukas resume lo pendiente: primero lo que cuesta plata si se olvida
const PRIORITY = ['card_due', 'debt_due', 'budget', 'card_cut', 'subscription', 'weekly_summary', 'no_activity', 'test'];
const FOCUS = {
  card_due: ['Lo más importante: un pago de tarjeta que se acerca.', 'Empieza por el pago de tu tarjeta.'],
  debt_due: ['Lo primero: una cuota que se acerca.', 'No olvides la cuota que viene.'],
  budget: ['Ojo con un presupuesto.', 'Un presupuesto pide tu atención.'],
  card_cut: ['Se acerca un corte de tarjeta.', 'Hay un corte de tarjeta a la vista.'],
  subscription: ['Hay novedades en tus suscripciones.', 'Una suscripción se mueve pronto.'],
  weekly_summary: ['Ya está listo tu resumen de la semana.', 'Te dejé el resumen de tu semana.'],
  no_activity: ['Te estuve buscando 😄', 'Cuéntame tus gastos cuando puedas.'],
  test: ['Las notificaciones funcionan perfecto.'],
};
const CALM = ['Todo leído. Si pasa algo, te aviso 👀', 'Estás al día con tus avisos.', 'Nada nuevo por ahora; yo sigo pendiente.'];
const one = (l) => l[Math.floor(Math.random() * l.length)];

export function lukasSummary(list) {
  const unread = list.filter((n) => !n.read_at);
  if (!unread.length) return { text: one(CALM), mood: 'rest' };
  const top = PRIORITY.find((t) => unread.some((n) => n.type === t));
  const count = unread.length === 1 ? 'Tienes un aviso nuevo.' : `Tienes ${unread.length} avisos nuevos.`;
  return { text: `${count} ${one(FOCUS[top] ?? ['Échales un vistazo.'])}`, mood: ['card_due', 'debt_due', 'budget'].includes(top) ? 'thinking' : 'done' };
}

function groupOf(iso) {
  const d = bogota(new Date(iso)).date, today = todayISO();
  if (d === today) return 'Hoy';
  if (d === addDays(today, -1)) return 'Ayer';
  if (d > addDays(today, -7)) return 'Esta semana';
  return 'Antes';
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Notificaciones', back: true, right: html`<button class="icon-btn" data-clear aria-label="Borrar todas">${icon('trash')}</button>` })}
    <div class="scroller"><div class="content"><div class="notif-body">${loaderHtml()}</div></div></div>`);
  const body = screen.querySelector('.notif-body');

  const load = async () => {
    try {
      const list = await online(listNotifications);
      await settle(body);
      if (!list.length) {
        body.innerHTML = String(emptyState({ illus: 'bell', title: 'Todo al día', text: 'Aquí verás avisos de cortes, pagos, cuotas, suscripciones y presupuestos.' }));
        return;
      }
      const groups = new Map();
      for (const n of list) {
        const g = groupOf(n.created_at);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(n);
      }
      const sum = lukasSummary(list);
      let i = 0;
      body.innerHTML = String(html`
        <div class="notif-lukas" role="status"><lukas-orb size="44" state="${sum.mood === 'rest' ? 'rest' : 'done'}" aria-hidden="true"></lukas-orb><p>${sum.text}</p></div>
        ${[...groups.entries()].map(([g, items]) => html`<div class="day-group" style="--i:${Math.min(i++, 8)}">
          <div class="day-head"><span class="d">${g}</span></div>
          <div class="list">${items.map((n) => {
            const [ic, c] = TYPE[n.type] ?? ['bell', '#4B3BF5'];
            return html`<button class="list-row tappable notif ${n.read_at ? '' : 'unread'}" data-url="${n.url ?? ''}">
              <span class="cat-icon" style="--c:${c}">${icon(ic, { size: 20 })}</span>
              <div class="grow"><div class="row-title">${n.title}</div>${n.body ? html`<div class="row-sub notif-body-txt">${n.body}</div>` : ''}
                <div class="row-sub xsmall mt-2">${relativeTime(n.created_at)}</div></div>
              ${n.read_at ? '' : html`<span class="unread-dot" aria-label="Sin leer"></span>`}
            </button>`;
          })}</div></div>`)}`);
      if (sum.mood === 'thinking') setTimeout(() => body.querySelector('.notif-lukas lukas-orb')?.react?.('ajuste'), 500);
      if (list.some((n) => !n.read_at)) setTimeout(() => markRead().catch(() => {}), 1200);
    } catch (err) {
      await settle(body);
      body.innerHTML = String(orbError({ title: 'No pudimos cargar tus avisos', text: loadErrorText(err) }));
    }
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-url]', (e, b) => { if (b.dataset.url) location.hash = b.dataset.url.replace(/^.*#/, '#'); }),
    on(screen, 'click', '[data-clear]', async () => {
      if (!(await confirmDialog({ title: '¿Borrar todas las notificaciones?', confirm: 'Borrar', danger: true }))) return;
      try { await clearAll(); load(); } catch (err) { toast(err.message, { type: 'err' }); }
    }),
    on(screen, 'click', '[data-retry]', load),
    pullToRefresh(screen.querySelector('.scroller'), load),
  ];
  load();
  return () => offs.forEach((f) => f());
}
