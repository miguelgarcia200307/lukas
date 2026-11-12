// Módulo de conversación de Lukas: los tres casos reales reportados y sus variantes. Uso: npm test
// Sin red: el LLM (Groq) se reemplaza por un fetch falso con la salida guionizada, así se ejercita el pipeline real
// (normalización → prompt → validación → propuestas) y se cuentan las llamadas (el consumo no puede subir).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from '../../supabase/functions/_shared/normalize.ts';
import { quickIntent } from '../../supabase/functions/_shared/quick.ts';
import { buildContext } from '../../supabase/functions/_shared/brain.ts';
import { runTurn } from '../../supabase/functions/_shared/pipeline.ts';
import { Dialog, IDLE, AWAITING_CONFIRMATION, EXECUTING } from '../../js/voice/dialog.js';
import { summaryLine, afterAmountLine, reaskLine, silenceLine } from '../../js/voice/talk.js';

// Categorías como las del seed (ids = claves para leer fácil); alias en el prompt: c1…c7 en este orden
const built = buildContext({
  name: null, def: 'acc',
  cats: [['food', 'Comida y restaurantes', 'expense', null, 'food'], ['groc', 'Mercado', 'expense', null, 'groceries'],
    ['clothes', 'Ropa', 'expense', null, 'clothes'], ['other', 'Otros', 'expense', null, 'other_expense'],
    ['tr_in', 'Transferencias recibidas', 'income', null, 'transfers_in'], ['oth_in', 'Otros ingresos', 'income', null, 'other_income'],
    ['salary', 'Salario', 'income', null, 'salary']],
  accs: [['acc', 'Efectivo', 'cash']], cards: [], debts: [], subs: [], goals: [], hints: [],
}, 'v1');
const A = built.toAlias; // id → alias ("clothes" → "c3")

