// Campo de monto con formato de miles en vivo ($ 30.000)
import { number, parseAmount } from '../utils/format.js';

export function bindAmountInput(input, { onChange } = {}) {
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'done');
  const fmt = () => {
    const v = parseAmount(input.value);
    const pos = input.value.length - (input.selectionStart ?? input.value.length);
    input.value = v ? number(v) : '';
    const caret = Math.max(0, input.value.length - pos);
    try { input.setSelectionRange(caret, caret); } catch { /* type sin selección */ }
    input.classList.remove('invalid');
    onChange?.(v);
  };
  input.addEventListener('input', fmt);
  if (input.value) fmt();
  return { get value() { return parseAmount(input.value); }, set value(v) { input.value = v ? number(v) : ''; } };
}

/** Ajusta el ancho del campo grande al contenido para que el "$" quede pegado */
export function autosizeAmount(input) {
  const resize = () => { input.style.width = `${Math.max(2, input.value.length || input.placeholder.length) + 0.5}ch`; };
  input.addEventListener('input', resize);
  resize();
}
