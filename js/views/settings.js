// Ajustes: perfil, límite, recordatorios, notificaciones, voz, cuenta por defecto, instalación, exportar, sesión
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { haptic } from '../utils/haptics.js';
import { APP_NAME, APP_VERSION } from '../config.js';
import { sb } from '../supabase.js';
import { state, subscribe } from '../state.js';
import { updateProfile } from '../api/profile.js';
import { sendTestPush, aiUsage } from '../api/ai.js';
import { topbar, bindTopbar } from '../ui/common.js';
import { formSheet } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { enablePush, disablePush, pushStatus, hasPushSubscription, syncPushSubscription } from '../push.js';
import { isStandalone, maybePromptInstall } from '../install.js';
import { micStatus, showPermissionHelp } from '../permissions.js';
import { exportTransactionsCSV, exportAllJSON } from '../utils/export.js';
import { unlockVoice, speak, stopSpeaking, playTestTone, loadVoices, spanishVoices, pickVoice, hasGoodSpanish, voicePrefs, setVoicePrefs, isIOS, canSpeak } from '../voice/speech.js';
import { testLine } from '../voice/talk.js';

const rateLabel = (r) => `${Number(r).toFixed(2).replace(/0$/, '').replace('.', ',')}×`;

export const title = 'Ajustes';

const NOTIF_TYPES = [
  ['card_cut', 'Corte de tarjetas', '1 día antes y el mismo día'],
  ['card_due', 'Pago de tarjetas', '3 días, 1 día antes y el mismo día'],
  ['debts', 'Cuotas de créditos', '1 día antes y el mismo día'],
  ['subscriptions', 'Suscripciones', '1 día antes del cobro'],
  ['budget', 'Alertas de presupuesto', 'Al 80%, al 100% y si te pasas'],
  ['weekly_summary', 'Resumen semanal', 'Domingos a las 7:00 p. m.'],
  ['no_activity', 'Recordatorio nocturno', 'A las 9:00 p. m. si no registraste nada'],
];

const sw = (name, checked, attrs = '') => html`<span class="switch"><input type="checkbox" data-${attrs || 'pref'}="${name}" ${checked ? 'checked' : ''} aria-label="${name}"><span class="track"></span></span>`;

