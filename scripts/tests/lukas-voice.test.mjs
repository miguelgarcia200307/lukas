// La voz de Lukas: frases del editor (js/lukas/lines.js) y redacción de notificaciones
// (supabase/functions/_shared/lukas-voice.ts). Uso: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, BY_ID, LOOKS, PALETTE } from '../../js/lukas/catalog.js';
import { ITEM_LINES, COLOR_LINES, LOOK_LINES, COMBOS, createChatter, fill } from '../../js/lukas/lines.js';
import * as voice from '../../supabase/functions/_shared/lukas-voice.ts';

const clean = (s) => typeof s === 'string' && s.length > 0 && !/[{}]|undefined|NaN|null/.test(s);
const fakeClock = (start = Date.UTC(2026, 10, 15, 15)) => {
  let t = start;
  return { now: () => new Date(t), tick: (ms) => { t += ms; } };
};

// ── Editor ──────────────────────────────────────────────
test('cada accesorio tiene al menos 4 frases propias y todo el catálogo está cubierto', () => {
  for (const it of ITEMS) assert.ok(ITEM_LINES[it.id]?.lines.length >= 4, `pocas frases: ${it.id}`);
  for (const id of Object.keys(ITEM_LINES)) assert.ok(BY_ID.has(id), `id desconocido: ${id}`);
  for (const c of COMBOS) for (const id of c.ids.flat()) assert.ok(BY_ID.has(id), `combo con id desconocido: ${id}`);
  for (const l of LOOKS) assert.ok(LOOK_LINES[l.id]?.length >= 3, `look sin frases: ${l.id}`);
  for (const p of PALETTE) assert.ok(COLOR_LINES[p.nombre]?.length >= 2, `color sin frases: ${p.nombre}`);
  const total = Object.values(ITEM_LINES).reduce((a, x) => a + x.lines.length, 0);
  assert.ok(total >= 260, `solo ${total} frases de accesorios`);
});

test('plantillas: mayúscula inicial, artículos y descarte si falta una variable', () => {
  assert.equal(fill('¿{El}? ¡Buena elección!', { el: 'la gorra' }), '¿La gorra? ¡Buena elección!');
  assert.equal(fill('{name}, ¡vísteme bonito!', { name: 'ana' }), 'Ana, ¡vísteme bonito!');
  assert.equal(fill('Tienes buen ojo, {name}', { name: '' }), null);
});

test('ponerse un accesorio: frase del accesorio, reacción y sin repetirse seguido', () => {
  const clk = fakeClock();
  const chat = createChatter({ now: clk.now });
  const it = BY_ID.get('corona');
  const seen = [];
  for (let i = 0; i < 12; i++) {
    clk.tick(30000); // sin "indeciso"
    const r = chat.equip({ prev: { cabello: 'afro' }, next: { cabello: 'afro', cabeza: 'corona' }, slot: 'cabeza', item: it });
    assert.ok(clean(r.text), r.text);
    assert.equal(r.react, 'presume');
    assert.ok(r.burst?.includes('👑'));
    if (seen.length) assert.notEqual(r.text, seen[seen.length - 1]);
    seen.push(r.text);
  }
  assert.ok(new Set(seen).size >= 8, `poca variedad: ${new Set(seen).size}`);
});

test('situaciones: combinación, volver a ponerse algo, indecisión y conflicto', () => {
  const clk = fakeClock();
  const chat = createChatter({ now: clk.now, rnd: () => 0.1 });
  const combo = chat.equip({ prev: { cabeza: 'vaquero' }, next: { cabeza: 'vaquero', vello: 'bigote' }, slot: 'vello', item: BY_ID.get('bigote') });
  assert.ok(COMBOS.find((c) => c.ids[0] === 'vaquero').lines.includes(combo.text), combo.text);

  chat.remove({ slot: 'gafas', item: BY_ID.get('aviador') });
  clk.tick(4000);
  const back = chat.equip({ prev: {}, next: { gafas: 'aviador' }, slot: 'gafas', item: BY_ID.get('aviador') });
  assert.match(back.text, /gafas de aviador/i);
  assert.match(back.text, /las extrañarías|lo mío|Reconciliación|Otra vez/);

  const chat2 = createChatter({ now: clk.now, rnd: () => 0.1 });
  let r;
  for (let i = 0; i < 6; i++) { clk.tick(800); r = chat2.equip({ prev: {}, next: { gafas: 'pixel' }, slot: 'gafas', item: BY_ID.get('pixel') }); }
  assert.match(r.text, /Indeciso|opinión|mareando|Pruébalo|Probador/);

  const c = chat2.equip({ prev: { vello: 'bigote' }, next: { gafas: 'nariz' }, slot: 'gafas', item: BY_ID.get('nariz'), removed: [BY_ID.get('bigote')] });
  assert.match(c.text, /bigote clásico/i);
});

