// Orbe de voz en canvas: respira (idle), reacciona a la voz (recording) y se convierte en partículas (thinking)
const TAU = Math.PI * 2;

export class Orb {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'idle';
    this.level = 0;
    this.target = 0;
    this.freq = null;
    this.compact = compact;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.particles = Array.from({ length: compact ? 36 : 64 }, (_, i) => ({
      a: Math.random() * TAU, r: 0.5 + Math.random() * 0.9, s: 0.004 + Math.random() * 0.014,
      size: 0.8 + Math.random() * 2.2, phase: Math.random() * TAU, hue: i % 3,
    }));
    this.morph = 0; // 0 = blob, 1 = partículas
    this.resize = this.resize.bind(this);
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(canvas);
    this.resize();
    this.t0 = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const { width, height } = this.canvas.getBoundingClientRect();
    this.w = width; this.h = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setMode(mode) { this.mode = mode; }
  setLevel(level, freq) { this.target = level; this.freq = freq; }

  loop(now) {
    const t = (now - this.t0) / 1000;
    this.level += (this.target - this.level) * 0.25;
    const wantMorph = this.mode === 'thinking' ? 1 : 0;
    this.morph += (wantMorph - this.morph) * 0.06;
    this.draw(this.reduce ? 0 : t);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(t) {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * (this.compact ? 0.36 : 0.3);
    const rec = this.mode === 'recording';
    const lvl = rec ? this.level : 0;

    // Halo
    const haloR = R * (1.55 + lvl * 0.5 + Math.sin(t * 1.4) * 0.04);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, haloR);
    halo.addColorStop(0, `rgba(75,59,245,${0.18 + lvl * 0.2})`);
    halo.addColorStop(1, 'rgba(75,59,245,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, TAU); ctx.fill();

    // Barras radiales reactivas
    if (rec && this.freq && this.morph < 0.5) {
      const n = 48;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const f = this.freq[Math.floor((i / n) * this.freq.length * 0.7)] / 255;
        const a = (i / n) * TAU - Math.PI / 2;
        const r0 = R * 1.12;
        const r1 = r0 + R * (0.06 + f * 0.5 * (0.4 + lvl));
        ctx.strokeStyle = `rgba(75,59,245,${0.25 + f * 0.6})`;
        ctx.lineWidth = Math.max(2, R * 0.045);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
    }

    // Blob
    const blobScale = 1 - this.morph * 0.45;
    if (blobScale > 0.05) {
      const pts = 72;
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * TAU;
        const wob = Math.sin(a * 3 + t * 1.6) * 0.025 + Math.sin(a * 5 - t * 2.1) * 0.018
          + (rec ? Math.sin(a * 4 + t * 7) * lvl * 0.12 + Math.sin(a * 7 - t * 9) * lvl * 0.06 : 0);
        const breathe = this.mode === 'idle' ? Math.sin(t * 1.7) * 0.03 : 0;
        const r = R * blobScale * (1 + wob + breathe + lvl * 0.18);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.1, cx, cy, R * 1.25);
      g.addColorStop(0, '#9C92FF');
      g.addColorStop(0.45, '#4B3BF5');
      g.addColorStop(1, '#2A1DB8');
      ctx.fillStyle = g;
      ctx.globalAlpha = 1 - this.morph * 0.5;
      ctx.fill();
      // brillo
      const s = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, 0, cx - R * 0.3, cy - R * 0.4, R * 0.7);
      s.addColorStop(0, 'rgba(255,255,255,0.45)');
      s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Partículas (pensando)
    if (this.morph > 0.02) {
      const colors = ['75,59,245', '156,146,255', '42,29,184'];
      for (const p of this.particles) {
        p.a += p.s * (1 + this.morph * 2);
        const rr = R * (0.55 + p.r * 0.75 + Math.sin(t * 2 + p.phase) * 0.12) * (0.6 + this.morph * 0.4);
        const x = cx + Math.cos(p.a) * rr;
        const y = cy + Math.sin(p.a) * rr * 0.92;
        ctx.fillStyle = `rgba(${colors[p.hue]},${0.35 + 0.6 * this.morph * (0.5 + 0.5 * Math.sin(t * 3 + p.phase))})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * (this.compact ? 0.8 : 1.1), 0, TAU);
        ctx.fill();
      }
    }

    // Ícono de micrófono en el centro (idle)
    if (this.mode === 'idle' && !this.compact) {
      ctx.save();
      ctx.translate(cx, cy);
      const k = R / 60;
      ctx.scale(k, k);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 4.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-8, -20, 16, 27, 8) : ctx.rect(-8, -20, 16, 27);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -2, 15, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.moveTo(0, 13); ctx.lineTo(0, 20);
      ctx.stroke();
      ctx.restore();
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }
}
