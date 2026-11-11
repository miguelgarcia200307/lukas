// Normalización determinística de montos en español colombiano (sin APIs de Deno: también corre en Node).
// "30 lucas" → $30000 · "medio palo" → $500000 · "veinte mil quinientos" → $20500 · "un millón doscientos" → $1200000
// "dos gaseosas" → 2 gaseosas · "30.000" → $30000 · "30k" → $30000. El LLM recibe montos ya claros.

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const SMALL: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const TENS = new Set([30, 40, 50, 60, 70, 80, 90]);
// Unidades de dinero coloquiales (multiplicador)
const SLANG: Record<string, number> = {
  luca: 1000, lucas: 1000, luquita: 1000, luquitas: 1000, barra: 1000, barras: 1000, k: 1000,
  palo: 1_000_000, palos: 1_000_000, melon: 1_000_000, melones: 1_000_000,
};
const MILLION = new Set(["millon", "millones"]);

interface Tok { raw: string; f: string; kind: "word" | "num" | "space" | "punct" }

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /\$?\s?\d+(?:[.,]\d+)*(?:\s?[kK]\b)?|[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|\s+|[^\sA-Za-zÁÉÍÓÚÜÑáéíóúüñ\d]+/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const kind = /^\s+$/.test(raw) ? "space" : /\d/.test(raw) ? "num" : /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/.test(raw) ? "word" : "punct";
    out.push({ raw, f: fold(raw), kind });
  }
  return out;
}

