// Arte de las tarjetas de crédito: frente (franja con banco, apodo, ••••, deuda, franquicia y anillo de uso),
// reverso (cupo, disponible, uso, fechas, mínimo y acciones), temas por banco, acabados y textos accesibles.
import { html, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, percent } from '../utils/format.js';
import { dateShort } from '../utils/dates.js';
import { sensitiveAmount } from './sensitive.js';
import { usageTone, minimumPayment, diffDays } from '../utils/card-pick.js';

// Colores de marca aproximados de bancos en Colombia (sugerencia por defecto; el usuario puede cambiarlo)
const BANKS = [
  [/falabella|cmr/, '#2E8B3E', '#7BC043', 'CF'],
  [/rappi/, '#17171A', '#3A3A40', 'R'],
  [/bancolombia/, '#1C1C1C', '#FDDA24', 'B'],
  [/davivienda/, '#C8102E', '#E8414F', 'D'],
  [/\bnu\b|nubank/, '#820AD1', '#B44CF0', 'Nu'],
  [/bbva/, '#072146', '#1464A5', 'BB'],
  [/bogot/, '#0B3B8C', '#2D6BC4', 'BdB'],
  [/colpatria|scotiabank/, '#B5121B', '#EC111A', 'S'],
  [/ita[uú]/, '#EC7000', '#F59B3C', 'I'],
  [/occidente/, '#004A99', '#3A7FD0', 'O'],
  [/popular/, '#00662F', '#2E9E5B', 'P'],
  [/av ?villas/, '#00539B', '#E30613', 'AV'],
  [/lulo/, '#0F0F0F', '#C6FF3D', 'L'],
  [/caja social/, '#004B8D', '#00A3E0', 'CS'],
];
const bankInfo = (c) => {
  const s = `${c?.bank ?? ''} ${c?.name ?? ''}`.toLowerCase();
  return BANKS.find(([re]) => re.test(s)) ?? null;
};
/** Color principal sugerido para el banco de la tarjeta (o null) */
export const bankColor = (c) => bankInfo(c)?.[1] ?? null;
export const bankColors = (c) => { const b = bankInfo(c); return b ? [b[1], b[2]] : null; };
const monogram = (c) => bankInfo(c)?.[3] ?? String(c?.bank || c?.name || '•').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Degradados de la paleta de personalización: [nombre, color, color2] */
export const GRADIENTS = [
  ['Aurora', '#4B3BF5', '#E5527A'], ['Océano', '#0F4C81', '#2FB3A6'], ['Atardecer', '#F08A4B', '#E5527A'],
  ['Bosque', '#1E5631', '#3FA672'], ['Medianoche', '#0B1026', '#3D3D8F'], ['Oro rosa', '#B76E79', '#E8B4A0'],
  ['Champaña', '#B08D57', '#EBD5A4'], ['Grafito', '#1D1D1B', '#55554F'],
];
export const SOLIDS = ['#1D1D1B', '#4B3BF5', '#2E8B3E', '#C8102E', '#820AD1', '#0B3B8C', '#EC7000', '#2FB3A6', '#E5527A', '#B9855A', '#6B7280', '#F2F0EA'];
export const FINISHES = [['gradient', 'Degradado'], ['metal', 'Metal'], ['matte', 'Mate'], ['glass', 'Vidrio']];
export const EMOJIS = ['🛒', '✈️', '🍔', '⛽', '🏠', '🎁', '💼', '🎓', '💊', '🎮', '🚗', '👗', '🐶', '💳', '⭐', '🔥', '💎', '🌴', '🎵', '📱', '🧾', '🍷', '🏋️', '👶'];

