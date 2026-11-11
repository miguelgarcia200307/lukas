// Cliente de la Edge Function ai-assistant (y send-test-push)
import { sb } from '../supabase.js';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../config.js';
import { AppError } from './base.js';

async function authHeaders() {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('Tu sesión expiró. Vuelve a entrar.', null, 'unauthorized');
  return { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY };
}

async function call(name, body, { timeoutMs = 60000 } = {}) {
  if (!navigator.onLine) throw new AppError('Necesito internet para entenderte. Escríbelo a mano o intenta cuando tengas conexión.', null, 'offline');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = await authHeaders();
    const isForm = body instanceof FormData;
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: isForm ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(data?.error?.message ?? 'No pude procesarlo. Intenta de nuevo.', data, data?.error?.code);
    return data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') throw new AppError('Se demoró demasiado. Intenta de nuevo.', err, 'timeout');
    console.error('[fn]', name, err);
    throw new AppError('No me pude conectar. Revisa tu internet e intenta de nuevo.', err, 'network');
  } finally {
    clearTimeout(t);
  }
}

/** turn: { audio?: Blob, mimeType?, text?, history: [{role, content}] } */
export function askAssistant({ audio, mimeType, duration, text, history = [] }) {
  if (audio) {
    const form = new FormData();
    const ext = /mp4|m4a|aac/.test(mimeType) ? 'm4a' : /ogg/.test(mimeType) ? 'ogg' : 'webm';
    form.append('audio', new File([audio], `voz.${ext}`, { type: (mimeType || audio.type || 'audio/webm').split(';')[0] }));
    form.append('duration', String(Math.max(0.5, Math.round((duration ?? 1) * 10) / 10)));
    form.append('history', JSON.stringify(history));
    return call('ai-assistant', form);
  }
  return call('ai-assistant', { text, history });
}

export const sendTestPush = () => call('send-test-push', {}, { timeoutMs: 20000 });