/** LLM falso: cada llamada devuelve la siguiente salida guionizada (SSE como Groq) y guarda lo que recibió */
function fakeGroq(outputs) {
  const calls = [];
  const fetch = async (url, init) => {
    assert.match(String(url), /chat\/completions$/, 'solo se llama al chat (no hay otras APIs en un turno de texto)');
    const body = JSON.parse(init.body);
    calls.push(body);
    const content = outputs[calls.length - 1] ?? '';
    const enc = new TextEncoder();
    const sse = [{ choices: [{ delta: { content } }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }]
      .map((j) => `data: ${JSON.stringify(j)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(sse)); c.close(); } }), { status: 200 });
  };
  return { fetch, calls };
}
async function turn(text, outputs) {
  const g = fakeGroq(outputs);
  const real = globalThis.fetch;
  globalThis.fetch = g.fetch;
  const events = [];
  try {
    const out = await runTurn({
      text, built, apiKey: 'x', models: ['qwen/qwen3.8-27b'], now: new Date('2026-11-12T17:00:00Z'),
      rpc: async () => null, emit: (e, d) => events.push([e, d]),
    });
    const prompt = g.calls[0]?.messages.at(-1).content ?? '';
    return { out, calls: g.calls.length, said: prompt.slice(prompt.lastIndexOf('Usuario:')), events };
  } finally {
    globalThis.fetch = real;
  }
}
const line = (o) => JSON.stringify(o);

// ───────────────────────── Caso 1: "Lucas, compré una salchicha" ─────────────────────────
test('caso 1 · "Lucas, compré una salchicha": el nombre no se vuelve $1000 y la salchicha no termina en Ropa', async () => {
  const n = normalizeText('Lucas, compré una salchicha');
  assert.deepEqual(n.amounts, [], 'antes: "Lucas" → $1000');
  // Salida tal como se reportó: categoría Ropa. El léxico (salchicha → comida) la corrige sin otra llamada.
  const r = await turn('Lucas, compré una salchicha', [line({ k: 'g', d: 'Salchicha', c: A.clothes, q: '¿Cuánto te costó la salchicha?' })]);
  assert.equal(r.said, 'Usuario: Compré una salchicha', 'el LLM recibe la frase sin el nombre ni montos inventados');
  assert.equal(r.calls, 1);
  assert.equal(r.out.proposals.length, 1);
  const p = r.out.proposals[0];
  assert.equal(p.pending, true, 'sin monto: pregunta cuánto costó');
  assert.equal(p.amount, 0);
  assert.equal(p.category_id, 'food');
  assert.ok(p.category_alternatives.includes('clothes'), 'lo que eligió el modelo queda como alternativa a un toque');
});

test('caso 1 · transcripción errada "salicha": no se da por buena una categoría sin relación; Lukas lo dice', async () => {
  const r = await turn('Lucas, compré una salicha', [line({ k: 'g', d: 'Salicha', c: A.clothes, q: '¿Cuánto te costó la salicha?' })]);
  assert.equal(r.said, 'Usuario: Compré una salicha');
  const p = r.out.proposals[0];
  assert.equal(p.category_unsure, true, 'nada de lo dicho respalda "Ropa"');
  assert.ok(p.confidence < 0.6, 'la tarjeta muestra "Revisa"');
  // Al completar el monto por voz, Lukas pregunta en vez de guardar en silencio
  const done = { ...p, amount: 5000, pending: false, _status: 'pending' };
  assert.match(afterAmountLine(done, [done]), /No estoy seguro de la categoría/);
  assert.match(summaryLine([done]), /No estoy seguro de la categoría.*\?$/);
});

test('caso 1 · variante "compré una salchicha de 5.000"', async () => {
  assert.deepEqual(normalizeText('compré una salchicha de 5.000').amounts, [5000]);
  const r = await turn('compré una salchicha de 5.000', [line({ k: 'g', a: 5000, d: 'Salchicha', c: A.clothes })]);
  assert.equal(r.said, 'Usuario: compré una salchicha de $5000');
  assert.equal(r.out.proposals.length, 1);
  assert.equal(r.out.proposals[0].amount, 5000);
  assert.equal(r.out.proposals[0].category_id, 'food');
  assert.equal(r.calls, 1, 'sin reintentos: consumo igual');
  // Si el modelo elige Mercado o Comida, se respeta (las dos son coherentes) y no se marca como dudosa
  for (const c of [A.groc, A.food]) {
    const ok = await turn('compré una salchicha de 5.000', [line({ k: 'g', a: 5000, d: 'Salchicha', c })]);
    assert.equal(ok.out.proposals[0].category_id, built.toId[c]);
    assert.ok(!ok.out.proposals[0].category_unsure);
  }
});

// ───────────────────────── Caso 2: "Lucas, recibí 320.000 pesos" ─────────────────────────
test('caso 2 · "Lucas, recibí 320.000 pesos": un único ingreso de $320.000', async () => {
  const n = normalizeText('Lucas, recibí 320.000 pesos');
  assert.deepEqual(n.amounts, [320000], 'antes: [1000, 320000] (el $1000 salía de "Lucas")');
  const r = await turn('Lucas, recibí 320.000 pesos', [line({ k: 'i', a: 320000, d: 'Transferencia recibida', c: A.tr_in })]);
  assert.equal(r.said, 'Usuario: Recibí $320000');
  assert.equal(r.calls, 1);
  assert.equal(r.out.proposals.length, 1);
  assert.equal(r.out.proposals[0].type, 'income');
  assert.equal(r.out.proposals[0].amount, 320000);
});

test('caso 2 · si el modelo repite el gasto de $1000 reportado, nunca se propone ese monto', async () => {
  const hallucinated = [line({ k: 'g', a: 1000, d: 'Gasto', c: A.other }), line({ k: 'i', a: 320000, d: 'Transferencia recibida', c: A.tr_in })].join('\n');
  // a) el reintento (que ya existía: solo ocurre cuando el modelo inventa) descarta la línea
  const a0 = await turn('Lucas, recibí 320.000 pesos', [hallucinated, '']);
  assert.deepEqual(a0.out.proposals.map((p) => [p.type, p.amount]), [['income', 320000]]);
  // a') …o reenvía la lista completa sin el gasto: el ingreso ya aceptado no se suma dos veces (antes daba $640.000)
  const a = await turn('Lucas, recibí 320.000 pesos', [hallucinated, line({ k: 'i', a: 320000, d: 'Transferencia recibida', c: A.tr_in })]);
  assert.deepEqual(a.out.proposals.map((p) => [p.type, p.amount]), [['income', 320000]]);
  // b) el modelo insiste: el gasto queda pendiente preguntando el monto, nunca con $1000
  const b = await turn('Lucas, recibí 320.000 pesos', [hallucinated, line({ k: 'g', a: 1000, d: 'Gasto', c: A.other })]);
  assert.ok(!b.out.proposals.some((p) => p.amount === 1000), 'ningún monto que el usuario no dijo');
  assert.equal(b.out.proposals.filter((p) => p.amount > 0).length, 1);
  assert.ok(b.calls <= 2, 'como máximo el reintento que ya existía');
});

test('caso 2 · variantes "recibí 320 mil" y "me llegaron trescientos veinte mil pesos"', async () => {
  for (const [t, said] of [['recibí 320 mil', 'Usuario: recibí $320000'], ['me llegaron trescientos veinte mil pesos', 'Usuario: me llegaron $320000']]) {
    assert.deepEqual(normalizeText(t).amounts, [320000], t);
    const r = await turn(t, [line({ k: 'i', a: 320000, d: 'Ingreso', c: A.oth_in })]);
    assert.equal(r.said, said);
    assert.deepEqual(r.out.proposals.map((p) => [p.type, p.amount]), [['income', 320000]], t);
  }
  // Si el modelo solo pregunta, el ingreso explícito se registra sin preguntar (antes el $1000 lo impedía: 2 montos)
  const q = await turn('Lucas, recibí 320.000 pesos', [line({ k: '?', q: '¿De qué fue esa plata?' })]);
  assert.deepEqual(q.out.proposals.map((p) => [p.type, p.amount]), [['income', 320000]]);
  assert.equal(q.out.question, null);
});

test('normalización: "Lucas"/"Lukas" como nombre nunca es plata; la jerga "lucas" con cantidad sí', () => {
  for (const [t, amounts] of [
    ['Lucas, recibí 320.000 pesos', [320000]], ['lucas recibí trescientos veinte mil', [320000]], ['Oye Lucas, me gasté 20 mil', [20000]],
    ['recibí 320 mil, Lucas', [320000]], ['recibí 320 mil Lucas', [320000]], ['recibí 320.000 Lucas', [320000]],
    ['sí, Lucas', []], ['Lucas', []], ['gracias Lucas', []],
    ['me gasté 30 lucas', [30000]], ['dieciocho lucas', [18000]], ['luca y media', [1500]], ['Pagué luca y media por un tinto', [1500]],
    ['Me cobraron una luca por la bolsa', [1000]], ['ocho lucas', [8000]],
  ]) assert.deepEqual(normalizeText(t).amounts, amounts, t);
});

// ───────────────────────── Caso 3: conversación manos libres ─────────────────────────
// La función transcribe y clasifica la respuesta con quickIntent (sin LLM); la app decide con la máquina de estados.
const answer = (d, transcript, { missing = false } = {}) => {
  const q = quickIntent(transcript, missing ? ['amount', 'confirm'] : ['confirm']);
  assert.ok(q, `"${transcript}" se resuelve en código, sin llamar al LLM`);
  return d.resolve(q, { missing });
};
const asked = () => { const d = new Dialog(); d.ask({ missing: false }); return d; }; // Lukas: "¿Lo guardo?"

test('caso 3 · "sí" ejecuta (también "Sí, Lucas.")', () => {
  for (const t of ['Sí.', 'sí', 'Sí, Lucas.', 'dale', 'listo', 'correcto', 'Sí, guárdalo']) {
    const d = asked();
    assert.equal(d.state, AWAITING_CONFIRMATION);
    assert.equal(answer(d, t).action, 'execute', t);
    assert.equal(d.state, EXECUTING);
    assert.equal(answer(d, 'sí').action, 'none', 'un segundo "sí" mientras guarda no guarda dos veces');
    d.executed();
    assert.equal(d.state, IDLE);
  }
});

test('caso 3 · "no" cancela', () => {
  for (const t of ['No.', 'no', 'No, Lucas.', 'mejor no', 'cancela', 'no, cancela todo']) {
    const d = asked();
    assert.equal(answer(d, t).action, 'cancel', t);
    assert.equal(d.state, IDLE);
  }
  // "espera" no descarta: pausa y deja las tarjetas en pantalla
  assert.equal(answer(asked(), 'espera').action, 'pause');
});

test('caso 3 · "de pronto" vuelve a preguntar UNA vez; si sigue la duda, pausa sin guardar ni borrar', () => {
  const d = asked();
  assert.equal(answer(d, 'De pronto.').action, 'reask');
  assert.equal(d.state, AWAITING_CONFIRMATION, 'la acción pendiente sigue en memoria');
  assert.equal(answer(d, 'de pronto').action, 'pause');
  assert.equal(d.state, IDLE);
  // Tras la re-pregunta, un "sí" claro sí ejecuta
  const d2 = asked();
  assert.equal(answer(d2, 'de pronto').action, 'reask');
  assert.equal(answer(d2, 'sí').action, 'execute');
  // Otras dudas
  for (const t of ['tal vez', 'no sé', 'de pronto sí', 'creo que sí', 'mmm', 'sí… no']) assert.equal(answer(asked(), t).action, 'reask', t);
  assert.match(reaskLine([{ kind: 'transaction', amount: 5000, _status: 'pending' }]), /Dime sí o no\.$/);
});

test('caso 3 · silencio: re-pregunta una vez y luego pausa (sin llamadas: no se envía audio)', () => {
  const d = asked();
  assert.equal(d.silence().action, 'reask');
  assert.equal(d.silence().action, 'pause');
  assert.equal(d.state, IDLE);
  assert.equal(new Dialog().silence().action, 'end', 'si Lukas no esperaba respuesta, la escucha termina');
  assert.match(silenceLine([{ kind: 'transaction', amount: 5000, _status: 'pending' }]), /^¿(Sigues ahí|Me escuchas)\? .*Dime sí o no\.$/);
});

test('caso 3 · con un monto pendiente: "sí" pide el monto, "no" no borra, el monto completa; "Lucas, sí" ya no es $1000', () => {
  const d = new Dialog();
  d.ask({ missing: true }); // "¿Cuánto te costó la salchicha?"
  assert.equal(answer(d, 'Lucas, sí', { missing: true }).action, 'ask_amount', 'antes: monto de $1000');
  assert.deepEqual(answer(d, '5 mil', { missing: true }), { action: 'amount', amount: 5000 });
  assert.deepEqual(answer(d, 'cinco lucas', { missing: true }), { action: 'amount', amount: 5000 });
  assert.equal(answer(d, 'no', { missing: true }).action, 'pause');
});

test('caso 3 · una respuesta con contenido sigue yendo al LLM (corrige o agrega)', () => {
  assert.equal(quickIntent('no, eran 20 mil de almuerzo', ['confirm']), null);
  assert.equal(quickIntent('sí pero cámbialo a hogar', ['confirm']), null);
});
