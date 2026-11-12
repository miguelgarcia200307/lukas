// Respuestas cortas de la conversación por voz que se resuelven en código, SIN llamar al LLM:
// confirmar ("sí", "dale", "guárdalo"), cancelar ("cancela"), negar ("no"), pausar ("espera"), dudar ("de pronto")
// y montos sueltos ("8 mil"). Solo se aplican cuando la app dice qué espera (hay tarjetas por confirmar o con monto
// pendiente). La app decide qué hacer con cada una (máquina de estados en js/voice/dialog.js).
import { normalizeText } from "./normalize.ts";

export type Expect = "amount" | "confirm";
/**
 * confirm: "sí" · cancel: "cancela" · deny: un "no" a secas (la app cancela si preguntó "¿Lo guardo?")
 * stop: "espera", "todavía no" (pausa: deja las tarjetas) · unclear: "de pronto", "no sé" (la app vuelve a preguntar una vez)
 * amount: monto suelto para una tarjeta pendiente
 */
export type Quick = { intent: "confirm" | "cancel" | "deny" | "stop" | "unclear" | "amount"; amount?: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (s: string) => fold(s).replace(/[^a-z0-9ñ$ ]+/g, " ").replace(/\bde una\b/g, "dale").split(/\s+/).filter(Boolean);

// Palabras que por sí solas confirman / cancelan / niegan / pausan, y relleno que puede acompañarlas
const CONFIRM = new Set(["si", "sii", "sip", "sisas", "dale", "listo", "ok", "okay", "okey", "vale", "claro", "perfecto", "correcto", "exacto",
  "confirmo", "confirma", "confirmalo", "confirmalos", "guarda", "guardalo", "guardalos", "guardala", "guardalas", "guardar", "hagale", "hagamosle", "sale", "afirmativo"]);
const CANCEL = new Set(["cancela", "cancelalo", "cancelalos", "cancelar", "cancelado", "olvidalo", "olvida", "borra", "borralo", "borralos", "descarta", "descartalo", "descartalos", "anula", "anulalo"]);
const NO = new Set(["no", "nop", "nel", "noo", "nones", "negativo"]);
const STOP = new Set(["espera", "esperate", "espere", "pausa", "para", "detente", "todavia", "aun", "despues", "luego", "momento"]);
// Respuestas dudosas: no se ejecuta ni se cancela nada; la app vuelve a preguntar
const HEDGE = /\b(de pronto|tal vez|talvez|quiza|quizas|puede ser|no se|no estoy segur[oa]|a lo mejor|ni idea|mas o menos|creo|depende|posiblemente|probablemente)\b/;
const HEDGE_TOKENS = new Set(["de", "pronto", "tal", "vez", "talvez", "quiza", "quizas", "puede", "ser", "se", "estoy", "seguro", "segura", "a", "lo",
  "mejor", "ni", "idea", "mas", "o", "menos", "creo", "que", "depende", "posiblemente", "probablemente"]);
// "lucas"/"lukas": el usuario le habla a Lukas por su nombre ("sí, Lucas")
const FILLER = new Set(["de", "una", "por", "favor", "porfa", "todo", "bien", "esta", "asi", "eso", "es", "pues", "lukas", "lucas", "gracias", "los", "las", "lo", "la",
  "dos", "tres", "todos", "ambos", "ya", "y", "va", "entonces", "oye", "mmm", "mm", "hmm", "eh", "ehh", "ah", "un", "ahi", "hay", "senor", "parce", "mano", "nada", "mejor"]);

/** Clasifica una respuesta corta. null = no es una respuesta simple: que la resuelva el LLM. */
export function quickIntent(text: string, expect: Expect[]): Quick | null {
  const w = words(text);
  if (!w.length || w.length > 9 || !expect.length) return null;
  const has = (set: Set<string>) => w.some((x) => set.has(x));
  const onlyFrom = (...sets: Set<string>[]) => w.every((x) => FILLER.has(x) || sets.some((s) => s.has(x)));
  const hedged = HEDGE.test(w.join(" "));

  // Monto suelto ("8 mil", "ocho lucas", "sí, fueron 12.500"): manda sobre la confirmación si hay un monto pendiente
  if (expect.includes("amount") && !has(CANCEL) && !hedged && !(NO.has(w[0]) && w.length <= 2)) {
    const amounts = normalizeText(text).amounts;
    if (amounts.length === 1 && w.length <= 8) return { intent: "amount", amount: amounts[0] };
  }
  if (w.length > 6) return null;
  if (has(CANCEL) && onlyFrom(CANCEL, NO, STOP)) return { intent: "cancel" };
  if (hedged && onlyFrom(HEDGE_TOKENS, CONFIRM, NO)) return { intent: "unclear" }; // "de pronto", "de pronto sí", "no sé", "creo que no"
  if (has(STOP) && onlyFrom(STOP, NO)) return { intent: "stop" }; // "espera", "todavía no", "no, espera"
  if (has(NO) && has(CONFIRM) && onlyFrom(NO, CONFIRM)) return { intent: "unclear" }; // "sí… no": se contradice
  if (has(NO) && onlyFrom(NO)) return { intent: "deny" }; // "no", "mejor no", "no, Lucas"
  if (expect.includes("confirm") && has(CONFIRM) && onlyFrom(CONFIRM)) return { intent: "confirm" };
  if (onlyFrom()) return { intent: "unclear" }; // solo relleno ("mmm", "eh… Lucas"): no es una respuesta
  return null;
}

export function parseExpect(v: unknown): Expect[] {
  return String(v ?? "").split(",").map((s) => s.trim()).filter((s): s is Expect => s === "amount" || s === "confirm");
}
