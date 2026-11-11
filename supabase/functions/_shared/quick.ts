// Respuestas cortas de la conversación por voz que se resuelven en código, SIN llamar al LLM:
// confirmar ("sí", "dale", "guárdalo"), cancelar ("cancela"), pausar ("no", "espera") y montos sueltos ("8 mil").
// Solo se aplican cuando la app dice qué espera (hay tarjetas por confirmar o con monto pendiente).
import { normalizeText } from "./normalize.ts";

export type Expect = "amount" | "confirm";
export type Quick = { intent: "confirm" | "cancel" | "stop" | "amount"; amount?: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const words = (s: string) => fold(s).replace(/[^a-z0-9ñ$ ]+/g, " ").replace(/\bde una\b/g, "dale").split(/\s+/).filter(Boolean);

// Palabras que por sí solas confirman / cancelan / pausan, y relleno que puede acompañarlas
const CONFIRM = new Set(["si", "sii", "sip", "sisas", "dale", "listo", "ok", "okay", "okey", "vale", "claro", "perfecto", "correcto", "exacto",
  "confirmo", "confirma", "confirmalo", "confirmalos", "guarda", "guardalo", "guardalos", "guardala", "guardalas", "guardar", "hagale", "hagamosle", "sale", "afirmativo"]);
const CANCEL = new Set(["cancela", "cancelalo", "cancelalos", "cancelar", "cancelado", "olvidalo", "olvida", "borra", "borralo", "borralos", "descarta", "descartalo", "descartalos", "anula", "anulalo"]);
const STOP = new Set(["no", "nop", "nel", "noo", "espera", "esperate", "espere", "pausa", "para", "detente", "todavia", "aun", "despues", "luego", "momento", "mejor"]);
const FILLER = new Set(["de", "una", "por", "favor", "porfa", "todo", "bien", "esta", "asi", "eso", "es", "pues", "lukas", "gracias", "los", "las", "lo", "la",
  "dos", "tres", "todos", "ambos", "ya", "y", "va", "entonces", "oye", "mmm", "eh", "ah", "un", "ahi", "hay", "senor", "parce", "mano", "nada", "asi"]);

/** Clasifica una respuesta corta. null = no es una respuesta simple: que la resuelva el LLM. */
export function quickIntent(text: string, expect: Expect[]): Quick | null {
  const w = words(text);
  if (!w.length || w.length > 9 || !expect.length) return null;
  const has = (set: Set<string>) => w.some((x) => set.has(x));
  const onlyFrom = (...sets: Set<string>[]) => w.every((x) => FILLER.has(x) || sets.some((s) => s.has(x)));

  // Monto suelto ("8 mil", "ocho lucas", "sí, fueron 12.500"): manda sobre la confirmación si hay un monto pendiente
  if (expect.includes("amount") && !has(CANCEL) && !(w[0] === "no" && w.length <= 2)) {
    const amounts = normalizeText(text).amounts;
    if (amounts.length === 1 && w.length <= 8) return { intent: "amount", amount: amounts[0] };
  }
  if (w.length > 6) return null;
  if (has(CANCEL) && onlyFrom(CANCEL, STOP)) return { intent: "cancel" };
  if (has(STOP) && onlyFrom(STOP)) return { intent: "stop" };
  if (expect.includes("confirm") && has(CONFIRM) && !has(STOP) && !has(CANCEL) && onlyFrom(CONFIRM)) return { intent: "confirm" };
  return null;
}

export function parseExpect(v: unknown): Expect[] {
  return String(v ?? "").split(",").map((s) => s.trim()).filter((s): s is Expect => s === "amount" || s === "confirm");
}
