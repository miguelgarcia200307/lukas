// Personalizar a Lukas: escenario con Lukas grande (reacciona a todo) + pestañas de slots, grilla de ítems y colores.
// Se carga de forma diferida (ruta #/lukas) junto con su CSS y el catálogo. Guardado optimista por cuenta (sync.js).
import { html, raw, on, el as domEl } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { animate, reducedMotion, spring } from '../utils/motion.js';
import { toast } from '../ui/toast.js';
import { setLeaveGuard } from '../route-guard.js';
import { getLook, sameLook, isClassic, SLOTS } from '../lukas/store.js';
import { saveLook, markDiscovered } from '../lukas/sync.js';
import {
  itemsOf, BY_ID, PALETTE, LOOKS, SLOT_INFO, equip, surprise, validateLook, describe, conflictText, itemName, colorOf,
} from '../lukas/catalog.js';
import { lookSvg } from '../lukas/layer.js';

export const title = 'Personaliza a Lukas';

// Encuadre de las miniaturas por slot (unidades del personaje)
const THUMB_VB = {
  looks: '-6 -8 132 132', cabeza: '6 -8 108 108', cabello: '10 -2 100 100', gafas: '26 28 68 68', vello: '26 40 68 68',
  cuello: '2 34 116 116', cara: '22 30 76 76', extras: '-8 -12 136 136',
};
const TABS = ['looks', 'cabeza', 'cabello', 'gafas', 'vello', 'cuello', 'cara', 'extras'];
const TAB_ICON = { looks: 'M12 3l2.2 5.2L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.8Z' };
const REACTION = { cabeza: 'arriba', cabello: 'feliz', gafas: 'ajuste', vello: 'ajuste', cuello: 'presume', cara: 'feliz', extras: 'presume' };
const SPIN = new Set(['cuello', 'extras']);
const PHRASES = {
  equip: ['¡Me encanta!', '¿Cómo me veo?', 'Esto es muy yo', 'Uff, elegancia pura', '¡Qué estilo!', 'Me queda pintado', '¡Así sí!', 'Ya me siento otro'],
  tickle: ['¡Jajaja, cosquillas!', '¡Ay, para, para!', '¡Jiji, eso no se vale!'],
  idle: ['¿Me tomas una foto?', 'Modelando…', '¿Así o más guapo?', '¿Probamos algo más?'],
  surprise: ['¡Sorpresa!', '¡A ver qué sale!', 'Esto no me lo esperaba'],
};
const CONFETTI = ['#4B3BF5', '#C8F35A', '#ABA3FF', '#F0997B', '#FFD23F', '#5848EE'];
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// CSS del editor: solo cuando se abre
let cssReady = null;
function loadCss() {
  if (cssReady) return cssReady;
  cssReady = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../css/lukas-studio.css', import.meta.url).href;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
    setTimeout(resolve, 1500);
  });
  return cssReady;
}

