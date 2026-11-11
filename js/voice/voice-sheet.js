// Flujo de voz: grabar → enviar → transcripción → propuestas en streaming (editables) / pregunta de aclaración → confirmar
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { money } from '../utils/format.js';
import { MAX_RECORDING_SECONDS } from '../config.js';
import { state } from '../state.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { streamAssistant, pingAssistant } from '../api/ai.js';
import { Recorder, canRecord } from './recorder.js';
import { Orb } from './orb.js';
import { renderProposals, renderOne, bindProposals, pendingProposals, saveProposals, validateProposal, summarize, missingAmount } from './proposals.js';
import { catIcon } from '../ui/common.js';
import { showPermissionHelp } from '../permissions.js';

const RECORD_INTENTS = ['create_transactions', 'card_payment', 'debt_payment', 'add_subscription', 'goal_contribution'];
export const SUGGESTIONS = ['Almorcé por 18 lucas', 'Recibí 200 mil de una venta', 'Tanqueé 80 mil con la tarjeta', '¿Cuánto llevo este mes?'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** "8 lucas", "$12.500", "15 mil" escrito como respuesta a una tarjeta pendiente → monto (sin llamar a la IA) */
function typedAmount(text) {
  const m = /^\s*(?:me\s+cost[oó]|cost[oó]|fueron|fue|son|vale|valió)?\s*\$?\s*(\d[\d.,]*)\s*(mil|lucas?|k|barras?)?\s*(?:pesos)?\s*\.?\s*$/i.exec(text);
  if (!m) return 0;
  let n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  if (m[2] && n < 1000) n *= 1000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

let active = null;

/** openVoice({ autoStart, text, hold }) — hold: grabar mientras se mantenga presionado (soltar envía) */
export function openVoice(opts = {}) {
  if (active && !active.sheet.closed) { active.sheet.expand(); return active; }
  active = new VoiceSession(opts);
  return active;
}

class VoiceSession {
  constructor({ autoStart = false, text = '', hold = false } = {}) {
    this.convState = null; // estado compacto del turno anterior (lo devuelve la función)
    this.proposals = [];
    this.transcript = '';
    this.phase = 'idle';
    this.chain = Promise.resolve(); // las tarjetas aparecen escalonadas aunque lleguen juntas
    this.answerTarget = null; // tarjeta pendiente que se está respondiendo por voz
    this.sheet = openSheet({
      className: 'voice-sheet',
      body: html`<div class="voice">
        <div class="voice-stage">
          <div class="orb-wrap"><canvas class="orb-canvas" aria-hidden="true"></canvas>
            <button class="orb-hit" aria-label="Tocar para hablar"></button></div>
          <div class="voice-status" aria-live="polite">
            <div class="vs-title">Cuéntame qué gastaste</div>
            <div class="vs-sub muted">Toca el orbe para hablar · mantenlo presionado si prefieres</div>
          </div>
          <div class="rec-controls" hidden>
            <button class="icon-btn filled" data-act="cancel" aria-label="Cancelar grabación">${icon('x')}</button>
            <div class="rec-timer num">0:00</div>
            <button class="rec-send" data-act="send" aria-label="Enviar">${icon('arrow-up', { stroke: 2.4 })}</button>
          </div>
        </div>
        <div class="voice-result" hidden></div>
        <div class="chips voice-suggest scroll">${SUGGESTIONS.map((s) => html`<button class="chip suggest" data-suggest="${s}">${s}</button>`)}</div>
      </div>`,
      footer: html`<form class="composer" autocomplete="off">
          <input class="input" name="q" placeholder="O escríbelo aquí…" aria-label="Escribe lo que gastaste" enterkeyhint="send" maxlength="500">
          <button class="composer-send" type="submit" aria-label="Enviar">${icon('send', { stroke: 2.4 })}</button>
        </form>`,
      onClose: () => this.destroy(),
    });
    const root = this.sheet.el;
    this.root = root;
    this.orb = new Orb(root.querySelector('.orb-canvas'));
    this.status = root.querySelector('.voice-status');
    this.result = root.querySelector('.voice-result');
    this.stage = root.querySelector('.voice-stage');
    this.controls = root.querySelector('.rec-controls');
    this.timerEl = root.querySelector('.rec-timer');
    this.form = root.querySelector('.composer');
    this.input = this.form.querySelector('input');

    this.bind();
    pingAssistant(); // el usuario está por hablar: despierta la función y su contexto
    if (text) this.sendText(text);
    else if (autoStart) this.startRecording({ hold });
  }

  bind() {
    const hit = this.root.querySelector('.orb-hit');
    let pressT = 0, holdTimer = null, holding = false;
    hit.addEventListener('pointerdown', () => {
      if (this.phase !== 'idle' && this.phase !== 'result') return;
      pingAssistant();
      pressT = performance.now();
      holdTimer = setTimeout(() => { holding = true; this.startRecording({ hold: true }); }, 320);
    });
    const release = () => {
      clearTimeout(holdTimer);
      if (holding) { holding = false; if (this.phase === 'recording') this.stopAndSend(); return; }
      if (!pressT) return;
      pressT = 0;
      if (this.phase === 'recording') this.stopAndSend();
      else if (this.phase === 'idle' || this.phase === 'result') this.startRecording();
    };
    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointercancel', () => { clearTimeout(holdTimer); pressT = 0; });
    hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressT = 1; release(); } });

    on(this.root, 'click', '[data-act="cancel"]', () => this.cancelRecording());
    on(this.root, 'click', '[data-act="send"]', () => this.stopAndSend());
    on(this.root, 'click', '[data-suggest]', (e, b) => this.sendText(b.dataset.suggest));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = this.input.value.trim();
      if (!v) return;
      this.input.value = '';
      this.input.blur();
      // Una sola tarjeta pendiente y escribió solo un monto: se completa aquí mismo
      const pend = this.proposals.filter(missingAmount);
      const n = pend.length === 1 ? typedAmount(v) : 0;
      if (n && this.unbindProposals?.complete) { this.unbindProposals.complete(pend[0], n); return; }
      this.sendText(v);
    });
    on(this.root, 'click', '[data-act="confirm-all"]', () => this.confirm());
    on(this.root, 'click', '[data-act="mic-answer"]', () => this.startRecording());
    on(this.root, 'click', '[data-act="restart"]', () => this.reset());
    on(this.root, 'click', '[data-act="retry"]', () => { if (this.lastFailed && this.phase !== 'thinking') this.ask(this.lastFailed); });
    on(this.root, 'click', '[data-act="type-instead"]', () => this.input.focus());
    on(this.root, 'click', '[data-act="resend-transcript"]', () => {
      const v = this.root.querySelector('.transcript-input')?.value.trim();
      if (v) { this.convState = null; this.sendText(v); }
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.target.classList?.contains('transcript-input') && e.key === 'Enter') { e.preventDefault(); this.root.querySelector('[data-act="resend-transcript"]')?.click(); }
    });
  }

  setStatus(title, sub = '') {
    this.status.innerHTML = String(html`<div class="vs-title">${title}</div>${sub ? html`<div class="vs-sub muted">${sub}</div>` : ''}`);
  }

  setPhase(phase) {
    this.phase = phase;
    this.root.dataset.phase = phase;
    this.orb.setMode(phase === 'recording' ? 'recording' : phase === 'thinking' ? 'thinking' : 'idle');
    this.controls.hidden = phase !== 'recording';
    this.root.querySelector('.voice-suggest').hidden = phase !== 'idle';
  }

  async startRecording({ hold = false } = {}) {
    if (!navigator.onLine) { toast('Necesito internet para entenderte. Puedes registrarlo a mano en Movimientos.', { type: 'err' }); return; }
    if (!window.isSecureContext) { showPermissionHelp('mic', 'insecure'); return; }
    if (!canRecord()) { showPermissionHelp('mic', 'unavailable'); return; }
    haptic.start();
    this.setPhase('recording');
    const autosend = state.profile?.voice_autosend !== false;
    this.setStatus('Te escucho…', hold ? 'Suelta para enviar' : autosend ? 'Envío cuando hagas una pausa · o toca la flecha' : 'Toca el orbe o la flecha para enviar');
    this.recorder = new Recorder({
      onSilence: () => { if (!hold && autosend && this.phase === 'recording') this.stopAndSend(); },
      onLevel: (lvl, freq) => this.orb.setLevel(lvl, freq),
      onTick: (s) => {
        const left = Math.max(0, MAX_RECORDING_SECONDS - s);
        this.timerEl.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        this.timerEl.classList.toggle('warn', left < 10);
      },
      onLimit: () => this.stopAndSend(),
      onInterrupted: () => { if (this.phase === 'recording') this.cancelRecording(); },
    });
    if (hold) {
      const up = () => { window.removeEventListener('pointerup', up); if (this.phase === 'recording' && this.recorder.seconds > 0.6) this.stopAndSend(); };
      window.addEventListener('pointerup', up);
    }
    try {
      await this.recorder.start();
    } catch (err) {
      this.setPhase(this.proposals.length ? 'result' : 'idle');
      this.setStatus('No pude usar el micrófono', err.message);
      if (['denied', 'insecure', 'unavailable'].includes(err.code)) showPermissionHelp('mic', err.code);
      else toast(err.message, { type: 'err' });
    }
  }

  cancelRecording() {
    this.answerTarget = null;
    this.recorder?.cancel();
    haptic.tap();
    this.setPhase(this.proposals.length || this.lastQuestion ? 'result' : 'idle');
    this.setStatus('Cuéntame qué gastaste', 'Toca el orbe para hablar');
  }

  async stopAndSend() {
    if (this.phase !== 'recording') return;
    this.setPhase('thinking'); // evita un doble envío (auto-envío por silencio + toque manual)
    const secs = this.recorder.seconds;
    const heard = this.recorder.heardVoice;
    const blob = await this.recorder.stop();
    if (!blob || secs < 0.5 || blob.size < 1200 || !heard) {
      this.answerTarget = null;
      this.setPhase(this.proposals.length || this.lastQuestion ? 'result' : 'idle');
      this.setStatus(heard ? 'Fue muy cortico' : 'No te escuché', heard ? 'Mantén presionado o toca y habla un poco más' : 'Intenta de nuevo, un poco más cerca del micrófono');
      haptic.error();
      return;
    }
    haptic.tap();
    const turn = { audio: blob, mimeType: this.recorder.mimeType, duration: this.recorder.duration ?? secs };
    if (this.answerTarget) await this.askAmount(turn);
    else await this.ask(turn);
  }

  /** Respuesta hablada a una tarjeta pendiente ("8 lucas"): solo se transcribe y se extrae el monto */
  answerByVoice(p) {
    if (this.phase === 'thinking' || this.phase === 'recording') return;
    this.answerTarget = p;
    this.startRecording();
    if (this.phase === 'recording') this.setStatus(p.question || '¿Cuánto costó?', 'Dime solo el monto');
  }

  async askAmount({ audio, mimeType, duration }) {
    const p = this.answerTarget;
    this.answerTarget = null;
    this.setPhase('thinking');
    this.setStatus('Escuchando el monto…');
    try {
      const done = await streamAssistant({ audio, mimeType, duration, mode: 'amount' });
      if (done.amount > 0 && this.unbindProposals?.complete) {
        this.unbindProposals.complete(p, done.amount);
        this.setStatus(missingAmount(p) ? 'Me falta un detalle' : 'Esto fue lo que entendí', '');
      } else {
        this.setStatus('No te entendí el monto', done.transcript ? `Escuché «${done.transcript}». Escríbelo en la tarjeta` : 'Escríbelo en la tarjeta');
        haptic.error();
      }
    } catch (err) {
      this.setStatus('Uy, no pude escucharte', err.message);
      haptic.error();
    }
    this.setPhase('result');
    this.updateFooter();
  }

  sendText(text) {
    haptic.tap();
    return this.ask({ text });
  }

  async ask({ audio, mimeType, duration, text }) {
    this.setPhase('thinking');
    this.setStatus(audio ? 'Enviando tu audio…' : 'Entendiendo…');
    const prev = this.proposals;
    const turn = { transcript: text ?? '', proposals: [], started: false };
    this.beginTurnView(prev, text ?? '');
    try {
      const done = await streamAssistant({
        audio, mimeType, duration, text, state: this.convState,
        onEvent: (ev, data) => {
          if (ev === 'sent') this.setStatus(audio ? 'Escuchando tu audio…' : 'Entendiendo…');
          else if (ev === 'transcript') { turn.transcript = data.text; this.showTranscript(data.text); this.setStatus('Entendiendo…'); }
          else if (ev === 'proposal') {
            if (!turn.started) { turn.started = true; this.startProposals(turn.proposals); }
            const item = { ...data, _status: 'pending' };
            turn.proposals.push(item);
            this.enqueue(() => this.appendProposal(turn.proposals.indexOf(item)));
            this.setStatus('Esto fue lo que entendí');
          } else if (ev === 'replace') {
            // la función fusionó transacciones del mismo evento: se reemplazan las tarjetas
            if (!turn.started) { turn.started = true; this.startProposals(turn.proposals); }
            turn.proposals.splice(0, turn.proposals.length, ...data.proposals.map((p) => ({ ...p, _status: 'pending' })));
            this.enqueue(() => { this.unbindProposals?.render?.(); this.updateFooter(); });
          } else if (ev === 'question') this.showBubble(data.text, true);
        },
      });
      await this.chain;
      this.finishTurn(done, turn, prev);
    } catch (err) {
      this.setPhase(this.proposals.length ? 'result' : 'idle');
      this.setStatus('Uy, no pude entenderte', err.message);
      this.showRetry(audio ? { audio, mimeType, duration } : { text });
      haptic.error();
    }
  }

  /** Estructura del turno: transcripción, burbuja y tarjetas (se llenan a medida que llegan los eventos) */
  beginTurnView(prev, text) {
    this.stage.classList.add('compact');
    this.result.hidden = false;
    this.result.innerHTML = String(html`
      <div class="transcript" ${text ? '' : 'hidden'}>
        <span class="eyebrow">Escuché</span>
        <div class="transcript-row"><input class="transcript-input" value="${text}" aria-label="Transcripción (puedes corregirla)">
          <button class="icon-btn" data-act="resend-transcript" aria-label="Volver a interpretar">${icon('refresh', { size: 18 })}</button></div>
      </div>
      <div class="bubble-slot"></div>
      <div class="p-summary" hidden aria-live="polite"></div>
      <div class="proposals stagger ${prev.length ? 'stale' : ''}">${renderProposals(prev)}</div>
      <div class="turn-actions"></div>`);
    this.bindList(this.result.querySelector('.proposals'), prev);
  }

  bindList(box, list) {
    this.unbindProposals?.();
    this.unbindProposals = bindProposals(box, list, {
      onChange: () => this.updateFooter(),
      onAnswerVoice: (p) => this.answerByVoice(p),
      onSaved: (p, r) => this.savedOne(p, r),
      transcript: () => this.transcript,
    });
  }

  /** Encola un paso de pintado: cada tarjeta entra al menos 220 ms después de la anterior */
  enqueue(fn) {
    this.chain = this.chain.then(fn).then(() => sleep(reduceMotion() ? 0 : 220)).catch(() => {});
  }

  showTranscript(text) {
    const box = this.result.querySelector('.transcript');
    if (!box) return;
    box.hidden = !text;
    box.querySelector('.transcript-input').value = text;
  }

  showBubble(text, question = false, big = false) {
    const slot = this.result.querySelector('.bubble-slot');
    if (!slot) return;
    slot.innerHTML = String(question
      ? html`<div class="bubble ai question">${text}
          <div class="q-actions"><button class="chip" data-act="mic-answer">${icon('mic', { size: 15 })}Responder con voz</button>
          <span class="muted xsmall">o escríbelo abajo</span></div></div>`
      : html`<div class="bubble ai ${big ? 'big' : ''}">${text}</div>`);
  }

  /** Primera propuesta del turno: la lista nueva reemplaza a la anterior (la IA siempre devuelve la lista completa) */
  startProposals(list) {
    this.proposals = list;
    const box = this.result.querySelector('.proposals');
    box.classList.remove('stale', 'still');
    box.innerHTML = '';
    this.bindList(box, list);
    this.sheet.expand();
  }

  /** Pinta una tarjeta apenas llega: el usuario puede empezar a revisarla antes de que termine todo */
  appendProposal(i) {
    const box = this.result?.querySelector('.proposals');
    const p = this.proposals[i];
    if (!box || !p) return;
    box.insertAdjacentHTML('beforeend', renderOne(p, i, this.proposals).replace(/--i:\d+/, `--i:0`));
    this.unbindProposals?.refreshActions?.();
    haptic.select();
    this.updateFooter();
  }

  finishTurn(done, turn, prev) {
    this.convState = done.state || this.convState;
    this.transcript = turn.transcript || this.transcript;
    if (!turn.started) {
      // Sin tarjetas nuevas: si fue un registro (solo pregunta) no queda nada pendiente; si fue consulta o saludo se conservan
      this.proposals = RECORD_INTENTS.includes(done.intent) && !done.empty ? [] : prev;
      const box = this.result.querySelector('.proposals');
      box.classList.remove('stale');
      box.innerHTML = String(renderProposals(this.proposals));
      this.bindList(box, this.proposals);
    }
    this.unbindProposals?.refreshActions?.();
    this.lastQuestion = done.question || null;
    const isQuery = done.intent === 'query' || done.intent === 'unknown';
    const sum = summarize(this.proposals);
    const grouped = sum.count > 1 || sum.pending > 0; // el encabezado ya resume: no hace falta la burbuja
    if (done.question) this.showBubble(done.question, true);
    else if (done.reply && !grouped) this.showBubble(done.reply, false, isQuery);
    else this.result.querySelector('.bubble-slot').innerHTML = '';
    const pending = pendingProposals(this.proposals);
    this.setPhase('result');
    this.setStatus(isQuery && !done.empty ? '' : done.question || sum.pending ? 'Me falta un detalle' : pending.length ? 'Esto fue lo que entendí' : 'Listo',
      sum.pending ? 'Dime cuánto costó o escríbelo en la tarjeta' : '');
    this.result.querySelector('.turn-actions').innerHTML = pending.length || !isQuery ? '' : String(
      html`<div class="center mt-6"><button class="btn btn-ghost btn-sm" data-act="restart">${icon('mic', { size: 16 })}Preguntar otra cosa</button></div>`);
    this.input.placeholder = done.question || sum.pending ? 'Responde aquí…' : 'Corrige o agrega algo…';
    this.updateFooter();
    this.sheet.expand();
    this.speak(done.question || done.reply);
    haptic.success();
  }

  /** Error sin tecnicismos, con opción de reintentar o escribir */
  showRetry(turn) {
    this.lastFailed = turn;
    if (this.result.hidden) return;
    const box = this.result.querySelector('.turn-actions');
    if (!box) return;
    box.innerHTML = String(html`<div class="center mt-6 retry-row">
      <button class="btn btn-secondary btn-sm" data-act="retry">${icon('refresh', { size: 16 })}Reintentar</button>
      <button class="btn btn-ghost btn-sm" data-act="type-instead">Escribirlo</button></div>`);
  }

  /** Encabezado: "Encontré 2 gastos en 2 categorías · Total $16.000 + 1 pendiente" (el total se anima) */
  updateSummary() {
    const box = this.result?.querySelector('.p-summary');
    if (!box) return;
    const s = summarize(this.proposals);
    const show = s.count > 1 || s.pending > 0 || (s.saved > 0 && s.count > 0);
    if (!show) { box.hidden = true; box.innerHTML = ''; this.shownTotal = 0; return; }
    const catsLabel = s.cats.length ? ` en ${s.cats.length} ${s.cats.length === 1 ? 'categoría' : 'categorías'}` : '';
    const key = `${s.count}|${s.cats.map((c) => c.id).join(',')}|${s.pending}`;
    if (box.hidden || box.dataset.key !== key) {
      const first = box.hidden;
      box.hidden = false;
      box.dataset.key = key;
      box.innerHTML = String(html`<div class="ps-cats">${s.cats.map((c, k) => html`<span class="ps-cat" style="--k:${k}">${catIcon(c)}</span>`)}</div>
        <div class="ps-text"><div class="ps-title">Encontré <b>${s.count} ${s.noun}</b>${catsLabel}</div>
          <div class="ps-total">Total <b class="num ps-amount">${money(this.shownTotal ?? 0)}</b>${s.pending ? html` <span class="ps-pend">+ ${s.pending} ${s.pending === 1 ? 'pendiente' : 'pendientes'}</span>` : ''}</div></div>`);
      if (!first) { box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump'); }
    }
    this.tweenTotal(box.querySelector('.ps-amount'), s.total);
  }

  tweenTotal(el, to) {
    if (!el) return;
    const from = this.shownTotal ?? 0;
    this.shownTotal = to;
    cancelAnimationFrame(this.tweenRaf);
    if (from === to || reduceMotion()) { el.textContent = money(to); return; }
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    const dur = 520;
    let t0 = null;
    const step = (t) => {
      t0 ??= t; // la base de tiempo del primer cuadro (no performance.now: pueden diferir)
      const k = Math.max(0, Math.min(1, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = money(Math.round(from + (to - from) * e));
      if (k < 1) this.tweenRaf = requestAnimationFrame(step);
    };
    this.tweenRaf = requestAnimationFrame(step);
  }

  /** Una tarjeta guardada por separado: deshacer, y si ya no queda nada, cierre con celebración */
  savedOne(p, { undo }) {
    const left = pendingProposals(this.proposals);
    toast('Guardado', undo ? { action: { label: 'Deshacer', fn: async () => {
      await undo(); p._status = 'pending'; this.unbindProposals?.render?.(); this.updateFooter(); toast('Listo, lo deshice', { type: 'info' });
    } } } : {});
    if (!left.length) {
      this.celebrate();
      setTimeout(() => this.sheet.close(), 950);
    }
  }

  updateFooter() {
    this.updateSummary();
    const pending = pendingProposals(this.proposals);
    let bar = this.root.querySelector('.confirm-bar');
    if (!pending.length) { bar?.remove(); return; }
    const missing = pending.filter(missingAmount).length;
    if (this.phase === 'result' && this.wasMissing && !missing && !this.lastQuestion) this.setStatus('¡Completo!', 'Revisa y confirma');
    this.wasMissing = missing > 0;
    const total =pending.filter((p) => p.kind === 'transaction' && p.type === 'expense' && !missingAmount(p)).reduce((s, p) => s + (p.amount || 0), 0);
    const label = missing ? `Falta ${missing} ${missing === 1 ? 'monto' : 'montos'}` : pending.length === 1 ? 'Confirmar' : `Confirmar todo (${pending.length})`;
    const tpl = html`<div class="confirm-bar">
      <button class="btn btn-ghost btn-sm" data-act="restart">Cancelar</button>
      <button class="btn btn-accent grow" data-act="confirm-all" ${missing ? 'disabled aria-disabled="true"' : ''}>${icon(missing ? 'clock' : 'check', { stroke: 2.4 })}<span class="btn-label">${label}${total && !missing ? ` · ${money(total)}` : ''}</span><span class="spinner"></span></button>
    </div>`;
    if (!bar) {
      this.sheet.foot.insertAdjacentHTML('afterbegin', String(tpl));
    } else bar.outerHTML = String(tpl);
  }

  async confirm() {
    const pending = pendingProposals(this.proposals);
    const missing = pending.find(missingAmount);
    if (missing) {
      const i = this.proposals.indexOf(missing);
      const card = this.result.querySelector(`.proposal[data-i="${i}"]`);
      card?.classList.add('shake');
      card?.querySelector('[data-f="answer"]')?.focus();
      setTimeout(() => card?.classList.remove('shake'), 500);
      return;
    }
    for (const p of pending) {
      const err = validateProposal(p);
      if (err) {
        toast(err, { type: 'err' });
        const i = this.proposals.indexOf(p);
        this.result.querySelector(`.proposal[data-i="${i}"]`)?.classList.add('shake');
        return;
      }
    }
    const btn = this.root.querySelector('[data-act="confirm-all"]');
    btn?.classList.add('loading');
    try {
      const { count, undo } = await saveProposals(this.proposals, { transcript: this.transcript });
      haptic.success();
      this.celebrate();
      setTimeout(() => {
        this.sheet.close();
        toast(count === 1 ? 'Guardado' : `${count} registros guardados`, undo ? { action: { label: 'Deshacer', fn: async () => { await undo(); toast('Listo, lo deshice', { type: 'info' }); } } } : {});
      }, 950);
    } catch (err) {
      btn?.classList.remove('loading');
      toast(err.message, { type: 'err' });
    }
  }

  celebrate() {
    this.root.querySelector('.confirm-bar')?.remove();
    this.result.innerHTML = String(html`<div class="saved-state">
      <div class="saved-burst">
        ${raw('<svg class="check-anim" viewBox="0 0 72 72" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="36" cy="36" r="32" stroke="#12875A"/><path d="m23 37 9 9 18-19" stroke="#12875A"/></svg>')}
        <div class="confetti">${Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          const colors = ['#4B3BF5', '#12875A', '#F08A4B', '#E5527A', '#E6B422'];
          return raw(`<i style="--c:${colors[i % 5]};--x:${Math.round(Math.cos(a) * 80)}px;--y:${Math.round(Math.sin(a) * 80)}px;--r:${i * 47}deg;--d:${i * 12}ms"></i>`);
        })}</div>
      </div>
      <div class="saved-title">¡Listo!</div>
    </div>`);
    this.stage.hidden = true;
  }

  reset() {
    this.convState = null;
    this.answerTarget = null;
    this.shownTotal = 0;
    this.proposals = [];
    this.lastQuestion = null;
    this.result.hidden = true;
    this.result.innerHTML = '';
    this.stage.hidden = false;
    this.stage.classList.remove('compact');
    this.root.querySelector('.confirm-bar')?.remove();
    this.input.placeholder = 'O escríbelo aquí…';
    this.setPhase('idle');
    this.setStatus('Cuéntame qué gastaste', 'Toca el orbe para hablar · mantenlo presionado si prefieres');
  }

  speak(text) {
    if (!text || !state.profile?.voice_reply || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => v.lang === 'es-CO') ?? voices.find((v) => v.lang?.startsWith('es-4')) ?? voices.find((v) => v.lang?.startsWith('es')) ?? null;
      u.lang = u.voice?.lang ?? 'es-CO';
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* sin voz */ }
  }

  destroy() {
    this.recorder?.cancel();
    this.orb?.destroy();
    this.unbindProposals?.();
    try { speechSynthesis?.cancel(); } catch { /* nada */ }
    if (active === this) active = null;
  }
}