test('cosquillas: suben de intensidad si siguen y se calman con el tiempo', () => {
  const clk = fakeClock();
  const chat = createChatter({ now: clk.now });
  const levels = [];
  for (let i = 0; i < 6; i++) { clk.tick(500); levels.push(chat.tickle().level); }
  assert.deepEqual(levels, [0, 0, 1, 1, 2, 2]);
  clk.tick(10000);
  assert.equal(chat.tickle().level, 0);
});

test('nombre, hora, consejos y guardado', () => {
  const morning = createChatter({ now: () => new Date(2026, 10, 16, 8), name: 'Miguel García', rnd: () => 0.99 });
  const texts = new Set();
  for (let i = 0; i < 25; i++) texts.add(morning.enter({}).text);
  assert.ok([...texts].some((t) => t.includes('Miguel')) || [...texts].some((t) => /días|Tinto|Arrancamos/.test(t)), [...texts].join(' | '));
  assert.ok(![...texts].some((t) => t.includes('García')), 'solo el primer nombre');

  const anon = createChatter();
  for (let i = 0; i < 40; i++) assert.ok(clean(anon.idle({ cfg: { cabeza: 'gorra' }, dirty: true, colorable: true, colorItem: BY_ID.get('gorra') }).text));
  for (let i = 0; i < 20; i++) {
    const s = anon.save({ cabeza: 'gorra', gafas: 'redondas' });
    assert.ok(clean(s.text) && s.burst);
  }
  assert.ok(clean(anon.save({}).text));
  for (const l of LOOKS) assert.ok(clean(anon.look(l.id).text));
  for (const p of PALETTE) assert.ok(clean(anon.color({ item: BY_ID.get('gorra'), hex: p.hex }).text));
  for (const it of ITEMS) {
    assert.ok(clean(anon.equip({ prev: {}, next: { [it.slot]: it.id }, slot: it.slot, item: it }).text), it.id);
    assert.ok(clean(anon.remove({ slot: it.slot, item: it }).text), it.id);
  }
});

// ── Notificaciones ─────────────────────────────────────
const seeds = Array.from({ length: 60 }, (_, i) => `u${i}:k${i}`);
const many = (fn) => seeds.map((s) => fn(voice.seeded(s)));
const okMsg = (m) => clean(m.title) && clean(m.body) && m.title.length <= 80 && m.body.length <= 220;
const variety = (msgs) => new Set(msgs.map((m) => m.title)).size;

test('notificaciones: misma semilla, mismo mensaje; otra semilla, otro', () => {
  const a = voice.cardDue({ rng: voice.seeded('x'), label: 'Visa Bancolombia', days: 1, debt: 850000 });
  const b = voice.cardDue({ rng: voice.seeded('x'), label: 'Visa Bancolombia', days: 1, debt: 850000 });
  assert.deepEqual(a, b);
  assert.ok(variety(many((rng) => voice.cardDue({ rng, label: 'Visa', days: 1, debt: 850000 }))) >= 3);
});

test('tarjetas, créditos y suscripciones: textos limpios y variados con datos reales', () => {
  for (const days of [0, 1]) {
    const cuts = many((rng) => voice.cardCut({ rng, name: 'Ana María', label: 'Visa Bancolombia', days, debt: 1200000, usagePct: 86 }));
    assert.ok(cuts.every(okMsg) && variety(cuts) >= 3);
    assert.ok(cuts.every((m) => /86%/.test(m.body)), 'avisa el uso alto del cupo');
    assert.ok(cuts.some((m) => m.title.includes('Ana')) && !cuts.some((m) => m.title.includes('María')));
  }
  const zero = voice.cardCut({ rng: voice.seeded('z'), label: 'Visa', days: 1, debt: 0, usagePct: 0 });
  assert.match(zero.body, /ceros|No debes/);
  for (const days of [0, 1, 3]) {
    const dues = many((rng) => voice.cardDue({ rng, label: 'Mastercard', days, debt: 500000, estInterest: 12000 }));
    assert.ok(dues.every(okMsg) && variety(dues) >= 3, `días ${days}`);
    assert.ok(dues.some((m) => m.body.includes('$12.000')), 'menciona intereses');
  }
  const last = voice.debtDue({ rng: voice.seeded('d'), debt: 'Moto', days: 1, payment: 300000, balance: 250000, progressPct: 95 });
  assert.match(last.body, /última cuota|terminarla/);
  const half = many((rng) => voice.debtDue({ rng, debt: 'Carro', days: 0, payment: 900000, balance: 9000000, progressPct: 62 }));
  assert.ok(half.every(okMsg) && half.every((m) => /62%/.test(m.body)));
  const soon = many((rng) => voice.subscriptionSoon({ rng, sub: 'Netflix', amount: 26900, frequency: 'monthly', auto: true }));
  assert.ok(soon.every(okMsg) && variety(soon) >= 3);
  assert.ok(soon.some((m) => m.body.includes('$322.800')), 'costo anual');
  assert.ok(many((rng) => voice.subscriptionCharged({ rng, sub: 'Spotify', amount: 16900 })).every(okMsg));
});