const hex = (s) => (/^#[0-9a-f]{6}$/i.test(String(s ?? '')) ? String(s) : null);
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Tema visual → { c, c2, finish, light } (light = fondo claro, texto oscuro) */
export function cardTheme(c) {
  const base = hex(c?.color) ?? bankColor(c) ?? '#1D1D1B';
  const c2 = hex(c?.color2) ?? base;
  const finish = FINISHES.some(([k]) => k === c?.finish) ? c.finish : 'gradient';
  const light = (lum(base) + lum(c2)) / 2 > 0.45;
  return { c: base, c2, finish, light };
}

const BRAND = {
  visa: () => '<span class="cc-visa" aria-hidden="true">VISA</span>',
  mastercard: () => '<span class="cc-mc" aria-hidden="true"><i></i><i></i></span>',
  amex: () => '<span class="cc-amex" aria-hidden="true">AMEX</span>',
  diners: () => '<span class="cc-diners" aria-hidden="true">Diners</span>',
};
const BRAND_NAME = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', diners: 'Diners Club' };
export const brandMark = (b) => raw(BRAND[b]?.() ?? '');

/** "540 mil pesos", "1 millón 517 mil pesos" (para lectores de pantalla) */
export function spokenCOP(n) {
  const v = Math.round(Math.abs(Number(n) || 0));
  const m = Math.floor(v / 1e6), k = Math.floor((v % 1e6) / 1000), u = v % 1000;
  const parts = [];
  if (m) parts.push(m === 1 ? '1 millón' : `${m} millones`);
  if (k) parts.push(`${k} mil`);
  if (u || !parts.length) parts.push(String(u));
  return `${parts.join(' ')} pesos`;
}

/** "Pago en 27 días · 15 dic" / "Pago hoy · 18 nov" / "Corte mañana · 19 nov" */
export function relDate(label, iso, today) {
  if (!iso) return '';
  const d = diffDays(today, iso);
  const rel = d < 0 ? `vencido hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`;
  return `${label} ${rel} · ${dateShort(iso)}`;
}

const debtOf = (c) => Math.max(0, Number(c.debt) || 0);
const usageOf = (c) => Number(c.usage_pct) || 0;

/** Anillo pequeño de uso (SVG) */
export function usageRing(pct, size = 22, stroke = 3) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  return html`<svg class="u-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="${stroke}"/>
    <circle class="u-ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--tone)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${(circ * (1 - p)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

/** Texto para lectores de pantalla */
export function cardLabel(c, { hidden = false, today } = {}) {
  const who = [c.bank, c.name !== c.bank ? c.name : null, c.nickname ? `apodo ${c.nickname}` : null].filter(Boolean).join(', ');
  const debt = hidden ? 'deuda oculta' : `deuda ${spokenCOP(debtOf(c))}`;
  const pay = c.next_due_date && today ? `, pago ${diffDays(today, c.next_due_date) <= 0 ? 'hoy' : `en ${diffDays(today, c.next_due_date)} días`}` : '';
  return `${who}${c.last4 ? `, terminada en ${c.last4.split('').join(' ')}` : ''}, ${debt}, uso ${Math.round(usageOf(c))} por ciento${pay}`;
}

/**
 * Frente de la tarjeta. opts: { hidden, today, tag: 'div'|'a', href, attrs }
 * La franja superior (.cc-strip) es lo único que se ve cuando la tarjeta está apilada.
 */
export function cardFront(c, { hidden = false, today } = {}) {
  const tone = usageTone(usageOf(c));
  const due = c.next_due_date && today ? relDate('Pago', c.next_due_date, today) : '';
  return html`<div class="cc-face cc-front">
    <span class="cc-sheen" aria-hidden="true"></span>
    <div class="cc-strip">
      <span class="cc-logo" aria-hidden="true">${monogram(c)}</span>
      <div class="cc-id">
        <div class="cc-bank"><span class="ellipsis">${c.bank || c.name}</span><span class="cc-brand-sm">${brandMark(c.brand)}</span></div>
        <div class="cc-sub ellipsis">${c.emoji ? html`<span class="cc-emoji">${c.emoji}</span>` : ''}${c.nickname || (c.bank ? c.name : '')}${c.last4 ? html`<span class="cc-l4 num">•••• ${c.last4}</span>` : ''}</div>
      </div>
      <div class="cc-amt">
        <b class="num cc-debt">${sensitiveAmount(debtOf(c), { hidden })}</b>
        <span class="cc-use tone-${tone}">${usageRing(usageOf(c), 12, 2.5)}<span class="num">${percent(usageOf(c))}</span></span>
      </div>
    </div>
    <div class="cc-body">
      <div class="cc-chiprow"><span class="cc-chip" aria-hidden="true"></span><span class="cc-nfc" aria-hidden="true">${raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M5 10a2.5 2.5 0 0 1 0 4"/></svg>')}</span>
        ${Number(c.debt) < 0 ? html`<span class="cc-favor">Saldo a favor ${sensitiveAmount(-Number(c.debt), { hidden })}</span>` : ''}</div>
      <div class="cc-foot">
        <div class="cc-avail"><span>Disponible</span><b class="num">${sensitiveAmount(c.available, { hidden })}</b></div>
        <div class="cc-due">${due}</div>
        <span class="cc-brand">${brandMark(c.brand)}</span>
      </div>
    </div>
    <span class="cc-meter tone-${tone}" style="--p:${Math.min(100, usageOf(c))}%" aria-hidden="true"></span>
  </div>`;
}

/** Reverso: cupo, disponible, uso, corte, pago, mínimo y acciones rápidas */
export function cardBack(c, { hidden = false, today } = {}) {
  const tone = usageTone(usageOf(c));
  const min = minimumPayment(c);
  const stat = (label, value) => html`<div class="cb-stat"><span>${label}</span><b class="num">${value}</b></div>`;
  return html`<div class="cc-face cc-back" aria-hidden="true">
    <span class="cc-stripe" aria-hidden="true"></span>
    <div class="cb-grid">
      ${stat('Cupo', sensitiveAmount(c.credit_limit, { hidden }))}
      ${stat('Disponible', sensitiveAmount(c.available, { hidden }))}
      <div class="cb-stat"><span>Uso</span><b class="num tone-txt-${tone}">${percent(usageOf(c))}</b></div>
      ${stat('Corte', c.next_cut_date ? html`${today ? `${diffDays(today, c.next_cut_date) <= 0 ? 'Hoy' : `${diffDays(today, c.next_cut_date)} d`}` : ''} · ${dateShort(c.next_cut_date)}` : '—')}
      ${stat('Pago', c.next_due_date ? html`${today ? `${diffDays(today, c.next_due_date) <= 0 ? 'Hoy' : `${diffDays(today, c.next_due_date)} d`}` : ''} · ${dateShort(c.next_due_date)}` : '—')}
      ${stat(c.min_payment ? 'Mínimo' : 'Mínimo aprox.', min ? sensitiveAmount(min, { hidden }) : '—')}
    </div>
    <div class="cb-actions">
      <button class="cb-act" data-act="pay" tabindex="-1">${icon('check', { size: 18 })}<span>Pagar</span></button>
      <button class="cb-act" data-act="movements" tabindex="-1">${icon('list', { size: 18 })}<span>Movimientos</span></button>
      <button class="cb-act" data-act="installments" tabindex="-1">${icon('layers', { size: 18 })}<span>Cuotas</span></button>
      <button class="cb-act" data-act="simulate" tabindex="-1">${icon('percent', { size: 18 })}<span>Simular</span></button>
    </div>
  </div>`;
}

/** Estilo en línea de una tarjeta (tema) */
export function cardStyle(c) {
  const t = cardTheme(c);
  return `--c:${t.c};--c2:${t.c2}`;
}
export function cardClass(c) {
  const t = cardTheme(c);
  return `cc fin-${t.finish} ${t.light ? 'cc-light' : 'cc-dark'}`;
}

/** Tarjeta completa (frente + reverso) con su contenedor 3D */
export function creditCard(c, { hidden = false, today, flipped = false, attrs = '' } = {}) {
  return html`<div class="${cardClass(c)}${flipped ? ' flipped' : ''}" style="${cardStyle(c)}" data-card="${c.id}" ${raw(attrs)}>
    <div class="cc-flip">${cardFront(c, { hidden, today })}${cardBack(c, { hidden, today })}</div>
  </div>`;
}

export { BRAND_NAME };