export function mount(screen) {
  let pushOn = false;
  let mic = 'prompt';
  let usage; // Uso de IA de hoy (undefined = cargando, null = no disponible)
  const render = () => {
    const p = state.profile ?? {};
    const prefs = p.notification_prefs ?? {};
    const ps = pushStatus();
    const def = state.accounts.find((a) => a.id === p.default_account_id);
    const vp = voicePrefs();
    screen.querySelector('.set-body').innerHTML = String(html`
      <div class="eyebrow mb-2">Perfil</div>
      <div class="list">
        <button class="list-row tappable" data-edit="name"><span class="cat-icon" style="--c:#4B3BF5">${icon('user', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Nombre</div><div class="row-sub">${p.name || 'Sin nombre'}</div></div>${icon('chevron-right', { size: 18, cls: 'chev' })}</button>
        <button class="list-row tappable" data-edit="limit"><span class="cat-icon" style="--c:#E6B422">${icon('target', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Límite diario</div><div class="row-sub">${Number(p.daily_limit) ? money(p.daily_limit) : 'Desactivado'}</div></div>${icon('chevron-right', { size: 18, cls: 'chev' })}</button>
        <button class="list-row tappable" data-edit="account"><span class="cat-icon" style="--c:#3FA672">${icon('wallet', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Cuenta por defecto</div><div class="row-sub">${def?.name ?? 'Elegir'}</div></div>${icon('chevron-right', { size: 18, cls: 'chev' })}</button>
      </div>

      <div class="eyebrow mt-8 mb-2">Notificaciones</div>
      <div class="list">
        <div class="list-row"><span class="cat-icon" style="--c:#F08A4B">${icon('bell', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Notificaciones push</div><div class="row-sub">${
            ps === 'needs-install' ? 'En iPhone primero instala la app (Compartir → Agregar a inicio)'
            : ps === 'insecure' ? 'Requieren abrir la app con https://'
            : ps === 'unsupported' ? 'No disponibles en este navegador'
            : ps === 'denied' ? 'Bloqueadas: toca “Cómo activarlas”'
            : pushOn ? 'Permitidas y activas en este dispositivo'
            : ps === 'granted' ? 'Permitidas, pero desactivadas aquí' : 'Aún no las has activado'}</div></div>
          ${ps === 'needs-install' ? html`<button class="btn btn-sm btn-secondary" data-install>Instalar</button>`
            : ps === 'denied' ? html`<button class="btn btn-sm btn-secondary" data-help="notifications">Cómo activarlas</button>`
            : ps === 'unsupported' || ps === 'insecure' ? '' : sw('push', pushOn, 'push')}
        </div>
        ${pushOn ? html`<button class="list-row tappable" data-test-push><span class="cat-icon" style="--c:#12875A">${icon('sparkles', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Enviar notificación de prueba</div></div>${icon('chevron-right', { size: 18, cls: 'chev' })}</button>` : ''}
        <label class="list-row"><span class="cat-icon" style="--c:#2FB3A6">${icon('clock', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Hora de recordatorios</div><div class="row-sub">Cortes, pagos y cuotas</div></div>
          <input class="input time-input" type="time" step="3600" data-reminder value="${String(p.reminder_time ?? '08:00').slice(0, 5)}" aria-label="Hora de recordatorios"></label>
        ${NOTIF_TYPES.map(([k, t, d]) => html`<label class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">${t}</div><div class="row-sub">${d}</div></div>${sw(k, prefs[k] !== false)}</label>`)}
      </div>

      <div class="eyebrow mt-8 mb-2">Asistente</div>
      <div class="list">
        <div class="list-row"><span class="cat-icon" style="--c:#4B3BF5">${icon('mic', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Micrófono</div><div class="row-sub">${{
            granted: 'Permitido', denied: 'Bloqueado', prompt: 'Se pedirá la primera vez que toques el orbe',
            unavailable: 'No disponible en este navegador', insecure: 'Requiere abrir la app con https://' }[mic] ?? 'Se pedirá al usarlo'}</div></div>
          ${mic === 'denied' || mic === 'insecure' ? html`<button class="btn btn-sm btn-secondary" data-help="mic">Cómo activarlo</button>` : ''}</div>
        <label class="list-row"><span class="cat-icon" style="--c:#A65BE0">${icon('mic', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Respuesta hablada</div><div class="row-sub">${canSpeak() ? `${APP_NAME} te responde en voz alta` : 'Este navegador no permite voz'}</div></div>
          ${sw('voice_reply', p.voice_reply, 'voice')}</label>
        ${p.voice_reply && canSpeak() ? html`
          <label class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">Voz</div><div class="row-sub ellipsis" data-voice-note>Cargando voces…</div></div>
            <select class="input voice-select" data-voice-uri aria-label="Voz de ${APP_NAME}"><option value="">Automática</option></select></label>
          <label class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">Velocidad</div><div class="row-sub" data-rate-label>${rateLabel(vp.rate)}</div></div>
            <input type="range" class="voice-rate" min="0.8" max="1.3" step="0.05" value="${vp.rate}" data-voice-rate aria-label="Velocidad de la voz"></label>
          <div class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">Probar voz</div>
              <div class="row-sub">${isIOS() ? 'Si no suena, quita el modo silencio y sube el volumen' : `Escucha cómo suena ${APP_NAME}`}</div></div>
            <button type="button" class="btn btn-accent btn-sm voice-test" data-voice-test>${icon('sparkles', { size: 16 })}<span>Probar</span></button></div>
          <div class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">¿No se oye la voz?</div>
              <div class="row-sub">Prueba un pitido: si suena, el problema es la voz; si no, el volumen o el modo silencio</div></div>
            <button type="button" class="btn btn-secondary btn-sm voice-test" data-tone-test>${icon('bell', { size: 16 })}<span>Tono</span></button></div>
          <label class="list-row"><span class="cat-icon" style="--c:#12875A">${icon('repeat', { size: 20 })}</span>
            <div class="grow"><div class="row-title">Manos libres</div><div class="row-sub">Si ${APP_NAME} te pregunta algo, te vuelve a escuchar solo</div></div>
            ${sw('handsfree', vp.handsfree !== false, 'handsfree')}</label>
          <div class="voice-help" data-voice-help hidden></div>` : ''}
        <label class="list-row"><span class="cat-icon" style="--c:#2FB3A6">${icon('send', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Enviar al hacer una pausa</div><div class="row-sub">Envía el audio tras 1,5 s de silencio</div></div>
          ${sw('voice_autosend', p.voice_autosend !== false, 'autosend')}</label>
      </div>

      <div class="eyebrow mt-8 mb-2">Uso de IA</div>
      <div class="list ai-usage">
        <div class="list-row"><span class="cat-icon" style="--c:#4B3BF5">${icon('sparkles', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Hoy</div>
            <div class="row-sub">${usage ? `${usage.audio_today} ${usage.audio_today === 1 ? 'audio' : 'audios'} · ${usage.text_today} por texto` : usage === null ? 'No disponible por ahora' : 'Cargando…'}</div>
            ${usage ? html`<div class="usage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usage.pct}" aria-label="Cuota personal usada"><span style="width:${Math.max(2, usage.pct)}%" class="${usage.pct >= 90 ? 'hot' : usage.pct >= 70 ? 'warm' : ''}"></span></div>` : ''}</div>
          ${usage ? html`<div class="usage-pct num">${usage.pct}%</div>` : ''}</div>
        ${usage ? html`<div class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">Cuota personal</div>
            <div class="row-sub">${usage.used_today} de ${usage.quota_day} solicitudes al día</div></div></div>
          <div class="list-row"><div class="grow" style="padding-left:52px"><div class="row-title">Modelo activo</div>
            <div class="row-sub">${usage.model?.replace('openai/', '') ?? '—'}${usage.model !== usage.last_model && usage.last_model ? ` · último usado: ${usage.last_model.replace('openai/', '')}` : ''} · voz: ${usage.stt_model ?? '—'}</div></div></div>` : ''}
      </div>

      <div class="eyebrow mt-8 mb-2">App y datos</div>
      <div class="list">
        ${isStandalone() ? '' : html`<button class="list-row tappable" data-install><span class="cat-icon" style="--c:#4B3BF5">${icon('download', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Instalar ${APP_NAME}</div><div class="row-sub">En tu pantalla de inicio</div></div>${icon('chevron-right', { size: 18, cls: 'chev' })}</button>`}
        <button class="list-row tappable" data-export="csv"><span class="cat-icon" style="--c:#3D8BE0">${icon('list', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Exportar movimientos (CSV)</div><div class="row-sub">Para Excel o Google Sheets</div></div>${icon('download', { size: 18, cls: 'chev' })}</button>
        <button class="list-row tappable" data-export="json"><span class="cat-icon" style="--c:#6B7280">${icon('layers', { size: 20 })}</span>
          <div class="grow"><div class="row-title">Respaldo completo (JSON)</div><div class="row-sub">Todos tus datos</div></div>${icon('download', { size: 18, cls: 'chev' })}</button>
      </div>

      <button class="btn btn-danger btn-block mt-8" data-logout>${icon('logout')}Cerrar sesión</button>
      <div class="center mt-6"><button class="btn btn-ghost btn-sm" data-check-update>${icon('refresh', { size: 16 })}Buscar actualización</button></div>
      <p class="center muted xsmall mt-2">${APP_NAME} versión ${APP_VERSION} · ${state.session?.user?.email ?? ''}</p>`);
    fillVoices();
  };

  /** "Probar voz": habla dentro del mismo toque y muestra si de verdad sonó (o por qué pudo no sonar) */
  const testVoice = async (b) => {
    if (b.classList.contains('playing')) { stopSpeaking(); return; } // segundo toque: detener
    haptic.tap();
    if (!canSpeak()) { toast('Este navegador no permite voz.', { type: 'err' }); return; }
    const label = b.querySelector('span');
    b.classList.add('playing');
    label.textContent = 'Preparando…';
    let started = false;
    const result = await speak(testLine(), { onstart: () => { started = true; label.textContent = 'Hablando… · Parar'; } });
    b.classList.remove('playing');
    label.textContent = 'Probar';
    if (result === 'interrupted') return;
    if (!started) {
      toast(isIOS() ? 'El iPhone no reprodujo la voz. Quita el modo silencio, sube el volumen y prueba otra voz.' : 'No se pudo reproducir la voz. Prueba otra voz o sube el volumen.', { type: 'err', duration: 6500 });
    }
  };

  /** Voces en español disponibles en este dispositivo (cargan tarde) y ayuda si no hay una buena */
  const fillVoices = async () => {
    const sel = screen.querySelector('[data-voice-uri]');
    if (!sel) return;
    const voices = await loadVoices(3000);
    if (!sel.isConnected) return;
    const es = spanishVoices(voices);
    const chosen = pickVoice(voices);
    const uri = voicePrefs().voiceURI;
    sel.innerHTML = String(html`<option value="">Automática${es[0] ? ` (${es[0].name})` : ''}</option>
      ${es.map((v) => html`<option value="${v.voiceURI}" ${v.voiceURI === uri ? 'selected' : ''}>${v.name} · ${v.lang}</option>`)}`);
    const note = screen.querySelector('[data-voice-note]');
    if (note) note.textContent = chosen ? `Usando ${chosen.name} (${chosen.lang})` : 'No hay voces en español en este dispositivo';
    const help = screen.querySelector('[data-voice-help]');
    if (!help) return;
    const needHelp = !es.length || (isIOS() && !hasGoodSpanish(voices));
    help.hidden = !needHelp;
    help.innerHTML = !needHelp ? '' : String(isIOS()
      ? html`<b>Consigue una voz más natural en el iPhone</b><ol>
          <li>Abre <b>Ajustes</b> → <b>Accesibilidad</b> → <b>Contenido leído y hablado</b> → <b>Voces</b>.</li>
          <li>Entra a <b>Español</b> y elige una voz como <b>Paulina</b> (México) o <b>Mónica</b> (España).</li>
          <li>Descarga la versión <b>Mejorada</b> o <b>Premium</b> (pesa unos MB).</li>
          <li>Cierra ${APP_NAME} del todo y vuelve a abrirla; elígela aquí arriba.</li></ol>`
      : html`<b>Tu dispositivo no tiene voces en español</b><ol>
          <li>En Android: <b>Ajustes</b> → <b>Sistema</b> → <b>Idioma</b> → <b>Salida de texto a voz</b>.</li>
          <li>En el motor de Google, instala los datos de voz de <b>Español</b>.</li>
          <li>Vuelve a abrir ${APP_NAME}.</li></ol>`);
  };

  screen.innerHTML = String(html`${topbar({ title: 'Ajustes', back: true })}<div class="scroller"><div class="content"><div class="set-body"></div></div></div>`);

  const savePrefs = async (patch) => {
    try { await updateProfile(patch); haptic.select(); } catch (err) { toast(err.message, { type: 'err' }); render(); }
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'change', '[data-pref]', (e, inp) => savePrefs({ notification_prefs: { ...(state.profile.notification_prefs ?? {}), [inp.dataset.pref]: inp.checked } })),
    on(screen, 'change', '[data-voice]', (e, inp) => {
      if (inp.checked) { unlockVoice(); speak('Listo, ahora te respondo en voz alta.'); } else stopSpeaking(); // dentro del toque: desbloquea la voz en iOS
      savePrefs({ voice_reply: inp.checked });
    }),
    on(screen, 'change', '[data-voice-uri]', (e, sel) => { unlockVoice(); setVoicePrefs({ voiceURI: sel.value }); fillVoices(); speak(testLine()); }),
    on(screen, 'input', '[data-voice-rate]', (e, inp) => { const l = screen.querySelector('[data-rate-label]'); if (l) l.textContent = rateLabel(inp.value); }),
    on(screen, 'change', '[data-voice-rate]', (e, inp) => { unlockVoice(); setVoicePrefs({ rate: Number(inp.value) }); speak(testLine()); }),
    on(screen, 'click', '[data-voice-test]', (e, b) => testVoice(b)),
    on(screen, 'click', '[data-tone-test]', async () => {
      haptic.tap();
      if (!(await playTestTone())) toast('El teléfono no dejó reproducir el sonido.', { type: 'err' });
    }),
    on(screen, 'change', '[data-handsfree]', (e, inp) => { setVoicePrefs({ handsfree: inp.checked }); haptic.select(); }),
    on(screen, 'change', '[data-autosend]', (e, inp) => savePrefs({ voice_autosend: inp.checked })),
    on(screen, 'change', '[data-reminder]', (e, inp) => inp.value && savePrefs({ reminder_time: `${inp.value.slice(0, 2)}:00` })),
    on(screen, 'change', '[data-push]', async (e, inp) => {
      try {
        if (inp.checked) { await enablePush(); toast('Notificaciones activadas'); } else { await disablePush(); toast('Notificaciones desactivadas', { type: 'info' }); }
      } catch (err) {
        if (err.code === 'denied') showPermissionHelp('notifications');
        else if (err.code === 'needs-install') maybePromptInstall({ force: true });
        else toast(err.message, { type: 'err' });
      }
      pushOn = await hasPushSubscription();
      render();
    }),
    on(screen, 'click', '[data-test-push]', async () => {
      try { await sendTestPush(); toast('Enviada. Debería llegarte en unos segundos.'); } catch (err) { toast(err.message, { type: 'err' }); }
    }),
    on(screen, 'click', '[data-install]', () => maybePromptInstall({ force: true })),
    on(screen, 'click', '[data-check-update]', async (e, b) => {
      b.disabled = true;
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) { location.reload(); return; }
        await reg.update();
        const w = reg.installing || reg.waiting;
        if (w) { toast('Descargando la versión nueva…', { type: 'info' }); w.postMessage({ type: 'SKIP_WAITING' }); } // al activarse, la app se recarga sola
        else toast(`Ya tienes la última versión (${APP_VERSION})`, { type: 'info' });
      } catch { toast('No pude revisar. Revisa tu conexión.', { type: 'err' }); }
      b.disabled = false;
    }),
    on(screen, 'click', '[data-help]', (e, b) => showPermissionHelp(b.dataset.help, b.dataset.help === 'mic' && mic === 'insecure' ? 'insecure' : 'denied')),
    on(screen, 'click', '[data-export]', async (e, b) => {
      try {
        if (b.dataset.export === 'csv') { const n = await exportTransactionsCSV(); toast(`${n} movimientos exportados`); }
        else { await exportAllJSON(); toast('Respaldo descargado'); }
      } catch (err) { toast(err.message, { type: 'err' }); }
    }),
    on(screen, 'click', '[data-edit]', (e, b) => {
      const k = b.dataset.edit;
      if (k === 'name') formSheet({ title: 'Tu nombre', fields: [{ name: 'name', label: 'Nombre', value: state.profile?.name, required: true }], onSubmit: (v) => updateProfile({ name: v.name }) });
      if (k === 'limit') formSheet({ title: 'Límite diario', fields: [{ name: 'daily_limit', label: 'Puedo gastar al día', type: 'amount', value: state.profile?.daily_limit, hint: '0 para desactivarlo' }], onSubmit: (v) => updateProfile({ daily_limit: v.daily_limit || 0 }) });
      if (k === 'account') formSheet({ title: 'Cuenta por defecto', intro: 'Se usa cuando no dices con qué pagaste.', fields: [{ name: 'default_account_id', label: 'Cuenta', type: 'select', value: state.profile?.default_account_id, options: state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name })) }], onSubmit: (v) => updateProfile({ default_account_id: v.default_account_id }) });
    }),
    on(screen, 'click', '[data-logout]', async () => {
      if (!(await confirmDialog({ title: '¿Cerrar sesión?', message: 'Tendrás que entrar de nuevo con tu correo y contraseña.', confirm: 'Cerrar sesión', danger: true }))) return;
      await disablePush().catch(() => {});
      await sb.auth.signOut();
    }),
    subscribe('profile', render),
    subscribe('accounts', render),
  ];
  render();
  hasPushSubscription().then((v) => { pushOn = v; render(); if (v) syncPushSubscription(); });
  micStatus().then((v) => { mic = v; render(); });
  aiUsage().then((u) => { usage = u?.quota_day ? u : null; render(); }).catch(() => { usage = null; render(); });
  return () => { stopSpeaking(); offs.forEach((f) => f()); };
}
