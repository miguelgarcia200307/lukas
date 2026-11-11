// Onboarding (solo la primera vez): bienvenida → límite diario → tarjetas/cuentas → permisos → instalar
import { APP_NAME } from '../config.js';
import { html, raw, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number } from '../utils/format.js';
import { haptic } from '../utils/haptics.js';
import { state, subscribe } from '../state.js';
import { updateProfile } from '../api/profile.js';
import { createAccount } from '../api/accounts.js';
import { bindAmountInput } from '../ui/number-input.js';
import { toast } from '../ui/toast.js';
import { runSave } from '../ui/submit.js';
import { logoSvg } from '../ui/logo.js';
import { enablePush, pushStatus } from '../push.js';
import { showPermissionHelp } from '../permissions.js';
import { isStandalone, maybePromptInstall } from '../install.js';
import { openCardForm } from './cards.js';
import { openAccountForm } from './accounts.js';

export const title = 'Bienvenida';

export function mount(screen, { navigate }) {
  const data = { name: state.profile?.name ?? '', daily_limit: Number(state.profile?.daily_limit ?? 80000) };
  const steps = ['welcome', 'limit', 'money', 'permissions', ...(isStandalone() ? [] : ['install'])];
  let step = 0;

  const view = () => {
    const s = steps[step];
    const dots = html`<div class="ob-dots" aria-hidden="true">${steps.map((_, i) => html`<span class="${i === step ? 'on' : i < step ? 'done' : ''}"></span>`)}</div>`;
    let body = '';
    let cta = 'Continuar';
    let skip = false;
    if (s === 'welcome') {
      body = html`<div class="ob-hero">${raw(logoSvg({ size: 92, animated: true }))}</div>
        <h1 class="ob-title">Hola, soy ${APP_NAME}.</h1>
        <p class="ob-text">Cuéntame tus gastos como se los contarías a un amigo y yo los organizo. Sin formularios, sin enredos.</p>
        <div class="field mt-8"><label for="ob-name">¿Cómo te llamo?</label>
          <input id="ob-name" class="input" name="name" value="${data.name}" placeholder="Tu nombre" autocomplete="given-name" maxlength="40"></div>`;
      cta = 'Empecemos';
    } else if (s === 'limit') {
      body = html`<div class="ob-icon">${icon('target', { size: 34 })}</div>
        <h1 class="ob-title">¿Cuánto quieres gastar al día?</h1>
        <p class="ob-text">Te aviso cuando vayas en el 80% y si te pasas. Lo puedes cambiar cuando quieras.</p>
        <label class="amount-input big mt-6"><span class="cur">$</span><input name="limit" value="${number(data.daily_limit)}" aria-label="Límite diario"></label>
        <div class="chips center-chips">${[50000, 80000, 100000, 150000].map((v) => html`<button class="chip" data-limit="${v}">${money(v)}</button>`)}</div>`;
    } else if (s === 'money') {
      const items = [...state.cards.map((c) => ({ i: 'card', n: c.name, c: c.color })), ...state.accounts.map((a) => ({ i: a.type === 'cash' ? 'wallet' : 'bank', n: a.name, c: a.color }))];
      body = html`<div class="ob-icon">${icon('card', { size: 34 })}</div>
        <h1 class="ob-title">¿Dónde está tu plata?</h1>
        <p class="ob-text">Agrega tus cuentas y tarjetas para que entienda “lo pagué con la Visa” o “por Nequi”.</p>
        <div class="ob-quick">${['Nequi', 'Bancolombia', 'Daviplata', 'Davivienda'].filter((n) => !state.accounts.some((a) => a.name === n))
          .map((n) => html`<button class="chip" data-quick="${n}">${icon('plus', { size: 14 })}${n}</button>`)}</div>
        <div class="ob-actions">
          <button class="btn btn-secondary" data-add="card">${icon('card')}Agregar tarjeta de crédito</button>
          <button class="btn btn-secondary" data-add="account">${icon('bank')}Agregar otra cuenta</button>
        </div>
        <div class="ob-items">${items.map((it) => html`<span class="tag" style="--c:${it.c}">${icon(it.i, { size: 12 })}${it.n}</span>`)}</div>`;
      skip = true;
    } else if (s === 'permissions') {
      const ps = pushStatus();
      body = html`<div class="ob-icon">${icon('mic', { size: 34 })}</div>
        <h1 class="ob-title">Tu voz y tus avisos</h1>
        <p class="ob-text">Solo te pediré permisos cuando toques cada botón.</p>
        <div class="perm-card card">
          <span class="cat-icon lg" style="--c:#4B3BF5">${icon('mic', { size: 24 })}</span>
          <div class="grow"><div class="row-title">Micrófono</div><div class="row-sub">Para registrar gastos hablando. El audio solo se usa para transcribir.</div></div>
          <button class="btn btn-sm btn-secondary" data-perm="mic">${data.mic ? 'Listo' : 'Permitir'}</button>
        </div>
        <div class="perm-card card">
          <span class="cat-icon lg" style="--c:#12875A">${icon('bell', { size: 24 })}</span>
          <div class="grow"><div class="row-title">Notificaciones</div><div class="row-sub">${ps === 'needs-install'
            ? 'En iPhone, primero instala la app en tu pantalla de inicio. Después las activas en Ajustes.'
            : 'Cortes y pagos de tarjetas, cuotas, suscripciones y alertas de presupuesto.'}</div></div>
          ${ps === 'needs-install' ? html`<button class="btn btn-sm btn-secondary" data-install>Instalar</button>`
            : html`<button class="btn btn-sm btn-secondary" data-perm="push" ${ps === 'unsupported' || ps === 'insecure' ? 'disabled' : ''}>${ps === 'granted' ? 'Listo' : 'Activar'}</button>`}
        </div>`;
      skip = true;
    } else if (s === 'install') {
      body = html`<div class="ob-hero">${raw(logoSvg({ size: 92 }))}</div>
        <h1 class="ob-title">Llévala en tu pantalla de inicio</h1>
        <p class="ob-text">Instalada se siente como una app de verdad: abre al instante, a pantalla completa y con notificaciones.</p>
        <button class="btn btn-secondary btn-block mt-6" data-install>${icon('download')}Instalar ${APP_NAME}</button>`;
      cta = 'Terminar';
      skip = false;
    }
    if (step === steps.length - 1) cta = 'Terminar';
    return html`<div class="scroller onboarding">
      <div class="ob-inner">
        <div class="ob-head">${step > 0 ? html`<button class="icon-btn" data-prev aria-label="Atrás">${icon('chevron-left', { stroke: 2.2 })}</button>` : html`<span style="width:44px"></span>`}${dots}
          ${skip ? html`<button class="btn btn-ghost btn-sm" data-next>Saltar</button>` : html`<span style="width:44px"></span>`}</div>
        <div class="ob-step fade-up" data-step="${s}">${body}</div>
      </div>
      <div class="ob-foot"><button class="btn btn-primary btn-block" data-next><span class="btn-label">${cta}</span><span class="spinner"></span></button></div>
    </div>`;
  };

  let limitInput = null;
  const paint = () => {
    screen.innerHTML = String(view());
    const li = screen.querySelector('input[name="limit"]');
    if (li) { limitInput = bindAmountInput(li, { onChange: (v) => { data.daily_limit = v; } }); }
  };

  const finish = async () => {
    const btn = screen.querySelector('.ob-foot [data-next]');
    const r = await runSave(() => updateProfile({ name: data.name || null, daily_limit: data.daily_limit || 0, onboarded: true }), { button: btn });
    if (r.ok) { haptic.success(); navigate('inicio', { replace: true }); }
  };

  const next = async () => {
    const s = steps[step];
    if (s === 'welcome') data.name = screen.querySelector('input[name="name"]')?.value.trim() ?? '';
    if (s === 'limit') data.daily_limit = limitInput?.value ?? data.daily_limit;
    if (step >= steps.length - 1) return finish();
    step++;
    haptic.tap();
    paint();
  };

  const offs = [
    on(screen, 'click', '[data-next]', next),
    on(screen, 'click', '[data-prev]', () => { step = Math.max(0, step - 1); paint(); }),
    on(screen, 'click', '[data-limit]', (e, b) => { data.daily_limit = Number(b.dataset.limit); if (limitInput) limitInput.value = data.daily_limit; haptic.select(); }),
    on(screen, 'click', '[data-quick]', async (e, b) => {
      b.disabled = true;
      try {
        await createAccount({ name: b.dataset.quick, type: /nequi|daviplata/i.test(b.dataset.quick) ? 'wallet' : 'bank', color: /nequi/i.test(b.dataset.quick) ? '#E5527A' : /davi/i.test(b.dataset.quick) ? '#D9503E' : '#E6B422' });
        haptic.success();
        paint();
      } catch (err) { b.disabled = false; toast(err.message, { type: 'err' }); }
    }),
    on(screen, 'click', '[data-add]', (e, b) => (b.dataset.add === 'card' ? openCardForm() : openAccountForm())),
    on(screen, 'click', '[data-perm="mic"]', async (e, b) => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        data.mic = true;
        b.textContent = 'Listo';
        haptic.success();
      } catch (err) {
        showPermissionHelp('mic', !window.isSecureContext ? 'insecure' : err?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
    }),
    on(screen, 'click', '[data-perm="push"]', async (e, b) => {
      try { await enablePush(); b.textContent = 'Listo'; haptic.success(); } catch (err) {
        if (err.code === 'denied') showPermissionHelp('notifications'); else if (err.code === 'needs-install') maybePromptInstall({ force: true }); else toast(err.message, { type: 'err' });
      }
    }),
    on(screen, 'click', '[data-install]', () => maybePromptInstall({ force: true })),
    subscribe('cards', () => steps[step] === 'money' && paint()),
    subscribe('accounts', () => steps[step] === 'money' && paint()),
  ];
  paint();
  return () => offs.forEach((f) => f());
}
