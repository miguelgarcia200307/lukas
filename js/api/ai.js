// Cliente de la Edge Function ai-assistant (streaming SSE) y send-test-push
import { sb } from '../supabase.js';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../config.js';
import { AppError, rpc } from './base.js';

async function authHeaders() {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('Tu sesión expiró. Vuelve a entrar.', null, 'unauthorized');
  return { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY };
}

const offlineError = () => new AppError('Necesito internet para entenderte. Escríbelo a mano o intenta cuando tengas conexión.', null, 'offline');

async function call(name, body, { timeoutMs = 30000 } = {}) {
  if (!navigator.onLine) throw offlineError();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(data?.error?.message ?? 'No pude procesarlo. Intenta de nuevo.', data, data?.error?.code);
    return data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') throw new AppError('Se demoró demasiado. Intenta de nuevo.', err, 'timeout');
    throw new AppError('No me pude conectar. Revisa tu internet e intenta de nuevo.', err, 'network');
  } finally {
    clearTimeout(t);
  }
}

let lastPing = 0;
/** Pre-calentamiento al tocar el orbe: despierta la función, la JWKS y el contexto del usuario (no consume cuota). */
export function pingAssistant() {
  if (!navigator.onLine || Date.now() - lastPing < 20000) return;
  lastPing = Date.now();
  authHeaders().then((h) => fetch(`${FUNCTIONS_URL}/ai-assistant`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{"ping":true}', keepalive: true,
  })).catch(() => {});
}

/**
 * Turno del asistente con respuesta en streaming.
 * onEvent(event, data): 'sent' (subida terminada) · 'transcript' · 'proposal' · 'question' · 'reply' · 'done'
 * Resuelve con el evento 'done'. turn: { audio?: Blob, mimeType?, duration?, text?, state? }
 */
export async function streamAssistant({ audio, mimeType, duration, text, state, onEvent, signal }) {
  if (!navigator.onLine) throw offlineError();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  signal?.addEventListener('abort', () => ctrl.abort());
  let body, headers = await authHeaders();
  if (audio) {
    body = new FormData();
    const type = (mimeType || audio.type || 'audio/webm').split(';')[0];
    const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
    body.append('audio', new File([audio], `voz.${ext}`, { type }));
    body.append('duration', String(Math.max(0.5, Math.round((duration ?? 1) * 10) / 10)));
    if (state) body.append('state', state);
  } else {
    headers = { ...headers, 'Content-Type': 'application/json' };
    body = JSON.stringify({ text, ...(state ? { state } : {}) });
  }
  try {
    const res = await fetch(`${FUNCTIONS_URL}/ai-assistant`, { method: 'POST', headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new AppError(data?.error?.message ?? 'No pude procesarlo. Intenta de nuevo.', data, data?.error?.code);
    }
    onEvent?.('sent', {});
    // Compatibilidad: una versión anterior de la función responde un solo JSON (sin streaming)
    if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const j = await res.json();
      onEvent?.('transcript', { text: j.transcript ?? text ?? '' });
      for (const p of j.proposals ?? []) onEvent?.('proposal', p);
      const question = j.needs_clarification ? j.question : null;
      if (question) onEvent?.('question', { text: question });
      const done = { intent: j.intent, reply: j.reply, question, query: j.query ?? null, state: null };
      onEvent?.('done', done);
      return done;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', done = null;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        const payload = JSON.parse(data);
        if (event === 'error') throw new AppError(payload.message ?? 'No pude entenderte. Intenta de nuevo o escríbelo.', payload, payload.code);
        if (event === 'done') done = payload;
        onEvent?.(event, payload);
      }
    }
    if (!done) throw new AppError('Se cortó la conexión. Intenta de nuevo.', null, 'network');
    return done;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') throw new AppError('Se demoró demasiado. Intenta de nuevo o escríbelo.', err, 'timeout');
    throw new AppError('No me pude conectar. Revisa tu internet e intenta de nuevo.', err, 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Uso de IA de hoy (para Ajustes) */
export const aiUsage = () => call('ai-assistant', { usage: true }, { timeoutMs: 15000 });

/** Memoria de categorización: palabra clave → categoría confirmada por el usuario (no bloquea) */
export function learnCategoryHints(rows) {
  if (!rows?.length) return;
  rpc('learn_category_hints', { p_rows: rows }).catch((e) => console.warn('[hints]', e?.message));
}

export const sendTestPush = () => call('send-test-push', {}, { timeoutMs: 20000 });
