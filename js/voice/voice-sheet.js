// Flujo de voz: grabar → enviar → "pensando" → propuestas editables / pregunta de aclaración → confirmar
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { haptic } from '../utils/haptics.js';
import { money } from '../utils/format.js';
import { MAX_RECORDING_SECONDS } from '../config.js';
import { state } from '../state.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { askAssistant } from '../api/ai.js';
import { Recorder, canRecord } from './recorder.js';
import { Orb } from './orb.js';
import { renderProposals, bindProposals, pendingProposals, saveProposals, validateProposal } from './proposals.js';
import { showPermissionHelp } from '../permissions.js';

const THINKING = ['Escuchando tus lucas…', 'Entendiendo lo que dijiste…', 'Separando por categorías…', 'Sumando montos…', 'Casi listo…'];
export const SUGGESTIONS = ['Almorcé por 18 lucas', 'Recibí 200 mil de una venta', 'Tanqueé 80 mil con la tarjeta', '¿Cuánto llevo este mes?'];

let active = null;

/** openVoice({ autoStart, text, hold }) — hold: grabar mientras se mantenga presionado (soltar envía) */
export function openVoice(opts = {}) {
  if (active && !active.sheet.closed) { active.sheet.expand(); return active; }
  active = new VoiceSession(opts);
  return active;
}

class VoiceSession {
  constructor({ autoStart = false, text = '', hold = false } = {}) {
    this.history = [];
    this.proposals = [];
    this.transcript = '';
    this.phase = 'idle';
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
    if (text) this.sendText(text);
    else if (autoStart) this.startRecording({ hold });
  }

