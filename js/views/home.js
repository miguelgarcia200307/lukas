// Inicio voice-first: límite del día alrededor del orbe de voz, próximos pagos, alertas y últimos movimientos
import { html, raw, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, moneyShort } from '../utils/format.js';
import { greeting, inDays, dateShort } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { spring, animate } from '../utils/motion.js';
import { state, subscribe, onChanged } from '../state.js';
import { homeSummary } from '../api/reports.js';
import { txRow } from '../ui/common.js';
import { staticOrbSvg } from '../ui/lukas-orb.js';
import {
  budgetRing, budgetTone, playRing, countTo, paintEdges, edgeFades, collapsingHeader, onceThisSession,
  voiceUsed, markVoiceUsed, introHeader, introBody, hop, ringBell,
} from '../ui/home-fx.js';
import { pullToRefresh } from '../ui/gestures.js';
import { loaderHtml, settle, revealStagger, orbEmpty, orbError, loadErrorText, online } from '../ui/orb-loader.js';
import { toast } from '../ui/toast.js';
import { Orb } from '../voice/orb.js';
import { SUGGESTIONS, openVoice } from '../voice/voice-sheet.js';
import { unlockVoice } from '../voice/speech.js';
import { maybePromptInstall } from '../install.js';
import { onLook, getLook, isClassic, sameLook } from '../lukas/store.js';
import { discovered, markDiscovered } from '../lukas/sync.js';
import { openTransactionDetail } from './transaction-form.js';

export const title = 'Inicio';

const dismissed = new Set();

// Precarga del resumen (arranque y login): el primer montaje lo usa en vez de mostrar un segundo loader
let prefetched = null;
export function prefetch() {
  prefetched = homeSummary();
  return prefetched.catch(() => {});
}
const UPCOMING_ICON = { card_due: 'card', card_cut: 'calendar', debt: 'bank', subscription: 'repeat' };
// Urgencia del badge: vencido rojo, hoy/mañana ámbar, 2–3 días morado suave, 4+ gris
const upTone = (d) => (d < 0 ? 'danger' : d <= 1 ? 'warn' : d <= 3 ? 'accent' : '');

