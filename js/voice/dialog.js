// Máquina de estados de la conversación por voz (local, sin red, cero tokens): qué le preguntó Lukas al usuario y qué
// hacer con la respuesta corta que la función ya clasificó en código (quick.ts: confirm · deny · cancel · stop ·
// unclear · amount). La acción pendiente son las tarjetas que están en pantalla (VoiceSession.proposals).
//
//   IDLE ──Lukas pregunta "¿Lo guardo?"──▶ AWAITING_CONFIRMATION ──"sí"──▶ EXECUTING ──guardado/falló──▶ IDLE
//     │                                      │ "no" / "cancela" → cancelar   · "espera" → pausar (deja las tarjetas)
//     │                                      │ "de pronto" / "no sé" → re-preguntar UNA vez; la segunda → pausar
//     │                                      │ silencio → re-preguntar UNA vez; el segundo → pausar
//     └──Lukas pregunta "¿Cuánto costó…?"──▶ AWAITING_AMOUNT ──monto──▶ (siguiente pregunta) · "sí" → pide el monto
//                                            "no" → pausar (no se descarta lo que falta por completar)

export const IDLE = 'idle';
export const AWAITING_CONFIRMATION = 'awaiting_confirmation';
export const AWAITING_AMOUNT = 'awaiting_amount';
export const EXECUTING = 'executing';

/** Máximo de re-preguntas por respuesta dudosa y por silencio (cada una), antes de pausar */
export const MAX_REPROMPTS = 1;

export class Dialog {
  constructor() { this.reset(); }

  reset() {
    this.state = IDLE;
    this.reprompts = 0;
    this.silences = 0;
  }

  /** Lukas acaba de preguntar. missing: hay tarjetas sin monto (pregunta por el monto); si no, pide confirmar. */
  ask({ missing = false } = {}) {
    const next = missing ? AWAITING_AMOUNT : AWAITING_CONFIRMATION;
    if (next !== this.state) { this.reprompts = 0; this.silences = 0; } // otra pregunta: contadores nuevos
    this.state = next;
    return this.state;
  }

  get waiting() { return this.state === AWAITING_CONFIRMATION || this.state === AWAITING_AMOUNT; }

  /**
   * Respuesta corta ya clasificada → acción para la interfaz:
   * 'execute' | 'cancel' | 'pause' | 'reask' | 'amount' | 'ask_amount'.
   * Funciona también desde IDLE (el usuario tocó el orbe y respondió "sí" a las tarjetas en pantalla).
   */
  resolve(quick, { missing = false } = {}) {
    if (this.state === EXECUTING) return { action: 'none' }; // ya se está guardando: un segundo "sí" no guarda dos veces
    if (this.state === IDLE) this.state = missing ? AWAITING_AMOUNT : AWAITING_CONFIRMATION; // respondió tras tocar el orbe
    const awaitingAmount = missing; // lo que está en pantalla manda (pudo completar el monto escribiéndolo)
    switch (quick?.intent) {
      case 'amount':
        if (quick.amount > 0) { this.reprompts = 0; this.silences = 0; return { action: 'amount', amount: quick.amount }; }
        return this.unclear();
      case 'confirm':
        if (missing) { this.state = AWAITING_AMOUNT; return { action: 'ask_amount' }; }
        this.state = EXECUTING;
        return { action: 'execute' };
      case 'cancel':
        this.reset();
        return { action: 'cancel' };
      case 'deny':
        // "¿Lo guardo?" → "no": no se guarda nada. "¿Cuánto costó?" → "no": se pausa (no se borra lo pendiente)
        this.reset();
        return { action: awaitingAmount ? 'pause' : 'cancel' };
      case 'stop':
        this.reset();
        return { action: 'pause' };
      case 'unclear':
        return this.unclear();
      default:
        this.reset();
        return { action: 'pause' };
    }
  }

  unclear() {
    if (this.reprompts < MAX_REPROMPTS) { this.reprompts++; return { action: 'reask' }; }
    this.reset();
    return { action: 'pause' };
  }

  /** No habló en la escucha automática: re-pregunta una vez si estaba esperando una respuesta; si no, termina */
  silence() {
    if (!this.waiting) return { action: 'end' };
    if (this.silences < MAX_REPROMPTS) { this.silences++; return { action: 'reask' }; }
    this.reset();
    return { action: 'pause' };
  }

  /** Terminó de guardar (bien o mal) */
  executed() { this.reset(); }
}