  bind() {
    const hit = this.root.querySelector('.orb-hit');
    let pressT = 0, holdTimer = null, holding = false;
    hit.addEventListener('pointerdown', () => {
      if (this.phase !== 'idle' && this.phase !== 'result') return;
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
      this.sendText(v);
    });
    on(this.root, 'click', '[data-act="confirm-all"]', () => this.confirm());
    on(this.root, 'click', '[data-act="mic-answer"]', () => this.startRecording());
    on(this.root, 'click', '[data-act="restart"]', () => this.reset());
    on(this.root, 'click', '[data-act="resend-transcript"]', () => {
      const v = this.root.querySelector('.transcript-input')?.value.trim();
      if (v) { this.history = []; this.sendText(v); }
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
    this.setStatus('Te escucho…', hold ? 'Suelta para enviar' : 'Toca el orbe o la flecha para enviar');
    this.recorder = new Recorder({
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
    this.recorder?.cancel();
    haptic.tap();
    this.setPhase(this.proposals.length || this.lastQuestion ? 'result' : 'idle');
    this.setStatus('Cuéntame qué gastaste', 'Toca el orbe para hablar');
  }

  async stopAndSend() {
    if (this.phase !== 'recording') return;
    const secs = this.recorder.seconds;
    const blob = await this.recorder.stop();
    if (!blob || secs < 0.5 || blob.size < 1200) {
      this.setPhase(this.proposals.length ? 'result' : 'idle');
      this.setStatus('Fue muy cortico', 'Mantén presionado o toca y habla un poco más');
      return;
    }
    haptic.tap();
    await this.ask({ audio: blob, mimeType: this.recorder.mimeType, duration: this.recorder.duration ?? secs });
  }

  sendText(text) {
    haptic.tap();
    return this.ask({ text });
  }

  async ask({ audio, mimeType, duration, text }) {
    this.setPhase('thinking');
    let k = 0;
    this.setStatus(THINKING[0]);
    clearInterval(this.thinkTimer);
    this.thinkTimer = setInterval(() => {
      k = Math.min(k + 1, THINKING.length - 1);
      const t = this.status.querySelector('.vs-title');
      if (t) { t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap'); t.textContent = THINKING[k]; }
    }, 1400);
    try {
      const r = await askAssistant({ audio, mimeType, duration, text, history: this.history });
      clearInterval(this.thinkTimer);
      this.handle(r);
    } catch (err) {
      clearInterval(this.thinkTimer);
      this.setPhase(this.proposals.length ? 'result' : 'idle');
      this.setStatus('Uy, no pude entenderte', err.message);
      haptic.error();
    }
  }

  handle(r) {
    this.transcript = r.transcript || this.transcript;
    this.history.push({ role: 'user', content: r.transcript || '' });
    if (r.memory) this.history.push({ role: 'assistant', content: r.memory });

    if (r.proposals?.length || ['create_transactions', 'card_payment', 'debt_payment', 'add_subscription', 'goal_contribution'].includes(r.intent)) {
      // La IA devuelve siempre la lista completa y actualizada: reemplaza las pendientes
      this.proposals = (r.proposals ?? []).map((p) => ({ ...p, _status: 'pending' }));
    }
    this.lastQuestion = r.needs_clarification ? r.question : null;
    this.setPhase('result');
    this.renderResult(r);
    this.speak(r.needs_clarification ? r.question : r.reply);
    haptic.success();
  }

  renderResult(r) {
    const pending = pendingProposals(this.proposals);
    const isQuery = r.intent === 'query' || r.intent === 'unknown';
    this.setStatus(isQuery ? '' : r.needs_clarification ? 'Me falta un detalle' : pending.length ? 'Esto fue lo que entendí' : 'Listo', '');
    this.stage.classList.toggle('compact', true);

    this.result.hidden = false;
    this.result.innerHTML = String(html`
      ${r.transcript ? html`<div class="transcript">
        <span class="eyebrow">Escuché</span>
        <div class="transcript-row"><input class="transcript-input" value="${r.transcript}" aria-label="Transcripción (puedes corregirla)">
          <button class="icon-btn" data-act="resend-transcript" aria-label="Volver a interpretar">${icon('refresh', { size: 18 })}</button></div>
      </div>` : ''}
      ${r.reply && !r.needs_clarification ? html`<div class="bubble ai ${isQuery ? 'big' : ''}">${r.reply}</div>` : ''}
      ${r.needs_clarification ? html`<div class="bubble ai question">${r.question}
        <div class="q-actions"><button class="chip" data-act="mic-answer">${icon('mic', { size: 15 })}Responder con voz</button>
        <span class="muted xsmall">o escríbelo abajo</span></div></div>` : ''}
      <div class="proposals stagger">${renderProposals(this.proposals)}</div>
      ${pending.length ? '' : isQuery ? html`<div class="center mt-6"><button class="btn btn-ghost btn-sm" data-act="restart">${icon('mic', { size: 16 })}Preguntar otra cosa</button></div>` : ''}
    `);
    this.unbindProposals?.();
    this.unbindProposals = bindProposals(this.result.querySelector('.proposals'), this.proposals, { onChange: () => this.updateFooter() });
    this.input.placeholder = r.needs_clarification ? 'Responde aquí…' : 'Corrige o agrega algo…';
    this.updateFooter();
    this.sheet.expand();
  }

  updateFooter() {
    const pending = pendingProposals(this.proposals);
    let bar = this.root.querySelector('.confirm-bar');
    if (!pending.length) { bar?.remove(); return; }
    const total = pending.filter((p) => p.kind === 'transaction' && p.type === 'expense').reduce((s, p) => s + (p.amount || 0), 0);
    const label = pending.length === 1 ? 'Confirmar' : `Confirmar todo (${pending.length})`;
    const tpl = html`<div class="confirm-bar">
      <button class="btn btn-ghost btn-sm" data-act="restart">Cancelar</button>
      <button class="btn btn-accent grow" data-act="confirm-all">${icon('check', { stroke: 2.4 })}<span class="btn-label">${label}${total ? ` · ${money(total)}` : ''}</span><span class="spinner"></span></button>
    </div>`;
    if (!bar) {
      this.sheet.foot.insertAdjacentHTML('afterbegin', String(tpl));
    } else bar.outerHTML = String(tpl);
  }

  async confirm() {
    const pending = pendingProposals(this.proposals);
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
    this.history = [];
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
    clearInterval(this.thinkTimer);
    this.recorder?.cancel();
    this.orb?.destroy();
    this.unbindProposals?.();
    try { speechSynthesis?.cancel(); } catch { /* nada */ }
    if (active === this) active = null;
  }
}
