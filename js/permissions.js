// Permisos de la PWA: estado del micrófono y ayudas para reactivar permisos en iOS y Android.
// Nunca se pide un permiso aquí: solo se consulta el estado y se explica cómo cambiarlo.
import { APP_NAME } from './config.js';
import { html } from './utils/dom.js';
import { icon } from './utils/icons.js';
import { openSheet } from './ui/sheet.js';
import { isIOS, isStandalone } from './install.js';

const isAndroid = () => /android/i.test(navigator.userAgent);
const secureContext = () => window.isSecureContext === true;

/** 'granted' | 'denied' | 'prompt' | 'unavailable' | 'insecure' */
export async function micStatus() {
  if (!secureContext()) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'unavailable';
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' });
    if (p?.state) return p.state;
  } catch { /* Safari antiguo no soporta consultar el micrófono */ }
  return 'prompt';
}

const STEPS = {
  mic: {
    ios: () => isStandalone()
      ? [`Abre <b>Ajustes</b> del iPhone`, `Entra a <b>Apps → Safari → Micrófono</b> (o <b>Safari → Micrófono</b> en iOS 17)`, `Elige <b>Preguntar</b> o <b>Permitir</b>`, `Cierra ${APP_NAME} por completo y vuelve a abrirla`]
      : [`En Safari toca <b>aA</b> junto a la dirección`, `Entra a <b>Configuración del sitio web</b>`, `En <b>Micrófono</b> elige <b>Permitir</b>`, `Recarga la página`],
    android: () => isStandalone()
      ? [`Mantén presionado el ícono de ${APP_NAME}`, `Toca <b>Información de la app → Permisos</b>`, `En <b>Micrófono</b> elige <b>Permitir solo mientras se usa</b>`]
      : [`Toca el ícono de <b>ajustes del sitio</b> junto a la dirección en Chrome`, `Entra a <b>Permisos → Micrófono</b>`, `Elige <b>Permitir</b> y recarga`],
    other: () => [`Abre la configuración del sitio en tu navegador`, `Permite el <b>Micrófono</b> para esta página`, `Recarga la página`],
  },
  notifications: {
    ios: () => [`Abre <b>Ajustes</b> del iPhone`, `Entra a <b>Notificaciones → ${APP_NAME}</b>`, `Activa <b>Permitir notificaciones</b>`],
    android: () => isStandalone()
      ? [`Mantén presionado el ícono de ${APP_NAME}`, `Toca <b>Información de la app → Notificaciones</b>`, `Actívalas`]
      : [`Toca el ícono de <b>ajustes del sitio</b> junto a la dirección`, `Entra a <b>Permisos → Notificaciones</b>`, `Elige <b>Permitir</b>`],
    other: () => [`Abre la configuración del sitio en tu navegador`, `Permite las <b>Notificaciones</b>`, `Recarga la página`],
  },
};

/** Sheet con instrucciones paso a paso para reactivar un permiso bloqueado. kind: 'mic' | 'notifications' */
export function showPermissionHelp(kind, reason = 'denied') {
  const platform = isIOS() ? 'ios' : isAndroid() ? 'android' : 'other';
  const title = kind === 'mic' ? 'Activa el micrófono' : 'Activa las notificaciones';
  const intro = reason === 'insecure'
    ? `${APP_NAME} necesita abrirse con <b>https://</b> para usar el micrófono y las notificaciones. Ábrela desde su enlace seguro.`
    : reason === 'unavailable'
      ? (kind === 'mic' ? 'Este navegador no permite grabar audio. Puedes escribir lo que gastaste en el campo de texto.' : 'Este navegador no soporta notificaciones push.')
      : kind === 'mic'
        ? 'El permiso del micrófono está bloqueado. Así lo vuelves a activar:'
        : 'Las notificaciones están bloqueadas. Así las vuelves a activar:';
  const steps = reason === 'denied' ? STEPS[kind][platform]() : [];
  openSheet({
    title,
    detent: 'medium',
    body: html`<div class="perm-help">
      <span class="cat-icon lg" style="--c:${kind === 'mic' ? '#4B3BF5' : '#F08A4B'}">${icon(kind === 'mic' ? 'mic' : 'bell', { size: 24 })}</span>
      <p class="muted mt-3" data-html></p>
      ${steps.length ? html`<ol class="ios-steps">${steps.map((s, i) => html`<li style="--i:${i}"><span class="step-n">${i + 1}</span><div data-step="${i}"></div></li>`)}</ol>` : ''}
    </div>`,
    footer: html`<button class="btn btn-secondary btn-block" data-sheet-close>Entendido</button>`,
  }).body.querySelectorAll('[data-html], [data-step]').forEach((el) => {
    // Textos propios (sin datos del usuario): se insertan con formato
    el.innerHTML = el.hasAttribute('data-html') ? intro : steps[Number(el.dataset.step)];
  });
}