export function mount(screen, { query, navigate }) {
  const hello = `${greeting()}${state.profile?.name ? `, ${state.profile.name}` : ''}`;
  screen.innerHTML = String(html`
    <div class="home-bar" aria-hidden="true"><span class="hb-orb">${raw(staticOrbSvg({ id: 'hb' }))}</span><span class="hb-title ellipsis">${hello}</span></div>
    <div class="scroller">
      <div class="content home">
        <header class="home-head">
          <a class="home-lukas" href="#/lukas" aria-label="Personalizar a Lukas" data-orb-slot><lukas-orb size="28"></lukas-orb></a>
          <div class="grow">
            <div class="home-date muted small">${new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' }).format(new Date())}</div>
            <h1 class="home-greet">${hello}</h1>
          </div>
          <a class="icon-btn filled" href="#/notificaciones" aria-label="Notificaciones">${icon('bell')}<span class="badge-dot" data-unread hidden></span></a>
        </header>
        <div class="home-body">${loaderHtml()}</div>
      </div>
    </div>`);

  const scroller = screen.querySelector('.scroller');
  const body = screen.querySelector('.home-body');
  let orb = null;
  let summary = null;
  // Lo que se mostró antes: la cifra, el anillo y la lista animan desde ahí en cada recarga
  let shown = null;
  const intro = onceThisSession('lukas.homeIntro');
  if (intro) introHeader(screen.querySelector('.home-head'));

  const paintUnread = (n) => {
    const b = screen.querySelector('[data-unread]');
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 9 ? '9+' : String(n);
  };

  const render = ({ first = false } = {}) => {
    const s = summary;
    const limit = Number(s.daily_limit) || 0;
    const spent = Number(s.today_expense) || 0;
    const pct = limit ? spent / limit : 0;
    const tone = budgetTone(pct);
    const upcoming = s.upcoming ?? [];
    const urgent = upcoming.length ? Math.min(...upcoming.map((u) => u.days_left)) : 99;
    const pulseAt = urgent <= 1 ? upcoming.findIndex((u) => u.days_left === urgent) : -1;
    const recent = s.recent ?? [];
    const fresh = shown ? new Set(recent.filter((t) => !shown.ids.has(t.id)).map((t) => t.id)) : new Set();
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
          ? html`Hoy llevas <b class="num" data-spent>${money(0)}</b> <span class="muted">de ${money(limit)}</span>`
          : html`Hoy llevas <b class="num" data-spent>${money(0)}</b> en gastos`}</p>
        <div class="orb-ring" data-tone="${tone}">
          ${budgetRing()}
          <div class="orb-float"><div class="orb-body">
            <canvas class="home-orb" aria-hidden="true"></canvas>
            <span class="orb-badge ${voiceUsed() ? '' : 'invite'}" aria-hidden="true">${icon('mic', { size: 18, stroke: 2.2 })}</span>
          </div></div>
          <button class="orb-btn" aria-label="Hablar con Lukas" aria-describedby="orb-help">
            <span class="sr-only" id="orb-help">Registra un gasto o ingreso con tu voz. Mantén presionado para hablar mientras lo sostienes.</span></button>
          <a class="orb-style ${discovered() ? '' : 'invite'}" href="#/lukas" aria-label="Personalizar a Lukas">${icon('hanger', { size: 19, stroke: 2.1 })}</a>
        </div>
        ${limit ? html`<p class="hero-left num">${spent <= limit ? `Te quedan ${money(limit - spent)} hoy` : `Te pasaste ${money(spent - limit)} hoy`}</p>` : ''}
        <p class="hero-hint">Cuéntame qué gastaste</p>
        <p class="hero-sub" aria-hidden="true">Toca a Lukas para hablar</p>
        <div class="chips scroll hero-suggest edge-fade">${SUGGESTIONS.slice(0, 3).map((t) => html`<button class="chip suggest" data-suggest="${t}" aria-label="Probar: ${t}">“${t}”</button>`)}</div>
        <form class="home-compose" autocomplete="off">
          <input class="input" name="q" placeholder="O escríbelo: “taxi 12 mil”" aria-label="Escribe un gasto" enterkeyhint="send" maxlength="500">
          <button class="composer-send is-empty" aria-label="Enviar" aria-disabled="true">${icon('send', { stroke: 2.4 })}</button>
        </form>
      </section>

      ${alerts.length ? html`<section class="alerts">${alerts.map((a) => html`<div class="banner ${a.tone}" data-key="${a.key}">
        ${icon(a.icon)}<span>${a.text}</span><button class="b-close" data-dismiss="${a.key}" aria-label="Descartar">${icon('x', { size: 16 })}</button></div>`)}</section>` : ''}

      <section class="section up-section">
        <div class="section-head"><h2 class="section-title">Próximos</h2><span class="muted small">7 días</span></div>
        ${upcoming.length ? html`<div class="upcoming">${upcoming.map((u, i) => html`<a class="up-card"
            href="${u.kind.startsWith('card') ? `#/tarjetas/${u.ref_id}` : u.kind === 'debt' ? '#/creditos' : '#/suscripciones'}"
            aria-label="${u.title}, ${inDays(u.days_left)}${u.amount ? `, ${money(u.amount)}` : ''}, ${dateShort(u.event_date)}">
          <div class="up-top"><span class="up-ico ${u.kind === 'card_cut' ? 'cut' : 'pay'}">${icon(UPCOMING_ICON[u.kind] ?? 'calendar', { size: 20 })}</span>
            <span class="up-badge">${i === pulseAt ? html`<i class="up-pulse" aria-hidden="true"></i>` : ''}<span class="tag ${upTone(u.days_left)}">${inDays(u.days_left)}</span></span></div>
          <div class="up-title ellipsis">${u.title}</div>
          <div class="up-sub ellipsis">${u.amount ? html`<b class="num">${moneyShort(u.amount)}</b> · ` : ''}${dateShort(u.event_date)}</div>
        </a>`)}</div>`
          : html`<div class="up-empty"><lukas-orb size="36" state="done" aria-hidden="true"></lukas-orb><span>Nada pendiente esta semana</span></div>`}
      </section>

      <section class="section">
        <div class="section-head"><h2 class="section-title">Últimos movimientos</h2>
          <a class="link-btn" href="#/movimientos">Ver todos${icon('chevron-right', { size: 16 })}</a></div>
        ${recent.length ? html`<div class="list ${first ? 'stagger' : ''}">${recent.map((t, i) => html`<div class="${fresh.has(t.id) ? 'is-new' : ''}" style="--i:${i}">${txRow(t)}</div>`)}</div>`
          : orbEmpty({ title: 'Cuéntame tu primer gasto', text: 'Toca el micrófono y dímelo como a un amigo. Por ejemplo: “almorcé por 18 lucas”.' })}
      </section>
      ${Number(s.month_expense) || Number(s.month_income) ? html`<section class="section month-strip card card-pad">
        <div><div class="eyebrow">Gastos del mes</div><div class="ms-val num">${money(s.month_expense)}</div></div>
        <div><div class="eyebrow">Ingresos del mes</div><div class="ms-val num income">${money(s.month_income)}</div></div>
        ${Number(s.card_debt) > 0 ? html`<div><div class="eyebrow">Deuda tarjetas</div><div class="ms-val num">${money(s.card_debt)}</div></div>` : ''}
      </section>` : ''}
    `);

    heroLook?.destroy();
    heroLook = null;
    orb?.destroy();
    orb = new Orb(body.querySelector('.home-orb'), { compact: false });
    ensureHeroLook();
    if (first) discoverStyle();
    countTo(body.querySelector('[data-spent]'), shown?.spent ?? 0, spent, { delay: first && intro ? 80 : 0 });
    playRing(body, { from: shown?.pct ?? 0, to: pct, fromTone: shown?.tone, tone, first: !shown });
    body.querySelectorAll('.edge-fade').forEach(paintEdges);
    // Movimiento nuevo (por voz o texto): Lukas sonríe y salta; la fila nueva entra resaltada
    if (fresh.size) {
      orb.cue('ok');
      hop(body.querySelector('.orb-body'));
      heroLook?.kick(1);
    }
    shown = { spent, pct, tone, ids: new Set(recent.map((t) => t.id)) };
    paintUnread(state.unread);
  };

  // Accesorios de Lukas sobre el orbe grande (solo si la cuenta tiene alguno: se cargan de forma diferida)
  let heroLook = null, heroLoading = false;
  function ensureHeroLook() {
    if (heroLook || heroLoading || !orb || isClassic(getLook())) return;
    heroLoading = true;
    const target = orb;
    import('../lukas/hero-look.js').then((m) => {
      heroLoading = false;
      if (!orb || orb !== target || !screen.isConnected) { ensureHeroLook(); return; }
      heroLook = m.attachHeroLook(orb, body.querySelector('.orb-body'));
    }).catch((e) => { heroLoading = false; console.error(e); });
  }
  // Barra compacta: el mismo Lukas con su look (SVG estático, versión mini)
  function paintBarOrb(cfg) {
    const slot = screen.querySelector('.hb-orb');
    if (!slot) return;
    if (isClassic(cfg)) { slot.innerHTML = staticOrbSvg({ id: 'hb' }); slot.classList.remove('has-look'); return; }
    import('../lukas/layer.js').then((m) => {
      if (!slot.isConnected || !sameLook(getLook(), cfg)) return;
      slot.innerHTML = m.lookSvg(cfg, { tier: 'mini', simple: true, viewBox: '22 22 76 76' });
      slot.classList.add('has-look');
    }).catch((e) => console.error(e));
  }
  // Primera vez (una por cuenta): la insignia del pincel pulsa y Lukas avisa que ya se puede vestir
  function discoverStyle() {
    if (discovered()) return;
    markDiscovered();
    const ring = body.querySelector('.orb-ring');
    if (!ring) return;
    const b = document.createElement('div');
    b.className = 'lk-home-bubble';
    b.setAttribute('role', 'status');
    b.textContent = '¡Ahora puedes vestirme! ✨';
    setTimeout(() => {
      if (!ring.isConnected) return;
      ring.appendChild(b);
      setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 400); }, 4600);
    }, 900);
  }

  // Personaje del header: procesa durante sincronizaciones y recargas en segundo plano (sin bloquear nada)
  const headOrb = screen.querySelector('.home-lukas lukas-orb');
  let bgLoads = 0;
  const paintSync = () => {
    if (!headOrb.engine) return;
    const busy = (state.syncing ?? 0) > 0 || bgLoads > 0;
    if (busy && headOrb.state !== 'thinking') headOrb.think();
    else if (!busy && headOrb.state === 'thinking') headOrb.cancel();
  };

  const load = async () => {
    const first = !summary;
    if (!first) { bgLoads++; paintSync(); }
    try {
      const pending = prefetched;
      prefetched = null;
      const next = await online(() => pending ?? homeSummary());
      if (first) await settle(body);
      summary = next;
      state.unread = Number(summary.unread) || 0;
      render({ first });
      // Primera vez en la sesión: coreografía completa; después, el contenido entra escalonado como en el resto de la app
      if (first && intro) introBody(body);
      else if (first) revealStagger(body, { selector: ':scope > :not(.hero)' });
      if (first && intro && state.unread) ringBell(screen.querySelector('.home-head .icon-btn'));
    } catch (err) {
      console.error(err);
      if (!summary) {
        await settle(body);
        body.innerHTML = String(orbError({ title: 'No pudimos cargar tu inicio', text: loadErrorText(err) }));
      }
    } finally {
      if (!first) { bgLoads--; paintSync(); }
    }
  };

  // Lukas se aplasta al presionar y rebota (squash & stretch) al soltar
  const squash = (down) => {
    const ob = screen.querySelector('.orb-body');
    if (!ob) return;
    if (down) {
      animate(ob, [{ transform: 'scale(1)' }, { transform: 'scale(1.08, 0.92)' }], { duration: spring.snappy.duration, easing: spring.snappy.easing, fill: 'forwards' });
      return;
    }
    heroLook?.kick(0.7);
    ob.getAnimations?.().forEach((a) => a.cancel());
    animate(ob, [{ transform: 'scale(1.08, 0.92)' }, { transform: 'scale(0.95, 1.12)', offset: 0.3 }, { transform: 'scale(1.02, 0.96)', offset: 0.62 }, { transform: 'scale(1)' }], { duration: 560 });
  };
  const setSendEmpty = (btn, empty) => {
    if (!btn || btn.classList.contains('is-empty') === empty) return;
    btn.classList.toggle('is-empty', empty);
    btn.setAttribute('aria-disabled', String(empty));
    if (!empty) animate(btn, [{ transform: 'scale(0.8)' }, { transform: 'scale(1)' }], { duration: spring.snappy.duration, easing: spring.snappy.easing });
  };

  // Orbe: toque = grabar; mantener = grabar mientras se sostiene
  let holdTimer = null, held = false, pressing = false;
  const offs = [
    on(screen, 'pointerdown', '.orb-btn', () => {
      unlockVoice(); // el desbloqueo de la voz tiene que nacer del toque (la grabación sostenida abre la hoja en un setTimeout)
      held = false;
      pressing = true;
      squash(true);
      haptic.tap();
      holdTimer = setTimeout(() => { held = true; haptic.start(); markVoiceUsed(); openVoice({ autoStart: true, hold: true }); }, 320);
    }),
    on(screen, 'pointerup', '.orb-btn', () => {
      clearTimeout(holdTimer);
      if (pressing) squash(false);
      pressing = false;
      if (!held) { haptic.start(); markVoiceUsed(); openVoice({ autoStart: true }); }
    }),
    on(screen, 'pointercancel', '.orb-btn', () => {
      clearTimeout(holdTimer);
      if (pressing) squash(false);
      pressing = false;
    }),
    on(screen, 'keydown', '.orb-btn', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unlockVoice(); markVoiceUsed(); openVoice({ autoStart: true }); } }),
    on(screen, 'click', '[data-suggest]', (e, b) => { haptic.select(); unlockVoice(); openVoice({ text: b.dataset.suggest }); }),
    on(screen, 'input', '.home-compose .input', (e, inp) => setSendEmpty(inp.form?.querySelector('.composer-send'), !inp.value.trim())),
    on(screen, 'submit', '.home-compose', (e, f) => {
      e.preventDefault();
      const v = f.q.value.trim();
      if (!v) return;
      f.q.value = '';
      f.q.blur();
      haptic.tap();
      const send = f.querySelector('.composer-send');
      const fly = animate(send.querySelector('svg'), [
        { transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-22px)', opacity: 0, offset: 0.45 },
        { transform: 'translateY(22px)', opacity: 0, offset: 0.46 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 440 });
      if (fly) fly.finished.then(() => setSendEmpty(send, !f.q.value.trim()), () => {});
      else setSendEmpty(send, true);
      unlockVoice();
      openVoice({ text: v });
    }),
    on(screen, 'click', '.up-card', () => haptic.select()),
    on(screen, 'click', '.home-head .icon-btn', () => haptic.select()),
    on(screen, 'click', '.orb-style, .home-lukas', () => haptic.select()),
    onLook((cfg) => { ensureHeroLook(); paintBarOrb(cfg); }),
    edgeFades(screen),
    collapsingHeader(screen, scroller),
    (() => {
      // Si se suelta fuera del orbe (p. ej. la hoja de voz se abrió encima al mantener), Lukas vuelve a su forma
      const release = () => { if (pressing) { pressing = false; squash(false); } };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
    })(),
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
    subscribe('syncing', paintSync),
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
    heroLook?.destroy();
    orb?.destroy();
  };
}