/** "30.000" → 30000 · "1,5" → 1.5 · "4.200" → 4200 · "$30.000" → 30000 · "30k" → {n:30, k:true} */
function parseDigits(raw: string): { n: number; k: boolean; money: boolean } | null {
  const money = raw.includes("$");
  const k = /[kK]\s*$/.test(raw);
  let s = raw.replace(/[$kK\s]/g, "").replace(/[.,]+$/, "");
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
  else if (/^\d+[.,]\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (/[.,]/.test(s)) s = s.replace(/[.,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? { n, k, money: money || /[.,]\d{3}/.test(raw) } : null;
}

export interface Normalized { text: string; amounts: number[]; numbers: number[] }

/**
 * Reescribe montos y números a cifras. Devuelve el texto y la lista de montos/números encontrados
 * (sirve para verificar que el LLM no invente montos).
 */
export function normalizeText(input: string): Normalized {
  const toks = tokenize(input.replace(/\s+/g, " ").trim());
  const out: string[] = [];
  const amounts: number[] = [];
  const numbers: number[] = [];
  let i = 0;

  const isNumTok = (t?: Tok) => !!t && (t.kind === "num" || (t.kind === "word" && t.f in SMALL));
  const isUnit = (t?: Tok) => !!t && t.kind === "word" && (t.f === "mil" || MILLION.has(t.f) || t.f in SLANG);
  // ¿la palabra en j es "medio"/"media" de una unidad? ("medio palo", "media luca")
  const nextWord = (j: number) => { let k = j + 1; while (toks[k]?.kind === "space") k++; return k; };

  while (i < toks.length) {
    const t = toks[i];
    const startsNumber = isNumTok(t) || (t.kind === "word" && (t.f === "mil" || t.f === "medio" || t.f === "media" || MILLION.has(t.f) || (t.f in SLANG && t.f !== "k")));
    if (!startsNumber) { out.push(t.raw); i++; continue; }

    // Consumir la frase numérica más larga posible
    let total = 0, current = 0, afterMillion = false, milAfterMillion = false, money = false, any = false, onlyArticle = true;
    let lastSmall = -1, unitOfLast = 0, consumed = i, digitsMoney = false, hasDigitNum = false;
    let j = i;
    let half = false;

    while (j < toks.length) {
      const tk = toks[j];
      if (tk.kind === "space") { j++; continue; }
      if (tk.kind === "num") {
        const d = parseDigits(tk.raw);
        if (!d) break;
        if (any && lastSmall >= 0 && !(TENS.has(lastSmall) === false) && current % 1000 !== 0) break;
        // dos cifras seguidas sin unidad en medio ("30 35") no se unen, salvo "20 mil 500"
        if (any && current !== 0 && unitOfLast === 0) break;
        current += d.n;
        if (d.k) { current *= 1000; money = true; unitOfLast = 1000; } else unitOfLast = 0;
        if (d.money || d.n >= 1000) digitsMoney = true;
        hasDigitNum = true;
        any = true; onlyArticle = false; lastSmall = d.n; consumed = j; j++;
        continue;
      }
      if (tk.kind !== "word") break;
      const f = tk.f;
      if (f in SMALL) {
        const v = SMALL[f];
        // "treinta y cinco": la "y" la consumimos abajo; aquí no unimos "cinco cinco"
        if (any && unitOfLast === 0 && lastSmall >= 0) {
          const ok = (lastSmall >= 100 && lastSmall % 100 === 0 && v < 100) || (TENS.has(lastSmall) && v < 10 && v > 0 && toks[j - 2]?.f === "y");
          if (!ok) break;
        }
        current += v;
        if (!(f === "un" || f === "una" || f === "uno")) onlyArticle = false;
        any = true; lastSmall = v; unitOfLast = 0; consumed = j; j++;
        // "y" entre decena y unidad
        const k1 = nextWord(j - 1);
        if (TENS.has(v) && toks[k1]?.f === "y") {
          const k2 = nextWord(k1);
          if (toks[k2]?.kind === "word" && SMALL[toks[k2].f] > 0 && SMALL[toks[k2].f] < 10) { j = k2; continue; }
        }
        continue;
      }
      if (f === "medio" || f === "media") {
        // "medio palo", "media luca", "medio millón"
        const k1 = nextWord(j);
        const nf = toks[k1]?.f;
        if (!any && nf && (nf in SLANG || MILLION.has(nf))) { current = 0.5; any = true; onlyArticle = false; consumed = j; j = k1; continue; }
        break;
      }
      if (f === "mil") {
        if (toks[nextWord(j)]?.f === "gracias") break;
        current = (current || 1) * 1000;
        if (afterMillion) milAfterMillion = true;
        money = true; any = true; onlyArticle = false; unitOfLast = 1000; lastSmall = -1; consumed = j; j++;
        if (current >= 1000) { total += current; current = 0; }
        continue;
      }
      if (MILLION.has(f) || (f in SLANG && f !== "k")) {
        const mult = MILLION.has(f) ? 1_000_000 : SLANG[f];
        // "2 barras de chocolate", "un palo de escoba": no es dinero si sigue "de" + palabra (no cifra)
        if ((f === "barra" || f === "barras" || f === "palo" || f === "palos") && toks[nextWord(j)]?.f === "de") {
          const k2 = nextWord(nextWord(j));
          if (toks[k2] && !isNumTok(toks[k2])) break;
        }
        if (!any && !(f in SLANG)) break;
        const base = (current || 1) * mult;
        total += base; current = 0;
        if (mult === 1_000_000) afterMillion = true;
        money = true; any = true; onlyArticle = false; unitOfLast = mult; lastSmall = -1; consumed = j; j++;
        // "y medio" / "y media"
        const k1 = nextWord(j - 1);
        if (toks[k1]?.f === "y") {
          const k2 = nextWord(k1);
          if (toks[k2]?.f === "medio" || toks[k2]?.f === "media") { total += mult / 2; half = true; consumed = k2; j = k2 + 1; }
        }
        continue;
      }
      break;
    }

    if (!any || onlyArticle && !money) { out.push(t.raw); i++; continue; }

    // "un millón doscientos" (sin "mil") = 1.200.000
    if (afterMillion && !milAfterMillion && current > 0 && current < 1000) current *= 1000;
    let value = Math.round(total + current);
    void half;
    const isMoney = money || digitsMoney;
    // Reconstruir: conservar espacios/puntuación que haya después de la frase
    const lead = /^\s/.test(t.raw) ? " " : "";
    out.push(lead + (isMoney ? `$${value}` : String(value)));
    if (isMoney) amounts.push(value);
    numbers.push(value);
    i = consumed + 1;
    // quitar "pesos" justo después de un monto
    const k1 = nextWord(consumed);
    if (isMoney && toks[k1]?.f === "pesos") i = k1 + 1;
    void hasDigitNum;
  }

  const text = out.join("").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return { text, amounts, numbers };
}

/** ¿El monto se puede explicar con los números que dijo el usuario? (exacto, suma de algunos, o cantidad × precio) */
export function amountSupported(amount: number, said: number[], itemsTotal?: number): boolean {
  if (!(amount > 0)) return false;
  if (itemsTotal && itemsTotal === amount) return true;
  const vals = [...new Set(said.filter((n) => n > 0))].slice(0, 14);
  if (vals.includes(amount)) return true;
  const small = vals.filter((n) => Number.isInteger(n) && n >= 2 && n <= 50);
  for (const q of small) for (const v of vals) if (q * v === amount) return true;
  const big = vals.filter((n) => n >= 100);
  const n = big.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    for (let b = 0; b < n; b++) if (mask & (1 << b)) s += big[b];
    if (s === amount) return true;
  }
  return false;
}
