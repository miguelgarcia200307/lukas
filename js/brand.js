// /brand: banco de pruebas del personaje antes de integrarlo en la app.
import { LukasOrbSettings } from './ui/lukas-orb.js';
import { orbLoader, revealStagger, shake, flipOrbTo, startPhrases } from './ui/orb-loader.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sp = () => LukasOrbSettings.speed;
const wait = (ms) => new Promise((r) => setTimeout(r, ms / sp()));
const once = (el, ev) => new Promise((r) => el.addEventListener(ev, (e) => r(e), { once: true }));
const seqEnd = (orb, state) => new Promise((r) => {
  const h = (e) => { if (!state || e.detail.state === state) { orb.removeEventListener('sequenceend', h); r(); } };
  orb.addEventListener('sequenceend', h);
});

/** Temporizadores cancelables (cada botón cancela la secuencia anterior). */
function timeline() {
  let ids = [], gen = 0;
  return {
    clear() { ids.forEach(clearTimeout); ids = []; gen++; },
    at(ms, fn) { ids.push(setTimeout(fn, ms / sp())); },
    get gen() { return gen; },
  };
}

// ── Personaje grande ───────────────────────────────────
const hero = $('#hero');
const pill = $('#state-pill');
const NAMES = { intro: 'Intro', rest: 'Reposo', thinking: 'Procesando', done: 'Listo', error: 'Error' };
hero.addEventListener('statechange', (e) => { pill.dataset.s = e.detail.state; pill.lastElementChild.textContent = NAMES[e.detail.state]; });
const tl = timeline();

$('#state-btns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]'); if (!b) return;
  tl.clear(); hero.play(b.dataset.s);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-seq]'); if (!b) return;
  tl.clear();
  const g = tl.gen;
  if (b.dataset.seq === 'flow') {
    hero.play('intro');
    seqEnd(hero, 'intro').then(() => { if (tl.gen !== g) return; hero.think(); tl.at(2600, () => hero.succeed()); });
  } else if (b.dataset.seq === 'think-fail') { hero.think(); tl.at(2400, () => hero.fail()); }
  else if (b.dataset.seq === 'think-cancel') { hero.think(); tl.at(2000, () => hero.cancel()); }
});

const INTERRUPTS = {
  'intro-think': () => { hero.play('intro'); tl.at(700, () => hero.think()); tl.at(3300, () => hero.succeed()); },
  'done-error': () => { hero.succeed(); tl.at(250, () => hero.fail()); },
  'error-done': () => { hero.fail(); tl.at(300, () => hero.succeed()); },
  'think-rest': () => { hero.think(); tl.at(1200 * 1.5, () => hero.cancel()); },
  'done-think': () => { hero.succeed(); tl.at(560, () => hero.think()); tl.at(2900, () => hero.succeed()); },
  chaos: () => {
    const states = ['intro', 'rest', 'thinking', 'done', 'error'];
    let t = 0;
    for (let i = 0; i < 14; i++) { t += 180 + Math.random() * 420; tl.at(t, () => hero.play(states[Math.floor(Math.random() * states.length)])); }
    tl.at(t + 900, () => hero.cancel());
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-int]'); if (!b) return;
  tl.clear(); INTERRUPTS[b.dataset.int]();
});