test('resumen semanal: titular según la tendencia y datos útiles', () => {
  const base = { prev: 400000, count: 9, top: ['Comida y restaurantes', 180000], busiest: { weekday: 5, amount: 120000 } };
  const down = many((rng) => voice.weekly({ rng, cur: 300000, ...base }));
  assert.ok(down.every(okMsg) && down.every((m) => /25%|ahorradora/.test(m.title)), down[0].title);
  const up = many((rng) => voice.weekly({ rng, cur: 520000, ...base }));
  assert.ok(up.every((m) => /30%|cara/.test(m.title)), up[0].title);
  const flat = many((rng) => voice.weekly({ rng, cur: 410000, ...base }));
  assert.ok(flat.every(okMsg) && variety(flat) >= 3);
  assert.ok(flat.some((m) => /viernes/.test(m.body)) && flat.some((m) => /Comida/.test(m.body)));
  const none = voice.weekly({ rng: voice.seeded('n'), cur: 0, prev: 0, count: 0, top: null, busiest: null });
  assert.ok(okMsg(none) && /sin gastos|¿Una semana|no anotaste/.test(none.title));
});

test('recordatorio de la noche: racha, quincena, viernes y genérico', () => {
  const streak = many((rng) => voice.evening({ rng, name: 'Leo', weekday: 2, day: 10, lastDay: 30, daysSince: 4 }));
  assert.ok(streak.every(okMsg) && streak.every((m) => /4 días|extrañaste/.test(m.title)));
  const q = many((rng) => voice.evening({ rng, weekday: 2, day: 15, lastDay: 30, daysSince: 1 }));
  assert.ok(q.some((m) => /quincena/i.test(m.title)) && q.some((m) => !/quincena/i.test(m.title)));
  const fri = many((rng) => voice.evening({ rng, weekday: 5, day: 7, lastDay: 30, daysSince: 0 }));
  assert.ok(fri.some((m) => /[Vv]iernes/.test(m.title)));
  const plain = many((rng) => voice.evening({ rng, weekday: 3, day: 11, lastDay: 30, daysSince: null }));
  assert.ok(plain.every(okMsg) && variety(plain) >= 5);
});

test('presupuestos: cuánto queda por día, proyección y cuándo vuelve a empezar', () => {
  const b = { category: 'Mercado', isTotal: false, period: 'monthly', amount: 1000000, spent: 850000, pct: 85, periodStart: '2026-11-01', today: '2026-11-15' };
  const warn = many((rng) => voice.budget({ rng, ...b, level: 80 }));
  assert.ok(warn.every(okMsg) && variety(warn) >= 3);
  assert.ok(warn.some((m) => m.body.includes('$9.375')), 'quedan $150.000 para 16 días');
  assert.ok(warn.some((m) => m.body.includes('$1.700.000')), 'proyección a fin de mes');
  const full = many((rng) => voice.budget({ rng, ...b, spent: 1000000, pct: 100, level: 100 }));
  assert.ok(full.every(okMsg));
  const over = many((rng) => voice.budget({ rng, ...b, spent: 1150000, pct: 115, level: 'over' }));
  assert.ok(over.every(okMsg) && over.some((m) => m.title.includes('$150.000')) && over.every((m) => /1\.º del próximo mes/.test(m.body)));
  const daily = many((rng) => voice.budget({ rng, category: 'Límite diario', isTotal: true, period: 'daily', amount: 40000, spent: 34000, pct: 85, periodStart: '2026-11-15', today: '2026-11-15', level: 80 }));
  assert.ok(daily.every(okMsg) && daily.every((m) => /\$6\.000/.test(m.body)) && daily.some((m) => /límite de hoy/.test(m.title)));
  const weekOver = voice.budget({ rng: voice.seeded('w'), category: 'Salidas', isTotal: false, period: 'weekly', amount: 100000, spent: 130000, pct: 130, periodStart: '2026-11-09', today: '2026-11-12', level: 'over' });
  assert.match(weekOver.body, /lunes/);
});

test('prueba de notificaciones: variada', () => {
  const t = many((rng) => voice.testPush({ rng, name: 'Sofía' }));
  assert.ok(t.every(okMsg) && variety(t) >= 3);
});
