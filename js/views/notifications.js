// Centro de notificaciones in-app
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { relativeTime } from '../utils/dates.js';
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
      body.innerHTML = String(html`<div class="list stagger">${list.map((n, i) => {
        const [ic, c] = TYPE[n.type] ?? ['bell', '#4B3BF5'];
        return html`<button class="list-row tappable notif ${n.read_at ? '' : 'unread'}" data-url="${n.url ?? ''}" style="--i:${Math.min(i, 10)}">
          <span class="cat-icon" style="--c:${c}">${icon(ic, { size: 20 })}</span>
          <div class="grow"><div class="row-title">${n.title}</div>${n.body ? html`<div class="row-sub notif-body-txt">${n.body}</div>` : ''}
            <div class="row-sub xsmall mt-2">${relativeTime(n.created_at)}</div></div>
          ${n.read_at ? '' : html`<span class="unread-dot" aria-label="Sin leer"></span>`}
        </button>`;
      })}</div>`);
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
