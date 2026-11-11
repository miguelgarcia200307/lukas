// Grabación con MediaRecorder + análisis en vivo con Web Audio (AnalyserNode).
// Mono, 16 kHz cuando el navegador lo permite y bitrate bajo (Whisper trabaja a 16 kHz: más calidad solo alarga la subida).
// VAD simple: detecta si hubo voz y avisa tras ~1,5 s de silencio después de hablar (auto-envío).
import { MAX_RECORDING_SECONDS } from '../config.js';
import { AppError } from '../api/base.js';
import { sharedAudioContext, releaseAudioContext, audioSession } from './speech.js';

function supportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

const SILENCE_MS = 1500; // silencio tras hablar que dispara el auto-envío
const MIN_SPEECH_MS = 250; // voz mínima para considerar que el usuario habló
const CALIBRATE_MS = 350; // ruido de fondo inicial

export class Recorder {
  constructor({ onLevel, onTick, onLimit, onInterrupted, onSilence, onSpeech } = {}) {
    Object.assign(this, { onLevel, onTick, onLimit, onInterrupted, onSilence, onSpeech });
    this.chunks = [];
    this.state = 'idle';
  }

  /**
   * La primera vez debe llamarse dentro de un gesto (iOS exige crear/reanudar el AudioContext ahí). El contexto es
   * compartido y no se cierra: así, en manos libres, se puede volver a escuchar sin otro toque.
   */
  async start() {
    if (!window.isSecureContext) throw new AppError('Para usar el micrófono la app debe abrirse con https://.', null, 'insecure');
    if (!canRecord()) throw new AppError('Tu navegador no permite grabar audio. Escríbelo en su lugar.', null, 'unavailable');
    this.ctx = sharedAudioContext();
    audioSession('play-and-record');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: { ideal: 16000 } },
      });
    } catch (err) {
      audioSession('auto');
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        throw new AppError('Necesito permiso para usar el micrófono. Actívalo en los ajustes del navegador o escríbelo.', err, 'denied');
      }
      if (err.name === 'NotFoundError') throw new AppError('No encontré un micrófono en este dispositivo.', err, 'no_mic');
      throw new AppError('No pude abrir el micrófono. Intenta de nuevo.', err, 'mic_error');
    }

    this.mimeType = supportedMimeType();
    // Opus (Android/Chrome) ~24 kbps; AAC (iOS/Safari) ~32 kbps
    const bits = /opus|webm|ogg/.test(this.mimeType) ? 24000 : 32000;
    try {
      this.recorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: bits } : { audioBitsPerSecond: bits });
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }
    this.mimeType = this.recorder.mimeType || this.mimeType || 'audio/webm';
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.state = 'recording';
    this.startedAt = performance.now();
    this.speechMs = 0;
    this.hasSpeech = false;
    this.lastVoiceAt = 0;
    this.noise = null;
    this.onHidden = (e) => {
      if (e.type === 'pagehide' || document.visibilityState === 'hidden') { this.cancel(); this.onInterrupted?.(); }
    };
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onHidden);

    if (this.ctx) {
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.src = src;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      src.connect(this.analyser);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
    }
    this.vadActive = !!this.analyser;
    let prev = performance.now();
    const loop = () => {
      if (this.state !== 'recording') return;
      const now = performance.now();
      const dt = now - prev;
      prev = now;
      let level = 0, rms = 0;
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(this.wave);
        this.analyser.getByteFrequencyData(this.freq);
        let sum = 0;
        for (const v of this.wave) { const x = (v - 128) / 128; sum += x * x; }
        rms = Math.sqrt(sum / this.wave.length);
        level = Math.min(1, rms * 4);
        this.vad(rms, now, dt);
      }
      this.onLevel?.(level, this.freq);
      const secs = (now - this.startedAt) / 1000;
      this.onTick?.(secs);
      if (secs >= MAX_RECORDING_SECONDS) { this.onLimit?.(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Detección de voz por energía con piso de ruido adaptativo */
  vad(rms, now, dt) {
    const elapsed = now - this.startedAt;
    if (elapsed < CALIBRATE_MS) { this.noise = this.noise == null ? rms : Math.min(this.noise, rms); return; }
    const floor = this.noise ?? 0.01;
    const threshold = Math.max(0.02, floor * 3);
    if (rms > threshold) {
      this.speechMs += dt;
      this.lastVoiceAt = now;
      if (!this.hasSpeech && this.speechMs >= MIN_SPEECH_MS) { this.hasSpeech = true; this.onSpeech?.(); }
    } else {
      this.noise = floor * 0.98 + Math.min(rms, threshold) * 0.02; // el piso se adapta despacio
      if (this.hasSpeech && now - this.lastVoiceAt > SILENCE_MS && !this.silenceFired) { this.silenceFired = true; this.onSilence?.(); }
    }
  }

  get seconds() { return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0; }
  /** Sin analizador (navegadores viejos) no se puede saber: se asume que habló */
  get heardVoice() { return !this.vadActive || this.hasSpeech; }

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
    try { this.src?.disconnect(); } catch { /* nada */ }
    // Micrófono liberado del todo: iOS vuelve de modo grabación a reproducción (para que Lukas se oiga)
    this.stream?.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
    audioSession('auto');
    releaseAudioContext(); // suspendido mientras no se graba: así no enmudece la voz de Lukas en iOS
    this.src = null;
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
  }
}