// Velocidad, movimiento reducido, humor, mirada, estirar
const speed = $('#speed');
const setSpeedLabel = () => { const v = (+speed.value).toFixed(2).replace(/\.?0+$/, ''); $('#speed-out').textContent = `${v}×`; $('#speed-note').textContent = `${v}×`; };
speed.addEventListener('input', () => { LukasOrbSettings.speed = +speed.value; setSpeedLabel(); });
$('#rm').addEventListener('change', (e) => { LukasOrbSettings.reducedOverride = e.target.checked ? true : null; });
const moodClosed = $('#mood-closed'), moodTired = $('#mood-tired');
moodClosed.addEventListener('change', () => { if (moodClosed.checked) moodTired.checked = false; hero.setMood(moodClosed.checked ? 'closed' : 'neutral'); });
moodTired.addEventListener('change', () => { if (moodTired.checked) moodClosed.checked = false; hero.setMood(moodTired.checked ? 'tired' : 'neutral'); });
const pull = $('#pull');
pull.addEventListener('input', () => { hero.setPull(+pull.value); $('#pull-out').textContent = (+pull.value).toFixed(2); });
pull.addEventListener('change', () => { pull.value = 0; $('#pull-out').textContent = '0'; hero.setPull(0); });
let follow = false;
$('#follow').addEventListener('change', (e) => { follow = e.target.checked; if (!follow) hero.lookAt(0, 0); });
window.addEventListener('pointermove', (e) => {
  if (!follow) return;
  const r = hero.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const reach = Math.max(r.width * 1.4, 300);
  hero.lookAt(Math.max(-1, Math.min(1, dx / reach)), Math.max(-1, Math.min(1, dy / reach)));
}, { passive: true });

// ── Tamaños ────────────────────────────────────────────
const SIZES = [16, 24, 32, 48, 64, 128, 256];
$('#sizes').innerHTML = SIZES.map((s) => `<div class="sz"><lukas-orb size="${s}" state="rest"></lukas-orb><span>${s}</span>${s < 40 ? '<small>simple</small>' : '<small>&nbsp;</small>'}</div>`).join('');
$('#size-btns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]'); if (!b) return;
  $$('#sizes lukas-orb').forEach((o) => o.play(b.dataset.s));
});

// ── Lockups ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-replay]'); if (!b) return;
  document.getElementById(b.dataset.replay).replay();
});

// ── Íconos ─────────────────────────────────────────────
$('#icons').innerHTML = `
  <div class="ic"><div class="view" style="align-content:center;padding:18px;background:#E9E9E4">
    <div style="width:100%"><div class="tab-mock"><lukas-orb size="16" simple></lukas-orb>Lukas</div>
    <div class="tab-mock" style="font-size:14px"><lukas-orb size="32" simple></lukas-orb>Lukas · 32 px</div></div>
  </div><p class="lbl">favicon.svg · 16 · 32<small>Silueta fija + gradiente + cara simple</small></p></div>
  <div class="ic"><div class="view"><div class="tile apple"><lukas-orb size="80" simple></lukas-orb></div></div>
    <p class="lbl">apple-touch-icon 180<small>Personaje sobre #F6F5F2</small></p></div>
  <div class="ic"><div class="view"><div class="tile pwa"><lukas-orb size="85" simple></lukas-orb></div></div>
    <p class="lbl">PWA 192 · 512<small>Mismo dibujo, escalado</small></p></div>
  <div class="ic"><div class="view"><div class="tile mask"><lukas-orb size="90" simple></lukas-orb></div></div>
    <p class="lbl">Maskable 512<small>La línea punteada es la zona segura (80 %)</small></p></div>
  <div class="ic" style="grid-column:1/-1"><div class="og-box" id="og-box"><div class="og" id="og">
      <lukas-lockup orientation="horizontal" size="150"></lukas-lockup>
      <p class="slogan" style="margin-left:56px"><b>Tus lucas, en orden.</b> Solo dilo<span class="coin-dot"></span></p>
    </div></div>
    <p class="lbl">og-image 1200 × 630<small>Lockup horizontal + eslogan</small></p></div>`;
const og = $('#og'), ogBox = $('#og-box');
new ResizeObserver(() => { og.style.transform = `scale(${ogBox.clientWidth / 1200})`; }).observe(ogBox);

