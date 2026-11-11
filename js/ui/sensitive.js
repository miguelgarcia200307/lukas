// Montos sensibles (modo privado). Cuando están ocultos se pinta una máscara de longitud FIJA en lugar del valor:
// el monto real no queda en el DOM ni en el árbol de accesibilidad (nada de blur, opacity ni color transparente),
// y la longitud constante no deja deducir el orden de magnitud.
import { html } from '../utils/dom.js';
import { money } from '../utils/format.js';

export const MASK = '$••••••';

/** Solo el número: visible → valor formateado; oculto → máscara (decorativa para lectores de pantalla) */
export function sensitiveAmount(value, { hidden = false, format = money } = {}) {
  return hidden
    ? html`<span class="sens is-masked" aria-hidden="true">${MASK}</span>`
    : html`<span class="sens">${format(value)}</span>`;
}

/**
 * Línea con contexto ("Debes $1.469.000", "$63.800 al mes"): el texto alrededor se mantiene y solo cambia el número.
 * Oculto, el lector de pantalla oye `srHidden` ("saldo oculto") en lugar de los puntos uno por uno.
 */
export function sensitiveLine(value, { hidden = false, before = '', after = '', format = money, srHidden = 'saldo oculto' } = {}) {
  if (!hidden) return html`${before}${sensitiveAmount(value, { format })}${after}`;
  return html`<span aria-hidden="true">${before}${sensitiveAmount(value, { hidden: true })}${after}</span><span class="sr-only">${srHidden}</span>`;
}
