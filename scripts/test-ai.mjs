// Prueba el cerebro del asistente (mismo código que la Edge Function) directamente contra Groq.
// Uso: node scripts/test-ai.mjs   (lee GROQ_API_KEY y GROQ_CHAT_MODEL de .env.local)
import { readEnv } from './env.mjs';
import { interpret, composeAnswer } from '../supabase/functions/_shared/assistant.ts';

const env = readEnv();
const models = [env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b', env.GROQ_CHAT_FALLBACK || 'openai/gpt-oss-20b'];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const catDefs = [
  ['food', 'Comida y restaurantes', 'expense'], ['groceries', 'Mercado', 'expense'], ['transport', 'Transporte', 'expense'],
  ['home', 'Hogar', 'expense'], ['utilities', 'Servicios públicos', 'expense'], ['rent', 'Arriendo', 'expense'],
  ['partner', 'Pareja', 'expense'], ['health', 'Salud', 'expense'], ['education', 'Educación', 'expense'],
  ['entertainment', 'Entretenimiento', 'expense'], ['subscriptions', 'Suscripciones', 'expense'], ['clothes', 'Ropa', 'expense'],
  ['tech', 'Tecnología', 'expense'], ['pets', 'Mascotas', 'expense'], ['gifts', 'Regalos', 'expense'], ['travel', 'Viajes', 'expense'],
  ['finance', 'Gastos financieros', 'expense'], ['other_expense', 'Otros', 'expense'],
  ['salary', 'Salario', 'income'], ['sales', 'Ventas', 'income'], ['freelance', 'Freelance', 'income'],
  ['transfers_in', 'Transferencias recibidas', 'income'], ['refunds', 'Reembolsos', 'income'], ['other_income', 'Otros ingresos', 'income'],
];
const categories = catDefs.map(([k, n, kind], i) => ({ id: id(100 + i), name: n, kind, parent_id: null, system_key: k }));
const byKey = Object.fromEntries(categories.map((c) => [c.system_key, c.id]));
categories.push({ id: id(200), name: 'Taxi', kind: 'expense', parent_id: byKey.transport, system_key: 'transport_taxi' });

const ctx = {
  now: new Date(),
  userName: env.USER_NAME || 'Miguel',
  categories,
  accounts: [
    { id: id(1), name: 'Efectivo', type: 'cash' },
    { id: id(2), name: 'Bancolombia', type: 'bank' },
    { id: id(3), name: 'Nequi', type: 'wallet' },
  ],
  cards: [
    { id: id(10), name: 'Visa', bank: 'Bancolombia', brand: 'visa', last4: '1234' },
    { id: id(11), name: 'Mastercard', bank: 'Davivienda', brand: 'mastercard', last4: '9876' },
  ],
  debts: [], subscriptions: [], goals: [],
  defaultAccountId: id(1),
};
const name = (cid) => categories.find((c) => c.id === cid)?.name;

let failures = 0;
function check(label, cond) {
  console.log(`   ${cond ? '✔' : '✘'} ${label}`);
  if (!cond) failures++;
}

async function run(text, history = []) {
  if (run.count++) await new Promise((r) => setTimeout(r, Number(process.env.AI_TEST_PAUSE ?? 22000))); // plan gratis de Groq: 8k tokens/min
  const t0 = Date.now();
  const r = await interpret({ apiKey: env.GROQ_API_KEY, models, ctx, text, history });
  console.log(`\n▶ "${text}"  (${r.model}, ${Date.now() - t0} ms)`);
  console.log(`   intent=${r.intent} needs=${r.needs_clarification} q=${r.question ?? '-'}`);
  console.log(`   reply: ${r.reply}`);
  for (const p of r.proposals) {
    if (p.kind === 'transaction') {
      console.log(`   • ${p.type} ${p.amount} "${p.description}" [${name(p.category_id)} | alt: ${p.category_alternatives.map(name).join(', ')}] ${p.payment.kind}:${p.payment.id?.slice(-2)} ${p.date}`);
      p.items.forEach((it) => console.log(`       - ${it.name} ${it.qty} × ${it.unit_amount}`));
    } else console.log('   •', JSON.stringify(p));
  }
  return r;
}

run.count = 0;
const r1 = await run('Salí a comer con mi novia y me gasté 30.000 en una salchipapa, ella se pidió una hamburguesa de 22.000 y compramos dos gaseosas de 5.000 cada una');
check('1 transacción', r1.proposals.length === 1);
check('monto 62.000', r1.proposals[0]?.amount === 62000);
check('3 ítems', r1.proposals[0]?.items.length === 3);
check('categoría Comida', r1.proposals[0]?.category_id === byKey.food);
check('2 alternativas', r1.proposals[0]?.category_alternatives.length === 2);

const r2 = await run('Fui a la ferretería y me compré unos clavos para la casa, y de paso una empanada de 5 lucas');
const emp = r2.proposals.find((p) => p.amount === 5000);
check('empanada 5.000 en Comida', emp?.category_id === byKey.food);
check('pregunta por los clavos', r2.needs_clarification && /clavo/i.test(r2.question ?? ''));
const r2b = await run('Los clavos me costaron 8 lucas', [{ role: 'user', content: 'Fui a la ferretería y me compré unos clavos para la casa, y de paso una empanada de 5 lucas' }, { role: 'assistant', content: r2.memory }]);
check('turno 2: 2 transacciones', r2b.proposals.length === 2);
check('turno 2: clavos 8.000 en Hogar', r2b.proposals.some((p) => p.amount === 8000 && p.category_id === byKey.home));
check('turno 2: mismo grupo', new Set(r2b.proposals.map((p) => p.group_id)).size === 1);

const r3 = await run('Acabo de recibir 30 mil pesos por una venta');
check('ingreso 30.000', r3.proposals[0]?.type === 'income' && r3.proposals[0]?.amount === 30000);
check('categoría Ventas', r3.proposals[0]?.category_id === byKey.sales);

const r4 = await run('Pagué 500 mil de la Visa desde Bancolombia');
check('intent card_payment', r4.intent === 'card_payment');
check('tarjeta Visa, cuenta Bancolombia, 500.000', r4.proposals[0]?.card_id === id(10) && r4.proposals[0]?.account_id === id(2) && r4.proposals[0]?.amount === 500000);

const r5 = await run('¿Cuánto he gastado esta semana?');
check('intent query spending', r5.intent === 'query' && r5.query?.topic === 'spending');
const answer = await composeAnswer(env.GROQ_API_KEY, models, '¿Cuánto he gastado esta semana?',
  `Periodo: ${r5.query?.from} a ${r5.query?.to}\nTotal gastado: $142.000 en 9 movimientos\nPeriodo anterior: $120.000\nTop categorías: Comida y restaurantes $82.000; Transporte $40.000; Hogar $20.000`, 'Esta semana llevas $142.000.');
console.log(`   respuesta: ${answer}`);
check('respuesta usa la cifra real', answer.includes('142.000'));

const r6 = await run('Almorcé por 18 lucas con la Master y pagué un Uber de 12 mil por Nequi');
check('2 transacciones', r6.proposals.length === 2);
check('almuerzo con Mastercard', r6.proposals.some((p) => p.amount === 18000 && p.payment.kind === 'card' && p.payment.id === id(11)));
check('Uber por Nequi en Taxi', r6.proposals.some((p) => p.amount === 12000 && p.payment.id === id(3) && p.category_id === id(200)));

console.log(failures ? `\n${failures} verificaciones fallaron` : '\nTodas las verificaciones pasaron');
process.exit(failures ? 1 : 0);
