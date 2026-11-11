// Login premium: solo email + contraseña
import { sb } from '../supabase.js';
import { APP_NAME } from '../config.js';
import { html, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { logoSvg } from '../ui/logo.js';

export const title = 'Entrar';

export function mount(screen) {
  screen.innerHTML = String(html`
    <div class="scroller login">
      <div class="login-inner">
        <div class="login-brand">
          <div class="login-logo">${raw(logoSvg({ size: 76, animated: true }))}</div>
          <h1>${APP_NAME}</h1>
          <p class="muted">Tus lucas, en orden. Solo dilo.</p>
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
          <button class="btn btn-primary btn-block" type="submit"><span class="btn-label">Entrar</span><span class="spinner"></span></button>
        </form>
        <p class="login-foot muted xsmall">Acceso privado · ${APP_NAME} es solo para su dueño.</p>
      </div>
    </div>`);

  const form = screen.querySelector('form');
  const email = form.email;
  const pass = form.password;
  const errBox = form.querySelector('.login-error');
  const btn = form.querySelector('[type="submit"]');

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
    if (!ok) { form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); haptic.error(); return; }

    btn.classList.add('loading');
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) {
      btn.classList.remove('loading');
      btn.disabled = false;
      const msg = /invalid login|invalid credentials/i.test(error.message) ? 'Correo o contraseña incorrectos. Intenta de nuevo.'
        : /fetch|network/i.test(error.message) ? 'Sin conexión. Revisa tu internet.' : 'No pudimos entrar. Intenta en un momento.';
      errBox.textContent = msg;
      errBox.hidden = false;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      haptic.error();
      return;
    }
    haptic.success();
    const { afterLogin } = await import('../app.js');
    await afterLogin(data.session).catch((err) => {
      console.error(err);
      btn.classList.remove('loading');
      btn.disabled = false;
    });
  });
}
