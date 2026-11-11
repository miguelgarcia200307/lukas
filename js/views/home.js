// Inicio voice-first: límite del día alrededor del orbe de voz, próximos pagos, alertas y últimos movimientos
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, moneyShort } from '../utils/format.js';
import { greeting, inDays, dateShort } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe, onChanged } from '../state.js';
import { homeSummary } from '../api/reports.js';
import { skHome } from '../ui/skeleton.js';
import { txRow, animateCounts, ring, animateRings } from '../ui/common.js';
import { pullToRefresh } from '../ui/gestures.js';
import { emptyState } from '../ui/empty.js';
import { toast } from '../ui/toast.js';
import { Orb } from '../voice/orb.js';
import { SUGGESTIONS, openVoice } from '../voice/voice-sheet.js';
import { unlockVoice } from '../voice/speech.js';
import { maybePromptInstall } from '../install.js';
import { openTransactionDetail } from './transaction-form.js';

export const title = 'Inicio';

const dismissed = new Set();
const UPCOMING_ICON = { card_due: 'card', card_cut: 'calendar', debt: 'bank', subscription: 'repeat' };

export function mount(screen, { query, navigate }) {
  screen.innerHTML = String(html`
    <div class="scroller">
      <div class="content home">
        <header class="home-head">
          <div class="grow">
            <div class="home-date muted small">${new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' }).format(new Date())}</div>
            <h1 class="home-greet">${greeting()}${state.profile?.name ? `, ${state.profile.name}` : ''}</h1>
          </div>
          <a class="icon-btn filled" href="#/notificaciones" aria-label="Notificaciones">${icon('bell')}<span class="badge-dot" data-unread hidden></span></a>
        </header>
        <div class="home-body">${skHome()}</div>
      </div>
    </div>`);

  const scroller = screen.querySelector('.scroller');
  const body = screen.querySelector('.home-body');
  let orb = null;
  let summary = null;

  const paintUnread = (n) => {
    const b = screen.querySelector('[data-unread]');
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 9 ? '9+' : String(n);
  };

  const render = () => {
    const s = summary;
    const limit = Number(s.daily_limit) || 0;
    const spent = Number(s.today_expense) || 0;
    const pct = limit ? spent / limit : 0;
    const ringColor = pct >= 1 ? 'var(--expense)' : pct >= 0.8 ? 'var(--warn)' : 'var(--accent)';
    const alerts = [];
    (s.budgets ?? []).forEach((b) => {
      const p = Number(b.pct);
      if (p < 80) return;
      const key = `b:${b.budget_id ?? 'daily'}:${b.period_start}:${p >= 100 ? 100 : 80}`;
      if (dismissed.has(key)) return;
      const scope = b.budget_id ? `tu presupuesto de ${b.name}` : 'tu límite de hoy';
      alerts.push({ key, tone: p >= 100 ? 'danger' : '', icon: 'alert',
        text: p > 100 ? `Te pasaste de ${scope}: ${money(b.spent)} de ${money(b.amount)}.` : p >= 100 ? `Llegaste al 100% de ${scope}.` : `Ojo, ya vas en el ${Math.floor(p)}% de ${scope}: ${money(b.spent)} de ${money(b.amount)}.` });
    });
    (s.upcoming ?? []).filter((u) => u.days_left === 0 && u.kind !== 'card_cut').forEach((u) => {
      const key = `u:${u.kind}:${u.ref_id}:${u.event_date}`;
      if (dismissed.has(key)) return;
      alerts.push({ key, tone: 'info', icon: 'calendar', text: `Hoy: ${u.title}${u.amount ? ` · ${money(u.amount)}` : ''}` });
    });

    body.innerHTML = String(html`
      <section class="hero">
        <p class="hero-line">${limit
          ? html`Hoy llevas <b class="num" data-count="${spent}">${money(0)}</b> <span class="muted">de ${money(limit)}</span>`
          : html`Hoy llevas <b class="num" data-count="${spent}">${money(0)}</b> en gastos`}</p>
        <div class="orb-ring">
          ${ring(pct, { size: 236, stroke: 10, color: ringColor })}
          <canvas class="home-orb" aria-hidden="true"></canvas>
          <button class="orb-btn" aria-label="Registrar con voz. Toca para hablar o mantén presionado">
            <span class="sr-only">Hablar</span></button>
        </div>
        <p class="hero-hint">Cuéntame qué gastaste</p>
        <div class="chips scroll hero-suggest">${SUGGESTIONS.slice(0, 3).map((t) => html`<button class="chip suggest" data-suggest="${t}">“${t}”</button>`)}</div>
        <form class="home-compose" autocomplete="off">
          ${icon('keyboard', { size: 18 })}
          <input class="input" name="q" placeholder="O escríbelo: “taxi 12 mil”" aria-label="Escribe un gasto" enterkeyhint="send" maxlength="500">
          <button class="composer-send" aria-label="Enviar">${icon('send', { stroke: 2.4 })}</button>
        </form>
      </section>

      ${alerts.length ? html`<section class="alerts">${alerts.map((a) => html`<div class="banner ${a.tone}" data-key="${a.key}">
        ${icon(a.icon)}<span>${a.text}</span><button class="b-close" data-dismiss="${a.key}" aria-label="Descartar">${icon('x', { size: 16 })}</button></div>`)}</section>` : ''}

      ${(s.upcoming ?? []).length ? html`<section class="section">
        <div class="section-head"><h2 class="section-title">Próximos</h2><span class="muted small">7 días</span></div>
        <div class="upcoming scroll-x">${s.upcoming.map((u, i) => html`<a class="up-card pressable" style="--i:${i};--c:${u.color || '#4B3BF5'}"
            href="${u.kind.startsWith('card') ? `#/tarjetas/${u.ref_id}` : u.kind === 'debt' ? '#/creditos' : '#/suscripciones'}">
          <div class="up-top"><span class="up-ico">${icon(UPCOMING_ICON[u.kind] ?? 'calendar', { size: 18 })}</span>
            <span class="tag ${u.days_left === 0 ? 'danger' : u.days_left <= 2 ? 'warn' : ''}">${inDays(u.days_left)}</span></div>
          <div class="up-title ellipsis">${u.title}</div>
          <div class="up-sub">${u.amount ? html`<b class="num">${moneyShort(u.amount)}</b> · ` : ''}${dateShort(u.event_date)}</div>
        </a>`)}</div>
      </section>` : ''}

      <section class="section">
        <div class="section-head"><h2 class="section-title">Últimos movimientos</h2>
          <a class="link-btn" href="#/movimientos">Ver todos${icon('chevron-right', { size: 16 })}</a></div>
        ${(s.recent ?? []).length ? html`<div class="list stagger">${s.recent.map((t, i) => html`<div style="--i:${i}">${txRow(t)}</div>`)}</div>`
          : emptyState({ illus: 'list', title: 'Aún no hay movimientos', text: 'Toca el orbe y dime tu primer gasto. Por ejemplo: “almorcé por 18 lucas”.' })}
      </section>
      ${Number(s.month_expense) || Number(s.month_income) ? html`<section class="section month-strip card card-pad">
        <div><div class="eyebrow">Gastos del mes</div><div class="ms-val num">${money(s.month_expense)}</div></div>
        <div><div class="eyebrow">Ingresos del mes</div><div class="ms-val num income">${money(s.month_income)}</div></div>
        ${Number(s.card_debt) > 0 ? html`<div><div class="eyebrow">Deuda tarjetas</div><div class="ms-val num">${money(s.card_debt)}</div></div>` : ''}
      </section>` : ''}
    `);

    orb?.destroy();
    orb = new Orb(body.querySelector('.home-orb'), { compact: false });
    animateCounts(body);
    animateRings(body);
    paintUnread(state.unread);
  };

  const load = async () => {
    try {
      summary = await homeSummary();
      state.unread = Number(summary.unread) || 0;
      render();
    } catch (err) {
      console.error(err);
      if (!summary) body.innerHTML = String(emptyState({ illus: 'wallet', title: 'No pudimos cargar tu inicio', text: err.message, action: { label: 'Reintentar', attrs: 'data-retry' } }));
    }
  };

  // Orbe: toque = grabar; mantener = grabar mientras se sostiene
  let holdTimer = null, held = false;
  const offs = [
    on(screen, 'pointerdown', '.orb-btn', () => {
      unlockVoice(); // el desbloqueo de la voz tiene que nacer del toque (la grabación sostenida abre la hoja en un setTimeout)
      held = false;
      holdTimer = setTimeout(() => { held = true; haptic.start(); openVoice({ autoStart: true, hold: true }); }, 320);
    }),
    on(screen, 'pointerup', '.orb-btn', () => {
      clearTimeout(holdTimer);
      if (!held) { haptic.tap(); openVoice({ autoStart: true }); }
    }),
    on(screen, 'pointercancel', '.orb-btn', () => clearTimeout(holdTimer)),
    on(screen, 'keydown', '.orb-btn', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unlockVoice(); openVoice({ autoStart: true }); } }),
    on(screen, 'click', '[data-suggest]', (e, b) => { unlockVoice(); openVoice({ text: b.dataset.suggest }); }),
    on(screen, 'submit', '.home-compose', (e, f) => {
      e.preventDefault();
      const v = f.q.value.trim();
      if (!v) return;
      f.q.value = '';
      f.q.blur();
      unlockVoice();
      openVoice({ text: v });
    }),
    on(screen, 'click', '[data-dismiss]', (e, b) => {
      dismissed.add(b.dataset.dismiss);
      const el = b.closest('.banner');
      el.style.transition = 'opacity 200ms, transform 200ms';
      el.style.opacity = '0';
      el.style.transform = 'scale(0.96)';
      setTimeout(() => el.remove(), 200);
    }),
    on(screen, 'click', '[data-tx]', (e, b) => openTransactionDetail(b.dataset.tx)),
    on(screen, 'click', '[data-retry]', load),
    subscribe('unread', paintUnread),
    onChanged((entities) => { if (entities.some((e) => ['transactions', 'cards', 'debts', 'subscriptions', 'profile', 'budgets'].includes(e))) load(); }),
    pullToRefresh(scroller, load),
  ];

  load();
  if (query.voz === '1') setTimeout(() => openVoice({}), 350);
  if (query.nuevo === '1') navigate('movimientos?nuevo=1', { replace: true });
  const installTimer = setTimeout(() => maybePromptInstall(), 6000);
  if (!navigator.onLine) toast('Estás sin conexión: puedes registrar a mano en Movimientos', { type: 'info' });

  return () => {
    offs.forEach((f) => f());
    clearTimeout(installTimer);
    orb?.destroy();
  };
}
