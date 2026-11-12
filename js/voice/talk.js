// Frases habladas de Lukas generadas con plantillas (cero tokens): cortas (1–2 frases), variadas, en español
// colombiano y con los montos dichos como se hablan ("dieciséis mil pesos", no "$16.000").
import { categoryById } from '../state.js';

const U = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const T = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const H = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function under1000(n) {
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100), r = n % 100;
  const out = [];
  if (h) out.push(H[h]);
  if (r) out.push(r < 30 ? U[r] : `${T[Math.floor(r / 10)]}${r % 10 ? ` y ${U[r % 10]}` : ''}`);
  return out.join(' ');
}

/** 16000 → "dieciséis mil", 1250000 → "un millón doscientos cincuenta mil" */
export function numberWords(n) {
  const v = Math.round(Math.abs(Number(n) || 0));
  if (!v) return 'cero';
  const mill = Math.floor(v / 1e6), th = Math.floor((v % 1e6) / 1000), rest = v % 1000;
  const out = [];
  if (mill) out.push(mill === 1 ? 'un millón' : `${under1000(mill)} millones`);
  if (th) out.push(th === 1 ? 'mil' : `${under1000(th)} mil`);
  if (rest) out.push(under1000(rest));
  return out.join(' ');
}
/** 16000 → "dieciséis mil pesos", 2000000 → "dos millones de pesos" */
export const pesos = (n) => `${numberWords(n)}${n >= 1e6 && n % 1e6 === 0 ? ' de' : ''} ${Math.round(n) === 1 ? 'peso' : 'pesos'}`;
/** Texto con cifras ("$16.000") → texto para decir en voz alta */
export const speakable = (text) => String(text ?? '')
  .replace(/\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g, (_, d) => pesos(Number(d.replace(/\./g, ''))))
  .replace(/(\d+)%/g, (_, d) => `${numberWords(Number(d))} por ciento`)
  .replace(/\s+/g, ' ').trim();

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const countWords = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];
const join = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0] ?? '');
const active = (list) => list.filter((p) => !p._status || p._status === 'pending');
const missing = (p) => p.kind === 'transaction' && (p.pending || !(p.amount > 0));
const lower = (s) => String(s ?? '').toLowerCase();

function where(p) {
  if (p.kind === 'transaction') return `en ${lower(categoryById(p.category_id)?.name ?? p.description)}`;
  if (p.kind === 'card_payment') return 'de pago a la tarjeta';
  if (p.kind === 'debt_payment') return 'de cuota del crédito';
  if (p.kind === 'subscription') return `de ${p.name}`;
  return 'para tu meta';
}
/** Pregunta por el monto pendiente, sin "¿Y" si es lo primero que se dice */
function askFor(p, first) {
  const core = (p.question || `¿Cuánto costó ${lower(p.description)}?`).replace(/^¿\s*y\s+(.)/i, (m, c) => `¿${c.toUpperCase()}`);
  return first ? core : core.replace(/^¿(.)/, (m, c) => `¿Y ${c.toLowerCase()}`);
}
function confirmQuestion(n) {
  if (n <= 1) return pick(['¿Lo guardo?', '¿Lo guardo así?', '¿Te lo guardo?']);
  if (n === 2) return pick(['¿Guardo los dos?', '¿Te guardo los dos?', '¿Los guardo?']);
  return pick([`¿Guardo los ${countWords[n] ?? n}?`, '¿Los guardo todos?']);
}

// Categoría sin respaldo en lo que dijo el usuario (la marca la función): Lukas lo dice antes de pedir confirmación
const unsure = (p) => p.kind === 'transaction' && p.category_unsure && !missing(p);
const unsureNote = (list) => (list.some(unsure) ? 'No estoy seguro de la categoría, revísala.' : '');

/** Lo que Lukas dice al terminar un turno con tarjetas: resumen + la pregunta que sigue (monto o confirmar) */
export function summaryLine(list) {
  const act = active(list);
  const done = act.filter((p) => !missing(p));
  const pend = act.filter(missing);
  let first = '';
  if (done.length === 1) first = `${pick(['Genial', 'Listo', 'Perfecto', 'Anotado'])}, son ${pesos(done[0].amount)} ${where(done[0])}.`;
  else if (done.length > 1 && done.length <= 3) first = `${pick(['Listo', 'Anotado', 'Perfecto'])}: ${join(done.map((p) => `${numberWords(p.amount)} ${where(p)}`))}.`;
  else if (done.length > 3) first = `Anoté ${countWords[done.length] ?? done.length} movimientos por ${pesos(done.reduce((s, p) => s + p.amount, 0))}.`;
  const next = pend.length ? askFor(pend[0], !first) : confirmQuestion(act.length);
  return `${first} ${pend.length ? '' : unsureNote(done)} ${next}`.replace(/\s+/g, ' ').trim();
}

/** Tras completar un monto pendiente: "Listo, ocho mil en hogar. ¿Guardo los dos?" */
export function afterAmountLine(p, list) {
  const pend = active(list).filter(missing);
  const head = `${pick(['Listo', 'Anotado', 'Perfecto', 'Dale'])}, ${numberWords(p.amount)} ${where(p)}.`;
  return `${head} ${pend.length ? askFor(pend[0], false) : `${unsureNote(active(list))} ${confirmQuestion(active(list).length)}`}`.replace(/\s+/g, ' ').trim();
}

/** Respuesta dudosa ("de pronto"): vuelve a preguntar una sola vez, pidiendo un sí o un no */
export function reaskLine(list) {
  const pend = active(list).filter(missing);
  if (pend.length) return `${pick(['No te entendí bien.', 'Perdón, no te entendí.'])} ${askFor(pend[0], true)}`;
  return `${pick(['No te entendí bien.', 'Perdón, no te entendí.'])} ${confirmQuestion(active(list).length)} Dime sí o no.`;
}
/** No respondió en la escucha automática: una sola vez más */
export function silenceLine(list) {
  const pend = active(list).filter(missing);
  return `${pick(['¿Sigues ahí?', '¿Me escuchas?'])} ${pend.length ? askFor(pend[0], true) : `${confirmQuestion(active(list).length)} Dime sí o no.`}`;
}

export const savedLine = (n) => (n > 1 ? pick([`Listo, guardé los ${countWords[n] ?? n}.`, '¡Hecho! Quedaron guardados.', 'Listo, todo guardado.'])
  : pick(['¡Listo, guardado!', 'Hecho, quedó guardado.', 'Listo, ya quedó.']));
export const cancelledLine = () => pick(['Listo, lo cancelé.', 'Hecho, no guardé nada.', 'Dale, lo descarté.']);
export const pausedLine = () => pick(['Dale, te lo dejo en pantalla para que lo revises.', 'Listo, lo dejo aquí para que lo revises con calma.']);
export const notHeardAmountLine = () => pick(['No te entendí el monto. ¿Cuánto fue?', 'Perdón, ¿cuánto fue?', '¿Me repites el monto?']);
export const stillMissingLine = (p) => `${pick(['Antes de guardar', 'Primero'])}, ${askFor(p, true).replace(/^¿(.)/, (m, c) => `¿${c.toLowerCase()}`)}`;
export const testLine = () => 'Hola, soy Lukas. Anoté dieciséis mil pesos en mercado. ¿Lo guardo?';
