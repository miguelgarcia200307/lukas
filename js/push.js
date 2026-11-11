// Web Push: permiso (solo desde un toque), suscripción y registro en push_subscriptions
import { VAPID_PUBLIC_KEY } from './config.js';
import { sb } from './supabase.js';
import { state } from './state.js';
import { AppError } from './api/base.js';
import { isIOS, isStandalone } from './install.js';

const ENDPOINT_KEY = 'lukas-push-endpoint';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'needs-install' | 'insecure' | 'unsupported' | 'denied' | 'granted' | 'default' */
export function pushStatus() {
  if (!window.isSecureContext) return 'insecure';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const storedEndpoint = () => { try { return localStorage.getItem(ENDPOINT_KEY); } catch { return null; } };
const storeEndpoint = (v) => { try { v ? localStorage.setItem(ENDPOINT_KEY, v) : localStorage.removeItem(ENDPOINT_KEY); } catch { /* nada */ } };

async function subscribe(reg) {
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });
}

/** Debe llamarse desde un toque del usuario */
export async function enablePush() {
  const status = pushStatus();
  if (status === 'needs-install') throw new AppError('En iPhone primero instala la app en tu pantalla de inicio; luego activa las notificaciones desde ahí.', null, 'needs-install');
  if (status === 'insecure') throw new AppError('Las notificaciones necesitan que la app se abra con https://.', null, 'insecure');
  if (status === 'unsupported') throw new AppError('Este navegador no soporta notificaciones push.', null, 'unsupported');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new AppError('Las notificaciones están bloqueadas. Actívalas en los ajustes del dispositivo.', null, 'denied');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await subscribe(reg));
  await saveSubscription(sub);
  return sub;
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: state.session.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
    last_used_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw new AppError('No se pudo guardar la suscripción de notificaciones.', error);
  // Si la suscripción cambió (rotó o expiró), se borra la anterior del servidor
  const old = storedEndpoint();
  if (old && old !== json.endpoint) await sb.from('push_subscriptions').delete().eq('endpoint', old);
  storeEndpoint(json.endpoint);
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
  storeEndpoint(null);
}

/**
 * Al abrir la app (y cuando el service worker avisa de pushsubscriptionchange): si hay permiso concedido,
 * vuelve a suscribir si la suscripción expiró y guarda la actual. Nunca pide permisos.
 */
export async function syncPushSubscription() {
  try {
    if (!state.session || pushStatus() !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && storedEndpoint()) sub = await subscribe(reg); // expiró: el permiso sigue concedido
    if (sub) await saveSubscription(sub);
    return !!sub;
  } catch (e) {
    console.warn('[push] no se pudo sincronizar', e);
    return false;
  }
}

export async function hasPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}
