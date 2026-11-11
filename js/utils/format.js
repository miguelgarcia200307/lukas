// Formato de moneda COP (sin decimales) y números
import { LOCALE } from '../config.js';

const nf = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** $ 62.000 (espacio fino estable, sin depender del formato de cada navegador) */
export function money(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = '$' + nf.format(Math.abs(v));
  if (v < 0) return '−' + s;
  return sign && v > 0 ? '+' + s : s;
}

/** 62 mil · 1,2 M — para ejes y textos compactos */
export function moneyShort(n) {
  const v = Math.round(Number(n) || 0);
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toLocaleString(LOCALE, { maximumFractionDigits: a >= 10_000_000 ? 0 : 1 })} M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000).toLocaleString(LOCALE)} mil`;
  return `${sign}$${a}`;
}

export const number = (n) => nf.format(Math.round(Number(n) || 0));

/** "30.000" / "$ 30.000" / "30k" → 30000 */
export function parseAmount(str) {
  if (typeof str === 'number') return Math.round(str);
  const s = String(str ?? '').trim().toLowerCase();
  if (!s) return 0;
  const k = /k$/.test(s) ? 1000 : 1;
  const digits = s.replace(/[^\d]/g, '');
  return digits ? Number(digits) * k : 0;
}

export function percent(n, digits = 0) {
  return `${(Number(n) || 0).toLocaleString(LOCALE, { maximumFractionDigits: digits })}%`;
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
}

export const PALETTE = ['#4B3BF5', '#F08A4B', '#3FA672', '#3D8BE0', '#E5527A', '#A65BE0', '#E6B422', '#2FB3A6', '#1D1D1B', '#B9855A', '#E0606B', '#6B7280'];
