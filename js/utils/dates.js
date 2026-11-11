// Fechas siempre en America/Bogota (UTC−5 fijo, sin horario de verano)
import { LOCALE, TIMEZONE } from '../config.js';

const OFFSET_MS = -5 * 3600 * 1000;

/** Partes de una fecha vista en Bogotá */
export function bogota(d = new Date()) {
  const b = new Date(new Date(d).getTime() + OFFSET_MS);
  const iso = b.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), hour: b.getUTCHours(), weekday: b.getUTCDay(), day: b.getUTCDate(), month: b.getUTCMonth(), year: b.getUTCFullYear() };
}

export const todayISO = () => bogota().date;

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export function startOfWeek(iso) {
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((wd + 6) % 7));
}
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** ISO local de Bogotá → timestamptz */
export const toTimestamp = (date, time = '12:00') => `${date}T${time}:00-05:00`;

const fmt = (opts) => new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, ...opts });
const fDayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fDate = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const fDateNoYear = fmt({ day: 'numeric', month: 'short' });
const fTime = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
const fMonth = fmt({ month: 'long', year: 'numeric' });
const fMonthShort = fmt({ month: 'short' });

const asDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00-05:00`) : new Date(v));

export function dayLabel(v) {
  const d = bogota(asDate(v)).date;
  const today = todayISO();
  if (d === today) return 'Hoy';
  if (d === addDays(today, -1)) return 'Ayer';
  if (d === addDays(today, 1)) return 'Mañana';
  const s = fDayLong.format(asDate(v));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const dateShort = (v) => {
  const d = asDate(v);
  return (bogota(d).year === bogota().year ? fDateNoYear : fDate).format(d).replace(/\./g, '');
};
export const timeLabel = (v) => fTime.format(new Date(v)).replace(/\s?a\.\s?m\./i, ' a. m.').replace(/\s?p\.\s?m\./i, ' p. m.');
export const monthLabel = (v) => { const s = fMonth.format(asDate(v)); return s.charAt(0).toUpperCase() + s.slice(1); };
export const monthShort = (v) => fMonthShort.format(asDate(v)).replace('.', '');

export function inDays(n) {
  if (n <= 0) return 'Hoy';
  if (n === 1) return 'Mañana';
  return `En ${n} días`;
}

export function greeting(date = new Date()) {
  const h = bogota(date).hour;
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Valor para <input type="date"> y <input type="time"> en Bogotá */
export function inputParts(v = new Date()) {
  const b = bogota(new Date(v));
  return { date: b.date, time: b.time };
}

export function relativeTime(v) {
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return 'Ahora';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `Hace ${Math.floor(diff / 86400)} d`;
  return dateShort(v);
}