// ── Simuladores de pantallas de carga ─────────────────
const ROWS = [
  ['Almuerzo', 'Comida · Nequi', '$18.000', '#FFE3D6'],
  ['Uber', 'Transporte · Tarjeta', '$9.500', '#DCEBFF'],
  ['Café', 'Comida · Efectivo', '$6.000', '#FFE3D6'],
  ['Mercado', 'Hogar · Débito', '$15.000', '#E3F4D9'],
];
const rowsHtml = (rows = ROWS) => rows.map(([t, s, a, c]) => `<div class="m-row"><div class="m-ico" style="background:${c}"></div><div><div class="t">${t}</div><div class="s">${s}</div></div><div class="a">${a}</div></div>`).join('');
const homeBlocks = () => `
  <div class="m-card"><div class="m-k">Hoy llevas</div><div class="m-big">$48.500 <span>de $120.000</span></div><div class="m-bar"><i style="width:40%"></i></div></div>
  <div class="m-two"><div class="m-card"><div class="m-k">Este mes</div><div class="m-mid">$1.284.000</div></div><div class="m-card"><div class="m-k">Disponible</div><div class="m-mid">$716.000</div></div></div>
  <div class="m-list">${rowsHtml()}</div>`;
const homeHtml = (orb = '') => `<div class="m-head"><div class="m-slot">${orb}</div><div><div class="m-sub">Miércoles, 11 de nov</div><div class="m-h">Inicio</div></div><div class="m-status"></div></div><div class="m-blocks">${homeBlocks()}</div>`;
const revealHome = (scr) => { revealStagger(scr, { selector: '.m-head > div:not(.m-slot), .m-blocks > *' }); };

function sim({ title, desc, controls, setup }) {
  const wrap = document.createElement('div');
  wrap.className = 'sim';
  wrap.innerHTML = `<div class="sim-h"><b>${title}</b><span>${desc}</span></div><div class="phone"><div class="scr"></div></div><div class="ctl">${controls}</div>`;
  $('#sims').appendChild(wrap);
  const phone = $('.phone', wrap), scr = $('.scr', wrap), ctl = $('.ctl', wrap);
  setup({ wrap, phone, scr, ctl });
}

// 1 · Splash / arranque
sim({
  title: '1 · Arranque',
  desc: 'Intro → procesando mientras cargan los datos → listo solo la primera vez del día → viaja al header.',
  controls: `<button class="b small primary" data-play>Reproducir</button>
    <select class="b small" data-load aria-label="Duración de la carga"><option value="150">Carga rápida (0,15 s)</option><option value="3200" selected>Carga normal (3,2 s)</option><option value="7000">Carga lenta (7 s)</option></select>
    <label class="switch"><input type="checkbox" data-first checked>Primera carga del día</label>`,
  setup({ phone, scr, ctl }) {
    let run = 0;
    const play = async () => {
      const id = ++run;
      $('.overlay', phone)?.remove();
      scr.innerHTML = homeHtml();
      scr.style.visibility = 'hidden';
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = '<div class="center-col"><lukas-orb size="120" state="intro"></lukas-orb><div class="lukas-phrase is-hidden" style="margin-top:28px"></div></div>';
      phone.appendChild(ov);
      const orb = $('lukas-orb', ov);
      const ms = +$('[data-load]', ctl).value;
      let loaded = false;
      const data = wait(ms).then(() => { loaded = true; });
      const slow = setTimeout(() => { if (!loaded) stop = startPhrases($('.lukas-phrase', ov)); }, 4000 / sp());
      let stop = null;
      await seqEnd(orb, 'intro');
      if (id !== run) return;
      if (!loaded) { orb.think(); await data; }
      clearTimeout(slow); stop?.();
      if (id !== run) return;
      if (!loaded) return;
      if ($('[data-first]', ctl).checked) {
        if (orb.state !== 'thinking') await wait(250);
        orb.succeed();
        await wait(1350);
        if (id !== run) return;
      }
      orb.cancel();
      // Transición compartida: el contenido aparece mientras el personaje viaja al header
      scr.style.visibility = '';
      ov.classList.add('clear');
      ov.animate([{ backgroundColor: 'rgba(247,247,244,1)' }, { backgroundColor: 'rgba(247,247,244,0)' }], { duration: 260, fill: 'forwards' });
      revealHome(scr);
      await flipOrbTo(orb, $('.m-slot', scr), { targetSize: 28 });
      ov.remove();
    };
    $('[data-play]', ctl).addEventListener('click', play);
    scr.innerHTML = homeHtml('<lukas-orb size="28"></lukas-orb>');
  },
});