const tabIcon = (path) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`);

export function mount(screen, { navigate }) {
  const saved = validateLook(getLook());
  let cfg = { ...saved };
  let savedCfg = { ...saved };
  const undo = [];
  let tab = 'cabeza';
  let lastPhrase = '';
  let idleTimer = 0, bubbleTimer = 0, talkTimer = 0, gazeTimer = 0;
  let comparing = false;
  const thumbs = new Map();

  screen.classList.add('lk-screen');
  screen.style.opacity = '0';
  screen.innerHTML = String(html`
    <div class="lk-studio">
      <header class="lk-top">
        <button class="icon-btn" data-back aria-label="Volver">${icon('chevron-left')}</button>
        <h1 class="lk-title">Personaliza a Lukas</h1>
        <button class="icon-btn" data-undo aria-label="Deshacer" disabled>${icon('undo')}</button>
      </header>
      <div class="lk-stage">
        <div class="lk-halo" aria-hidden="true"></div>
        <div class="lk-podium" aria-hidden="true"></div>
        <div class="lk-bubble" aria-hidden="true"><span></span></div>
        <div class="lk-hero" role="button" tabindex="0" aria-describedby="lk-stage-help">
          <lukas-orb size="220" look="none"></lukas-orb>
        </div>
        <span class="sr-only" id="lk-stage-help">Toca a Lukas para hacerle cosquillas. Mantén presionado para comparar con cómo estaba guardado.</span>
        <p class="lk-hint" aria-hidden="true">Mantén presionado para comparar</p>
        <span class="lk-badge-compare" aria-hidden="true">Guardado</span>
        <div class="lk-confetti" aria-hidden="true"></div>
      </div>
      <div class="lk-panel">
        <div class="lk-tabs" role="tablist" aria-label="Tipos de accesorio">
          ${TABS.map((t) => html`<button class="lk-tab" role="tab" id="lk-tab-${t}" data-tab="${t}" aria-controls="lk-grid" aria-selected="false" tabindex="-1">
            ${tabIcon(t === 'looks' ? TAB_ICON.looks : SLOT_INFO[t].icono)}<span>${t === 'looks' ? 'Looks' : SLOT_INFO[t].nombre}</span><i class="lk-dot" aria-hidden="true"></i></button>`)}
        </div>
        <div class="lk-colors" role="radiogroup" aria-label="Color" hidden></div>
        <div class="lk-grid" id="lk-grid" role="radiogroup"></div>
      </div>
      <footer class="lk-actions">
        <button class="btn btn-secondary lk-act" data-surprise aria-label="Sorpréndeme">${icon('sparkles')}<span>Sorpréndeme</span></button>
        <button class="btn btn-ghost lk-act" data-classic aria-label="Lukas clásico">${icon('refresh')}<span>Clásico</span></button>
        <button class="btn btn-accent lk-save" data-save disabled><span class="btn-label">Guardar</span></button>
      </footer>
      <div class="sr-only" aria-live="polite" data-announce></div>
    </div>`);

  const $ = (s) => screen.querySelector(s);
  const hero = $('.lk-hero');
  const lk = $('.lk-hero lukas-orb');
  const grid = $('.lk-grid');
  const colors = $('.lk-colors');
  const bubble = $('.lk-bubble');
  const announcer = $('[data-announce]');

  // ── Lukas ──
  const engine = () => lk.engine;
  lk.setLook(cfg, { animate: false });
  engine()?.useLayer();

  const say = (text, { ms } = {}) => {
    if (!text) return;
    clearTimeout(bubbleTimer); clearTimeout(talkTimer);
    bubble.querySelector('span').textContent = text;
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    bubble.classList.add('show');
    lk.talk(true);
    talkTimer = setTimeout(() => lk.talk(false), Math.min(1800, 380 + text.length * 55));
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms ?? Math.max(1800, 900 + text.length * 70));
  };
  const pick = (list) => {
    const opts = list.filter((p) => p !== lastPhrase);
    lastPhrase = opts[Math.floor(Math.random() * opts.length)];
    return lastPhrase;
  };
  const announce = (t) => { announcer.textContent = ''; setTimeout(() => { announcer.textContent = t; }, 30); };
  const spin = () => animate(hero, [{ transform: 'rotate(0)' }, { transform: 'rotate(-7deg)', offset: 0.3 }, { transform: 'rotate(5deg)', offset: 0.65 }, { transform: 'rotate(0)' }],
    { duration: spring.bouncy.duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  const vibrate = (p) => { try { if ('vibrate' in navigator) navigator.vibrate(p); } catch { /* sin soporte */ } };

  // Inactividad: poses de modelaje cada pocos segundos
  const poke = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function pose() {
      if (!screen.isConnected) return;
      if (!comparing && document.visibilityState === 'visible') {
        lk.react(['pose1', 'pose2', 'pose3'][Math.floor(Math.random() * 3)]);
        if (Math.random() < 0.35) say(pick(PHRASES.idle));
      }
      idleTimer = setTimeout(pose, 6500 + Math.random() * 3000);
    }, 7000);
  };

  // ── Estado de la UI ──
  const dirty = () => !sameLook(cfg, savedCfg);
  const paintChrome = () => {
    $('[data-undo]').disabled = !undo.length;
    const save = $('[data-save]');
    save.disabled = !dirty();
    save.querySelector('.btn-label').textContent = dirty() ? 'Guardar' : 'Guardado';
    $('[data-classic]').disabled = isClassic(cfg);
    hero.setAttribute('aria-label', `${describe(cfg)}. Toca para hacerle cosquillas`);
    screen.querySelectorAll('.lk-tab').forEach((b) => {
      const s = b.dataset.tab;
      b.querySelector('.lk-dot').classList.toggle('on', s !== 'looks' && !!cfg[s]);
    });
  };

  const thumbFor = (slot, item) => {
    const c = item && cfg[slot] === item.id ? colorOf(cfg, item) : null;
    const key = `${slot}:${item?.id ?? '-'}:${c ?? ''}`;
    if (!thumbs.has(key)) {
      const look = item ? { [slot]: item.id, ...(c ? { colores: { [slot]: c } } : {}) } : {};
      thumbs.set(key, lookSvg(look, { viewBox: THUMB_VB[slot], label: item ? item.nombre : 'Ninguno' }));
    }
    return thumbs.get(key);
  };

  const renderGrid = () => {
    grid.setAttribute('aria-labelledby', `lk-tab-${tab}`);
    let cards;
    if (tab === 'looks') {
      cards = LOOKS.map((l) => {
        const look = validateLook(l.config);
        const on = sameLook(look, cfg);
        if (!thumbs.has(`look:${l.id}`)) thumbs.set(`look:${l.id}`, lookSvg(look, { viewBox: THUMB_VB.looks, label: l.nombre }));
        return html`<button class="lk-card is-look" role="radio" aria-checked="${on ? 'true' : 'false'}" data-look="${l.id}" tabindex="-1">
          <span class="lk-thumb">${raw(thumbs.get(`look:${l.id}`))}</span><span class="lk-name">${l.nombre}</span></button>`;
      });
    } else {
      const items = itemsOf(tab);
      cards = [html`<button class="lk-card is-none" role="radio" aria-checked="${cfg[tab] ? 'false' : 'true'}" data-pick="" tabindex="-1">
          <span class="lk-thumb">${raw(thumbFor(tab, null))}</span><span class="lk-name">Ninguno</span></button>`,
      ...items.map((it) => html`<button class="lk-card" role="radio" aria-checked="${cfg[tab] === it.id ? 'true' : 'false'}" data-pick="${it.id}" tabindex="-1">
          <span class="lk-thumb">${raw(thumbFor(tab, it))}</span><span class="lk-name">${it.nombre}</span></button>`)];
    }
    grid.innerHTML = String(html`${cards}`);
    const sel = grid.querySelector('[aria-checked="true"]') ?? grid.querySelector('.lk-card');
    if (sel) sel.tabIndex = 0;
    renderColors();
  };

  const renderColors = () => {
    const it = tab !== 'looks' && cfg[tab] ? BY_ID.get(cfg[tab]) : null;
    colors.hidden = !it?.coloreable;
    if (colors.hidden) { colors.innerHTML = ''; return; }
    const cur = colorOf(cfg, it);
    colors.setAttribute('aria-label', `Color de ${itemName(it)}`);
    colors.innerHTML = String(html`${PALETTE.map((p) => html`<button class="lk-swatch" role="radio" aria-checked="${p.hex === cur ? 'true' : 'false'}" aria-label="${p.nombre}" data-color="${p.hex}" style="--sw:${p.hex}" tabindex="${p.hex === cur ? 0 : -1}"></button>`)}`);
    if (!colors.querySelector('[tabindex="0"]')) colors.querySelector('.lk-swatch').tabIndex = 0;
  };

  const selectTab = (t, { focus = false } = {}) => {
    tab = t;
    screen.querySelectorAll('.lk-tab').forEach((b) => {
      const on = b.dataset.tab === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      if (on) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    renderGrid();
    grid.scrollTop = 0;
  };

  // Aplica un cambio de apariencia (con historial para deshacer)
  const commit = (next, { slot, reaction = true, phrase } = {}) => {
    next = validateLook(next);
    if (sameLook(next, cfg)) return false;
    undo.push(cfg);
    if (undo.length > 40) undo.shift();
    const prev = cfg;
    cfg = next;
    lk.setLook(cfg, { animate: true });
    if (isClassic(cfg) && !isClassic(prev)) {
      lk.react('timido');
      say('Me siento sin nada…');
    } else if (reaction) {
      const s = slot && cfg[slot] ? slot : SLOTS.find((x) => cfg[x] && cfg[x] !== prev[x]);
      if (s) {
        lk.react(REACTION[s]);
        if (SPIN.has(s)) spin();
        lk.engine?.layer?.kick(1);
      }
      say(phrase ?? pick(PHRASES.equip));
    }
    vibrate(10);
    paintChrome();
    renderGrid();
    poke();
    return true;
  };

  const equipItem = (slot, id) => {
    const { config, removed } = equip(cfg, slot, id);
    const it = id ? BY_ID.get(id) : null;
    const before = cfg[slot] ? BY_ID.get(cfg[slot]) : null;
    if (!commit(config, { slot })) return;
    if (removed.length && it) {
      const msg = conflictText(removed[0], it);
      toast(msg, { type: 'info' });
      announce(msg);
    } else announce(it ? `Lukas se puso ${it.art} ${itemName(it)}` : before ? `Lukas se quitó ${before.art} ${itemName(before)}` : '');
  };

  // ── Comparar (mantener presionado el escenario) ──
  const compare = (onOff) => {
    if (comparing === onOff) return;
    comparing = onOff;
    screen.classList.toggle('is-comparing', onOff);
    lk.setLook(onOff ? savedCfg : cfg, { animate: true, quick: true });
    if (onOff) { vibrate(8); announce(`Así estaba guardado: ${describe(savedCfg)}`); }
  };

  let pressTimer = 0, pressed = false, longPressed = false;
  const offs = [
    on(screen, 'pointerdown', '.lk-hero', (e) => {
      if (e.button > 0) return;
      pressed = true; longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; compare(true); }, 380);
    }),
    on(screen, 'contextmenu', '.lk-hero', (e) => e.preventDefault()),
    on(screen, 'click', '[data-tab]', (e, b) => { haptic.select(); selectTab(b.dataset.tab); }),
    on(screen, 'click', '[data-pick]', (e, b) => { haptic.select(); equipItem(tab, b.dataset.pick || null); b.focus?.(); }),
    on(screen, 'click', '[data-look]', (e, b) => {
      const l = LOOKS.find((x) => x.id === b.dataset.look);
      haptic.select();
      if (commit(l.config, { phrase: `¡Modo ${lc(l.nombre)} activado!` })) { spin(); announce(`Look ${l.nombre}: ${describe(cfg)}`); }
    }),
    on(screen, 'click', '[data-color]', (e, b) => {
      const it = BY_ID.get(cfg[tab]);
      if (!it) return;
      haptic.select();
      const { config } = equip(cfg, tab, it.id, b.dataset.color);
      if (commit(config, { slot: tab, reaction: false })) {
        lk.react('ajuste');
        announce(`${it.nombre} en ${PALETTE.find((p) => p.hex === b.dataset.color)?.nombre.toLowerCase()}`);
        colors.querySelector(`[data-color="${b.dataset.color}"]`)?.focus();
      }
    }),
    // Ojos hacia la bandeja al pasar o enfocar un ítem
    on(screen, 'pointerover', '.lk-card, .lk-swatch', (e, b) => { if (e.pointerType === 'mouse') gaze(b); }),
    on(screen, 'focusin', '.lk-card, .lk-swatch, .lk-tab', (e, b) => gaze(b)),
    on(screen, 'click', '[data-undo]', () => {
      if (!undo.length) return;
      haptic.tap();
      cfg = undo.pop();
      lk.setLook(cfg, { animate: true });
      lk.react('ajuste');
      paintChrome();
      renderGrid();
      announce(`Deshecho. ${describe(cfg)}`);
      poke();
    }),
    on(screen, 'click', '[data-surprise]', () => {
      haptic.tap();
      if (commit(surprise(cfg), { phrase: pick(PHRASES.surprise) })) { spin(); announce(describe(cfg)); }
    }),
    on(screen, 'click', '[data-classic]', async () => {
      const ok = await confirm3({ title: '¿Volver al Lukas clásico?', message: 'Se quitan todos los accesorios. Puedes deshacerlo antes de guardar.', actions: [['ok', 'Sí, clásico', 'btn-primary'], ['no', 'Cancelar', 'btn-ghost']] });
      if (ok !== 'ok') return;
      if (commit({}, {})) announce('Lukas clásico, sin accesorios');
    }),
    on(screen, 'click', '[data-save]', () => save()),
    // Teclado: flechas en pestañas, grilla y colores; Enter/Espacio en Lukas
    on(screen, 'keydown', '.lk-tab', (e, b) => {
      const i = TABS.indexOf(b.dataset.tab);
      const k = { ArrowRight: 1, ArrowLeft: -1, Home: -99, End: 99 }[e.key];
      if (k == null) return;
      e.preventDefault();
      selectTab(TABS[Math.max(0, Math.min(TABS.length - 1, k === -99 ? 0 : k === 99 ? TABS.length - 1 : i + k))], { focus: true });
    }),
    on(screen, 'keydown', '.lk-card, .lk-swatch', (e, b) => {
      const list = [...b.parentElement.children];
      const cols = Math.max(1, Math.round(b.parentElement.clientWidth / (b.offsetWidth || 1)));
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: b.classList.contains('lk-swatch') ? 1 : cols, ArrowUp: b.classList.contains('lk-swatch') ? -1 : -cols }[e.key];
      if (step == null) return;
      e.preventDefault();
      const n = list[Math.max(0, Math.min(list.length - 1, list.indexOf(b) + step))];
      list.forEach((x) => { x.tabIndex = x === n ? 0 : -1; });
      n.focus();
    }),
    on(screen, 'keydown', '.lk-hero', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); tickle(); }
      if (e.key === ' ' && !e.repeat) { e.preventDefault(); compare(true); }
    }),
    on(screen, 'keyup', '.lk-hero', (e) => { if (e.key === ' ') compare(false); }),
    on(screen, 'focusout', '.lk-hero', () => compare(false)),
  ];
  const release = (e) => {
    if (!pressed) return;
    pressed = false;
    clearTimeout(pressTimer);
    if (longPressed) compare(false);
    else if (e.type === 'pointerup' && e.target.closest?.('.lk-hero')) tickle();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  function gaze(target) {
    if (comparing) return;
    lk.lookAtElement(target);
    clearTimeout(gazeTimer);
    gazeTimer = setTimeout(() => lk.lookAt(0, 0), 1400);
    poke();
  }
  function tickle() {
    if (comparing) return;
    lk.react('cosquillas');
    say(pick(PHRASES.tickle), { ms: 1500 });
    vibrate([8, 40, 8]);
    poke();
  }

  function confetti() {
    if (reducedMotion()) return;
    const box = $('.lk-confetti');
    const n = 28;
    for (let i = 0; i < n; i++) {
      const p = domEl(`<i class="lk-conf" style="background:${CONFETTI[i % CONFETTI.length]};${i % 3 ? '' : 'border-radius:50%;'}"></i>`);
      box.appendChild(p);
      const a = (-90 + (Math.random() - 0.5) * 150) * (Math.PI / 180), d = 90 + Math.random() * 110;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      const anim = p.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(0.6)', opacity: 1 },
        { transform: `translate(${x}px, ${y}px) rotate(${(Math.random() - 0.5) * 540}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${x * 1.15}px, ${y + 120}px) rotate(${(Math.random() - 0.5) * 720}deg) scale(0.9)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' });
      anim.finished.then(() => p.remove(), () => p.remove());
    }
  }

  async function save() {
    if (!dirty()) return true;
    const clean = await saveLook(cfg);
    savedCfg = { ...clean };
    cfg = { ...clean };
    markDiscovered();
    lk.play('done');
    lk.engine?.layer?.kick(1.4);
    say('¡Quedé brutal!');
    confetti();
    haptic.success();
    vibrate([12, 60, 18]);
    announce(`Guardado. ${describe(cfg)}`);
    if (!navigator.onLine) toast('Guardado. Se sincroniza cuando vuelvas a tener conexión', { type: 'info' });
    paintChrome();
    return true;
  }

  // Salir con cambios sin guardar: confirmación amable
  setLeaveGuard(async () => {
    if (!dirty()) return true;
    const r = await confirm3({
      title: '¿Guardamos el nuevo look?', message: 'Lukas tiene cambios sin guardar.',
      actions: [['save', 'Guardar y salir', 'btn-accent'], ['discard', 'Salir sin guardar', 'btn-secondary'], ['stay', 'Seguir editando', 'btn-ghost']],
    });
    if (r === 'save') { await saveLook(cfg); savedCfg = { ...cfg }; return true; }
    return r === 'discard';
  });

  // ── Arranque ──
  selectTab(tab);
  paintChrome();
  markDiscovered();
  loadCss().then(() => {
    if (!screen.isConnected) return;
    screen.style.opacity = '';
    animate(screen.querySelector('.lk-studio'), [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fadeWhenReduced: true });
    setTimeout(() => {
      if (!screen.isConnected) return;
      lk.play('done');
      say('¡Uy, me vas a arreglar!');
      lk.engine?.layer?.kick(1);
    }, 260);
    poke();
  });

  return () => {
    setLeaveGuard(null);
    offs.forEach((f) => f());
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    [idleTimer, bubbleTimer, talkTimer, gazeTimer, pressTimer].forEach(clearTimeout);
  };
}

/** Diálogo con varias acciones (mismo estilo que confirmDialog) → id de la acción, o null al cerrar. */
function confirm3({ title, message, actions }) {
  return new Promise((resolve) => {
    const wrap = domEl(String(html`<div class="dialog-wrap" role="alertdialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-backdrop open"></div>
      <div class="dialog lk-dialog"><h3>${title}</h3>${message ? html`<p>${message}</p>` : ''}
        <div class="actions">${actions.map(([id, label, cls]) => html`<button class="btn ${cls}" data-a="${id}">${label}</button>`)}</div></div></div>`));
    document.body.append(wrap);
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) done(b.dataset.a);
      else if (e.target.classList.contains('sheet-backdrop')) done(null);
    });
    wrap.querySelector('[data-a]').focus();
  });
}
