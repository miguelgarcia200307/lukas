// Login premium: solo email + contraseña
import { sb } from '../supabase.js';
import { APP_NAME } from '../config.js';
import { html, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { inFlight, takeOff, shake } from '../ui/orb-loader.js';

export const title = 'Entrar';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function mount(screen) {
  // Si el personaje viene volando desde el arranque, aterriza en el lockup (sin repetir la intro)
  const arriving = inFlight();
  screen.innerHTML = String(html`
    <div class="scroller login">
      <div class="login-inner">
        <div class="login-brand">
          <h1 class="sr-only">${APP_NAME}</h1>
          <lukas-lockup orientation="vertical" size="76" data-orb-slot ${raw(arriving ? '' : 'intro')}></lukas-lockup>
          <p class="muted login-tagline">Tus lucas, en orden. Solo dilo.</p>
        </div>
        <form class="login-form card" novalidate autocomplete="on">
          <div class="field">
            <label for="email">Correo</label>
            <div class="input-icon">${icon('mail', { size: 18 })}<input id="email" class="input" type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required placeholder="tu@correo.com"></div>
            <div class="field-error" data-err="email"></div>
          </div>
          <div class="field">
            <label for="password">Contraseña</label>
            <div class="input-icon">${icon('lock', { size: 18 })}<input id="password" class="input" type="password" name="password" autocomplete="current-password" required placeholder="••••••••">
              <button type="button" class="pw-toggle" aria-label="Mostrar contraseña">${icon('eye', { size: 18 })}</button></div>
            <div class="field-error" data-err="password"></div>
          </div>
          <div class="login-error" role="alert" hidden></div>
          <button class="btn btn-primary btn-block" type="submit"><span class="btn-label">Entrar</span></button>
        </form>
        <p class="login-foot muted xsmall">Acceso privado · Desarrollado por MIGUEL GARCIA</p>
      </div>
    </div>`);

  const form = screen.querySelector('form');
  const email = form.email;
  const pass = form.password;
  const errBox = form.querySelector('.login-error');
  const btn = form.querySelector('[type="submit"]');
  const lockup = screen.querySelector('lukas-lockup');
  const orb = () => lockup.orb;
  const label = btn.querySelector('.btn-label');
  if (arriving) {
    lockup.word.classList.add('is-hidden');
    setTimeout(() => lockup.word.classList.remove('is-hidden'), 650); // tras el aterrizaje (500 ms) + 150 ms
  }

  // Detalle de confianza: mientras escribes la contraseña, Lukas cierra los ojos; al terminar los abre
  let idle = 0;
  const openEyes = () => { clearTimeout(idle); orb()?.setMood('neutral'); };
  pass.addEventListener('input', () => {
    orb()?.setMood('closed');
    clearTimeout(idle);
    idle = setTimeout(openEyes, 1400);
  });
  pass.addEventListener('blur', openEyes);
  const failed = () => {
    orb()?.fail();
    shake(form);
    haptic.error();
  };

  const setErr = (name, msg) => {
    form.querySelector(`[data-err="${name}"]`).textContent = msg;
    form[name].classList.toggle('invalid', !!msg);
  };
  email.addEventListener('blur', () => {
    if (email.value && !/^\S+@\S+\.\S+$/.test(email.value)) setErr('email', 'Revisa el correo');
  });
  [email, pass].forEach((i) => i.addEventListener('input', () => { setErr(i.name, ''); errBox.hidden = true; }));
  form.querySelector('.pw-toggle').addEventListener('click', () => {
    pass.type = pass.type === 'password' ? 'text' : 'password';
    pass.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let ok = true;
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { setErr('email', 'Escribe un correo válido'); ok = false; }
    if (pass.value.length < 6) { setErr('password', 'Escribe tu contraseña'); ok = false; }
    if (!ok) { failed(); return; }

    openEyes();
    errBox.hidden = true;
    btn.disabled = true;
    label.textContent = 'Entrando…';
    orb()?.think();
    const t0 = performance.now();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    const left = 600 - (performance.now() - t0); // procesando nunca parpadea: mínimo 600 ms
    if (left > 0) await sleep(left);
    if (error) {
      btn.disabled = false;
      label.textContent = 'Entrar';
      const msg = /invalid login|invalid credentials/i.test(error.message) ? 'Correo o contraseña incorrectos. Intenta de nuevo.'
        : /fetch|network/i.test(error.message) ? 'Sin conexión. Revisa tu internet.' : 'No pudimos entrar. Intenta en un momento.';
      errBox.textContent = msg;
      errBox.hidden = false;
      failed();
      return;
    }
    haptic.success();
    orb()?.succeed();
    // Listo → mientras se celebra se cargan los datos; si tardan más, vuelve a procesar
    let ready = false;
    const celebrated = sleep(1350);
    celebrated.then(() => { if (!ready) orb()?.think(); });
    const { afterLogin } = await import('../app.js');
    await afterLogin(data.session, {
      onReady: async () => {
        ready = true;
        await celebrated;
        orb()?.cancel();
        lockup.word.classList.add('is-hidden');
        takeOff(orb()); // viaja al header de la siguiente pantalla
      },
    }).catch((err) => {
      console.error(err);
      btn.disabled = false;
      label.textContent = 'Entrar';
      orb()?.fail();
    });
  });
}