// 2 · Login
sim({
  title: '2 · Login',
  desc: 'Mientras escribes la contraseña, cierra los ojos. Entrar: procesando → listo (o error y el formulario se sacude).',
  controls: `<button class="b small primary" data-play>Reproducir</button>
    <label class="switch"><input type="checkbox" data-fail>Contraseña incorrecta</label>`,
  setup({ phone, scr, ctl }) {
    const render = () => {
      $('.overlay', phone)?.remove();
      scr.innerHTML = `<div class="center-col" style="gap:0;justify-content:flex-start;padding-top:34px">
        <lukas-lockup orientation="vertical" size="68" intro></lukas-lockup>
        <p style="font-size:12.5px;color:var(--ink-3);margin:8px 0 22px">Tus lucas, en orden. Solo dilo.</p>
        <form class="login-form" style="width:100%;display:flex;flex-direction:column;gap:12px" autocomplete="off">
          <div class="m-field"><label>Correo</label><input type="email" placeholder="tu@correo.com"></div>
          <div class="m-field"><label>Contraseña</label><input type="password" data-pass placeholder="••••••••"></div>
          <div class="m-err" data-err></div>
          <button class="m-btn" type="submit"><span class="lbl">Entrar</span></button>
        </form>
        <p class="m-foot" style="margin-top:auto">Acceso privado</p></div>`;
      const lockup = $('lukas-lockup', scr), orb = () => lockup.orb;
      const pass = $('[data-pass]', scr), form = $('form', scr), err = $('[data-err]', scr), btn = $('.m-btn', scr);
      let idle = 0;
      // Detalle de confianza: no mira mientras escribes la contraseña
      pass.addEventListener('input', () => {
        orb().setMood('closed');
        clearTimeout(idle);
        idle = setTimeout(() => orb().setMood('neutral'), 1400);
      });
      pass.addEventListener('blur', () => { clearTimeout(idle); orb().setMood('neutral'); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btn.disabled) return;
        clearTimeout(idle);
        pass.blur();
        orb().setMood('neutral');
        err.textContent = '';
        btn.disabled = true; btn.style.opacity = '.55';
        $('.lbl', btn).textContent = 'Entrando…';
        orb().think();
        await wait(1700);
        btn.disabled = false; btn.style.opacity = '';
        $('.lbl', btn).textContent = 'Entrar';
        if ($('[data-fail]', ctl).checked) {
          orb().fail();
          shake(form);
          err.textContent = 'Correo o contraseña incorrectos.';
          return;
        }
        orb().succeed();
        await wait(1350);
        orb().cancel();
        // Al home: el formulario se va y el personaje viaja al header
        const big = orb();
        const r = big.getBoundingClientRect(), pr = phone.getBoundingClientRect();
        const ov = document.createElement('div');
        ov.className = 'overlay clear';
        phone.appendChild(ov);
        ov.appendChild(big);
        Object.assign(big.style, { position: 'absolute', left: `${r.left - pr.left}px`, top: `${r.top - pr.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        const old = scr.firstElementChild;
        await old.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 200, fill: 'forwards' }).finished;
        scr.innerHTML = homeHtml();
        revealHome(scr);
        await flipOrbTo(big, $('.m-slot', scr), { targetSize: 28 });
        ov.remove();
      });
      pass.focus({ preventScroll: true });
      pass.blur();
    };
    $('[data-play]', ctl).addEventListener('click', render);
    render();
  },
});

// 3 · Header
sim({
  title: '3 · Header',
  desc: 'Pequeño y en reposo. Procesa durante una sincronización en segundo plano sin bloquear nada.',
  controls: '<button class="b small primary" data-play>Sincronizar</button>',
  setup({ scr, ctl }) {
    scr.innerHTML = homeHtml('<lukas-orb size="28"></lukas-orb>');
    const status = $('.m-status', scr);
    status.textContent = 'Al día';
    $('[data-play]', ctl).addEventListener('click', async () => {
      const orb = $('.m-slot lukas-orb', scr);
      orb.think();
      status.textContent = 'Sincronizando…';
      await wait(2600);
      orb.succeed();
      status.textContent = 'Al día';
    });
  },
});

// 4 · Loader de sección
const sectionHtml = () => `
  <div class="m-card"><div class="m-k">Gasto por semana</div><div class="m-bars">${[40, 62, 35, 88, 54, 70, 30].map((h, i) => `<i class="${i === 3 ? 'hi' : ''}" style="height:${h}%"></i>`).join('')}</div></div>
  <div class="m-list">${rowsHtml(ROWS.slice(0, 3))}</div>`;
sim({
  title: '4 · Loader de sección',
  desc: 'Personaje de 48 px centrado en vez de esqueletos. Prueba la carga rápida: no aparece nada.',
  controls: `<button class="b small" data-ms="150">0,15 s</button><button class="b small primary" data-ms="1500">1,5 s</button><button class="b small" data-ms="6500">6,5 s</button><button class="b small" data-ms="1800" data-fail>Falla</button>`,
  setup({ scr, ctl }) {
    scr.innerHTML = `<div class="m-head"><div><div class="m-sub">Noviembre</div><div class="m-h">Reportes</div></div></div>
      <div class="m-tabs"><span class="on">Semana</span><span>Mes</span><span>Categorías</span></div><div class="m-content"></div>`;
    const host = $('.m-content', scr);
    host.style.gap = '10px';
    host.innerHTML = sectionHtml();
    ctl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ms]'); if (!b) return;
      const fail = b.hasAttribute('data-fail');
      host.innerHTML = '';
      try {
        await orbLoader(host, wait(+b.dataset.ms).then(() => { if (fail) throw new Error('x'); }), { size: 48, keepOnError: true });
        host.innerHTML = sectionHtml();
        revealStagger(host);
      } catch {
        host.insertAdjacentHTML('beforeend', '<p style="text-align:center;font-size:12.5px;color:var(--ink-3);margin-top:-30px">No pudimos cargar los reportes.</p>');
      }
    });
  },
});

// 5 · Loaders en línea
sim({
  title: '5 · En línea',
  desc: 'Versión de 20–24 px dentro de botones y filas. Nunca un spinner genérico.',
  controls: '<button class="b small primary" data-row>Sincronizar fila</button>',
  setup({ scr, ctl }) {
    scr.innerHTML = `<div class="m-head"><div><div class="m-sub">Nuevo gasto</div><div class="m-h">$ 18.000</div></div></div>
      <div class="m-blocks">
        <div class="m-list">${rowsHtml([['Almuerzo', 'Comida · Nequi', '$18.000', '#FFE3D6']])}</div>
        <div class="m-list" data-rows>${rowsHtml(ROWS.slice(1))}</div>
        <div style="flex:1"></div>
      </div>
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
        <button class="m-btn" data-save><span class="lbl">Guardar</span></button>
      </div>`;
    const save = $('[data-save]', scr);
    save.addEventListener('click', async () => {
      if (save.disabled) return;
      save.disabled = true;
      const lbl = $('.lbl', save);
      lbl.style.opacity = '0';
      save.insertAdjacentHTML('beforeend', '<lukas-orb size="24" state="thinking"></lukas-orb>');
      await wait(1500);
      const o = $('lukas-orb', save);
      o.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }], { duration: 180, fill: 'forwards' }).finished.then(() => o.remove());
      lbl.textContent = 'Guardado';
      lbl.style.opacity = '1';
      await wait(1200);
      lbl.style.opacity = '0';
      await wait(160);
      lbl.textContent = 'Guardar'; lbl.style.opacity = '1';
      save.disabled = false;
    });
    $('[data-row]', ctl).addEventListener('click', async () => {
      const a = $('[data-rows] .m-row .a', scr);
      if (a.querySelector('lukas-orb')) return;
      const val = a.textContent;
      a.innerHTML = `<lukas-orb size="20" state="thinking"></lukas-orb><span style="color:var(--ink-4)">${val}</span>`;
      await wait(2200);
      a.querySelector('lukas-orb').succeed();
      a.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 240 });
      a.textContent = val;
    });
  },
});

// 6 · Pull-to-refresh
sim({
  title: '6 · Pull-to-refresh',
  desc: 'Arrastra la lista hacia abajo: se estira siguiendo el dedo y abre más los ojos. Al soltar: procesando → listo.',
  controls: '<button class="b small primary" data-auto>Simular tirón</button>',
  setup({ scr, phone, ctl }) {
    scr.innerHTML = `<div class="m-head"><div><div class="m-sub">Noviembre</div><div class="m-h">Movimientos</div></div></div>
      <div class="ptr-list" data-list><div class="m-list" style="margin-top:12px">${rowsHtml([...ROWS, ...ROWS.slice(0, 2)])}</div><p class="ptr-hint">Arrastra hacia abajo para actualizar</p></div>`;
    const zone = document.createElement('div');
    zone.className = 'ptr-zone';
    zone.innerHTML = '<lukas-orb size="40" state="rest"></lukas-orb>';
    zone.style.top = '74px';
    phone.appendChild(zone);
    const orb = $('lukas-orb', zone), list = $('[data-list]', scr);
    const THRESH = 78, MAX = 120;
    let y0 = null, d = 0, busy = false;
    const setD = (v) => {
      d = v;
      list.style.transform = `translateY(${v.toFixed(1)}px)`;
      const p = Math.min(1, v / THRESH);
      zone.style.opacity = Math.min(1, p * 1.6).toFixed(2);
      zone.style.transform = `translateY(${(-24 + 24 * p).toFixed(1)}px) scale(${(0.6 + 0.4 * p).toFixed(3)})`;
      if (!busy) orb.setPull(p);
    };
    const back = (to = 0, ms = 420) => new Promise((res) => {
      const from = d, t0 = performance.now();
      const step = (now) => {
        const x = Math.min(1, (now - t0) / (ms / sp()));
        const k = 1 - Math.pow(1 - x, 3);
        setD(from + (to - from) * k);
        if (x < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const release = async () => {
      if (d >= THRESH && !busy) {
        busy = true;
        orb.setPull(0);
        orb.think();
        await back(THRESH - 8, 260);
        await wait(1700);
        orb.succeed();
        await wait(1250);
        await back(0, 380);
        $('.m-list', list).animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 300 });
        revealStagger($('.m-list', list));
        busy = false;
      } else back(0);
    };
    list.addEventListener('pointerdown', (e) => { if (busy) return; y0 = e.clientY; list.setPointerCapture(e.pointerId); });
    list.addEventListener('pointermove', (e) => {
      if (y0 == null || busy) return;
      const raw = Math.max(0, e.clientY - y0);
      setD(MAX * (1 - Math.exp(-raw / MAX))); // goma: cuesta más mientras más tiras
    });
    const up = () => { if (y0 == null) return; y0 = null; release(); };
    list.addEventListener('pointerup', up);
    list.addEventListener('pointercancel', up);
    $('[data-auto]', ctl).addEventListener('click', async () => {
      if (busy) return;
      await back(MAX * 0.82, 700);
      await wait(200);
      release();
    });
    setD(0);
  },
});

// 7 · Sin conexión / error de carga
sim({
  title: '7 · Sin conexión',
  desc: 'Error, y luego queda en reposo con ojos cansados. Reintentar: procesando.',
  controls: `<button class="b small primary" data-play>Reproducir</button><label class="switch"><input type="checkbox" data-fail>El reintento falla</label>`,
  setup({ scr, phone, ctl }) {
    const render = async () => {
      $('.overlay', phone)?.remove();
      scr.innerHTML = `<div class="center-col" style="padding-bottom:30px">
        <lukas-orb size="110" state="rest"></lukas-orb>
        <h3 style="font-size:18px;letter-spacing:-0.02em;margin-top:30px">Sin conexión</h3>
        <p style="font-size:13px;color:var(--ink-3);max-width:28ch">No pudimos cargar tus lucas. Revisa tu conexión e inténtalo de nuevo.</p>
        <button class="m-btn sec" data-retry style="width:auto;padding:0 22px;margin-top:8px"><span class="lbl">Reintentar</span></button></div>`;
      const orb = $('lukas-orb', scr), retry = $('[data-retry]', scr);
      await wait(300);
      orb.fail();
      orb.setMood('tired');
      retry.addEventListener('click', async () => {
        if (retry.disabled) return;
        retry.disabled = true;
        orb.setMood('neutral');
        orb.think();
        $('.lbl', retry).textContent = 'Reintentando…';
        await wait(2000);
        retry.disabled = false;
        $('.lbl', retry).textContent = 'Reintentar';
        if ($('[data-fail]', ctl).checked) { orb.fail(); orb.setMood('tired'); return; }
        orb.succeed();
        await wait(1350);
        orb.cancel();
        const r = orb.getBoundingClientRect(), pr = phone.getBoundingClientRect();
        const ov = document.createElement('div');
        ov.className = 'overlay clear';
        phone.appendChild(ov);
        ov.appendChild(orb);
        Object.assign(orb.style, { position: 'absolute', left: `${r.left - pr.left}px`, top: `${r.top - pr.top}px` });
        scr.innerHTML = homeHtml();
        revealHome(scr);
        await flipOrbTo(orb, $('.m-slot', scr), { targetSize: 28 });
        ov.remove();
      });
    };
    $('[data-play]', ctl).addEventListener('click', render);
    render();
  },
});

// 8 · Estado vacío
sim({
  title: '8 · Sin gastos todavía',
  desc: 'En reposo, mirando hacia el botón principal, con una invitación clara.',
  controls: '<label class="switch"><input type="checkbox" data-look checked>Mirar al botón</label>',
  setup({ scr, phone, ctl }) {
    scr.innerHTML = `<div class="m-head"><div><div class="m-sub">Noviembre</div><div class="m-h">Movimientos</div></div></div>
      <div class="center-col" style="padding-bottom:86px;gap:8px">
        <lukas-orb size="88" state="rest"></lukas-orb>
        <h3 style="font-size:19px;letter-spacing:-0.02em;margin-top:26px">Cuéntame tu primer gasto</h3>
        <p style="font-size:13px;color:var(--ink-3);max-width:27ch">Toca el micrófono y dilo como se lo dirías a un amigo: <b style="color:var(--ink-2);font-weight:650">“Almuerzo, 18 mil con Nequi”</b>.</p>
      </div>`;
    phone.insertAdjacentHTML('beforeend', `<div class="m-tabbar"><span class="tb"></span><span class="tb"></span><span class="m-fab" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg></span><span class="tb"></span><span class="tb"></span></div>`);
    const orb = $('lukas-orb', scr), fab = $('.m-fab', phone), look = $('[data-look]', ctl);
    // Mira al botón; de vez en cuando vuelve a mirarte y regresa
    let n = 0;
    const loop = () => {
      if (look.checked) { if (n++ % 3 === 2) orb.lookAt(0, 0); else orb.lookAtElement(fab); }
      setTimeout(loop, (n % 3 === 0 ? 1500 : 2600) / sp());
    };
    look.addEventListener('change', () => { if (!look.checked) orb.lookAt(0, 0); else orb.lookAtElement(fab); });
    requestAnimationFrame(() => { orb.lookAtElement(fab); setTimeout(loop, 2600); });
  },
});

setSpeedLabel();
