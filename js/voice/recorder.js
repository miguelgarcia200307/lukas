// Grabación con MediaRecorder + análisis en vivo con Web Audio (AnalyserNode)
import { MAX_RECORDING_SECONDS } from '../config.js';
import { AppError } from '../api/base.js';

function supportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

export class Recorder {
  constructor({ onLevel, onTick, onLimit, onInterrupted } = {}) {
    this.onInterrupted = onInterrupted;
    this.onLevel = onLevel;
    this.onTick = onTick;
    this.onLimit = onLimit;
    this.chunks = [];
    this.state = 'idle';
  }

  /** Debe llamarse dentro del gesto del usuario (iOS exige crear el AudioContext ahí). */
  async start() {
    if (!window.isSecureContext) throw new AppError('Para usar el micrófono la app debe abrirse con https://.', null, 'insecure');
    if (!canRecord()) throw new AppError('Tu navegador no permite grabar audio. Escríbelo en su lugar.', null, 'unavailable');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = Ctx ? new Ctx() : null;
    this.ctx?.resume?.();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      this.ctx?.close?.();
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        throw new AppError('Necesito permiso para usar el micrófono. Actívalo en los ajustes del navegador o escríbelo.', err, 'denied');
      }
      if (err.name === 'NotFoundError') throw new AppError('No encontré un micrófono en este dispositivo.', err, 'no_mic');
      throw new AppError('No pude abrir el micrófono. Intenta de nuevo.', err, 'mic_error');
    }

    this.mimeType = supportedMimeType();
    this.recorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 64000 } : undefined);
    this.mimeType = this.recorder.mimeType || this.mimeType || 'audio/webm';
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.state = 'recording';
    this.startedAt = performance.now();
    // Si la app pasa a segundo plano se suelta el micrófono (apaga el indicador naranja de iOS)
    this.onHidden = (e) => {
      if (e.type === 'pagehide' || document.visibilityState === 'hidden') { this.cancel(); this.onInterrupted?.(); }
    };
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onHidden);

    if (this.ctx) {
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.75;
      src.connect(this.analyser);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
    }
    const loop = () => {
      if (this.state !== 'recording') return;
      let level = 0;
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(this.wave);
        this.analyser.getByteFrequencyData(this.freq);
        let sum = 0;
        for (const v of this.wave) { const x = (v - 128) / 128; sum += x * x; }
        level = Math.min(1, Math.sqrt(sum / this.wave.length) * 4);
      }
      this.onLevel?.(level, this.freq);
      const secs = (performance.now() - this.startedAt) / 1000;
      this.onTick?.(secs);
      if (secs >= MAX_RECORDING_SECONDS) { this.onLimit?.(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  get seconds() { return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0; }

  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.state !== 'recording') { resolve(null); return; }
      this.state = 'stopping';
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.duration = Math.min(60, (performance.now() - this.startedAt) / 1000);
        this.cleanup();
        resolve(blob);
      };
      try { this.recorder.requestData?.(); } catch { /* nada */ }
      this.recorder.stop();
    });
  }

  cancel() {
    if (this.recorder && this.state === 'recording') {
      this.recorder.onstop = null;
      try { this.recorder.stop(); } catch { /* nada */ }
    }
    this.cleanup();
  }

  cleanup() {
    this.state = 'idle';
    if (this.onHidden) {
      document.removeEventListener('visibilitychange', this.onHidden);
      window.removeEventListener('pagehide', this.onHidden);
      this.onHidden = null;
    }
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
    this.ctx?.close?.().catch?.(() => {});
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
  }
}
