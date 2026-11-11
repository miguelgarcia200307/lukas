// Vibración ligera donde exista (Android). En iOS no hay API: el feedback es visual.
const can = typeof navigator !== 'undefined' && 'vibrate' in navigator;
const vib = (p) => { try { if (can) navigator.vibrate(p); } catch { /* sin soporte */ } };

export const haptic = {
  tap: () => vib(8),
  select: () => vib(12),
  success: () => vib([12, 60, 18]),
  warning: () => vib([20, 40, 20]),
  error: () => vib([30, 50, 30, 50, 30]),
  start: () => vib(18),
};
