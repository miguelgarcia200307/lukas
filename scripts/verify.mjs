// Verificación de punta a punta contra el proyecto desplegado. Crea datos de prueba y los borra al final.
// Uso: node --use-system-ca scripts/verify.mjs
import { readEnv, requireVars } from './env.mjs';

const ok = (label, cond, extra = '') => { console.log(`${cond ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`); return cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function verify(env = readEnv()) {
  requireVars(env, ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'USER_EMAIL', 'USER_PASSWORD', 'CRON_SECRET']);
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const anonH = { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  let failures = 0;
  const check = (...a) => { const r = ok(...a); if (!r) failures++; return r; };

  // RLS sin sesión
  const anon = await fetch(`${base}/rest/v1/transactions?select=id&limit=1`, { headers: anonH });
  const anonBody = await anon.json().catch(() => null);
  check('RLS: sin sesión no se ven datos', !anon.ok || (Array.isArray(anonBody) && anonBody.length === 0), `HTTP ${anon.status}`);

  // Login
  const tok = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: anonH, body: JSON.stringify({ email: env.USER_EMAIL, password: env.USER_PASSWORD }),
  }).then((r) => r.json());
  if (!check('Login con email y contraseña', !!tok.access_token)) return failures;
  const H = { ...anonH, Authorization: `Bearer ${tok.access_token}` };
  const rest = async (p, opts = {}) => {
    const r = await fetch(`${base}/rest/v1/${p}`, { headers: { ...H, Prefer: 'return=representation', ...(opts.headers ?? {}) }, ...opts });
    const t = await r.text();
    if (!r.ok) throw new Error(`${p} → ${r.status} ${t}`);
    return t ? JSON.parse(t) : null;
  };
  const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  await rpc('ensure_profile', {});

  // Asistente
  const ai = async (text, history = []) => {
    const r = await fetch(`${base}/functions/v1/ai-assistant`, { method: 'POST', headers: H, body: JSON.stringify({ text, history }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`ai-assistant ${r.status}: ${JSON.stringify(j)}`);
    return j;
  };
  const cases = [
    ['Salí a comer con mi novia y me gasté 30.000 en una salchipapa, ella se pidió una hamburguesa de 22.000 y compramos dos gaseosas de 5.000 cada una',
      (j) => j.proposals.length === 1 && j.proposals[0].amount === 62000 && j.proposals[0].items.length === 3],
    ['Fui a la ferretería y me compré unos clavos para la casa, y de paso una empanada de 5 lucas',
      (j) => j.needs_clarification && j.proposals.some((p) => p.amount === 5000)],
    ['Acabo de recibir 30 mil pesos por una venta', (j) => j.proposals[0]?.type === 'income' && j.proposals[0]?.amount === 30000],
    ['Pagué 500 mil de la Visa desde Bancolombia', (j) => j.intent === 'card_payment' || j.needs_clarification],
    ['¿Cuánto he gastado esta semana?', (j) => j.intent === 'query' && /\$/.test(j.reply)],
  ];
  for (const [text, test] of cases) {
    try {
      const j = await ai(text);
      check(`IA: "${text.slice(0, 48)}…"`, test(j), `${j.intent} · ${j.reply}`);
    } catch (e) { check(`IA: "${text.slice(0, 48)}…"`, false, e.message); }
    await sleep(Number(process.env.AI_TEST_PAUSE ?? 15000)); // límite por minuto del plan gratis de Groq
  }

  // Contabilidad de tarjetas
  const [acc] = await rest('accounts', { method: 'POST', body: JSON.stringify({ name: 'Cuenta prueba', type: 'bank', initial_balance: 1000000 }) });
  const [card] = await rest('credit_cards', { method: 'POST', body: JSON.stringify({ name: 'Tarjeta prueba', brand: 'visa', credit_limit: 2000000, cut_day: 31, due_day: 15 }) });
  const [cat] = await rest('categories?system_key=eq.other_expense&select=id', { method: 'GET' });
  const debt = async () => (await rest(`card_status?id=eq.${card.id}&select=debt`, { method: 'GET' }))[0].debt;
  const startedAt = new Date().toISOString();
  try {
    const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const before = await rpc('report_data', { p_from: today, p_to: today });
    const [txId] = await rpc('create_transactions', { p_rows: [{ type: 'expense', amount: 120000, description: 'Prueba tarjeta', category_id: cat.id, card_id: card.id }] });
    check('Gasto con tarjeta sube la deuda', Number(await debt()) === 120000);
    await rpc('pay_card', { p_card_id: card.id, p_account_id: acc.id, p_amount: 100000 });
    check('Pago de tarjeta baja la deuda', Number(await debt()) === 20000);
    const after = await rpc('report_data', { p_from: today, p_to: today });
    check('El pago no aparece como gasto en reportes', Number(after.expense) - Number(before.expense) === 120000);

    // Presupuesto: alerta del 80% una sola vez
    const [budget] = await rest('budgets', { method: 'POST', body: JSON.stringify({ category_id: cat.id, period: 'daily', amount: 200000 }) });
    const [b1] = await rpc('create_transactions', { p_rows: [{ type: 'expense', amount: 45000, description: 'Prueba presupuesto', category_id: cat.id, account_id: acc.id }] });
    await sleep(6000);
    const [b2] = await rpc('create_transactions', { p_rows: [{ type: 'expense', amount: 1000, description: 'Prueba presupuesto 2', category_id: cat.id, account_id: acc.id }] });
    await sleep(6000);
    const notes = await rest(`notifications?dedupe_key=like.budget:${budget.id}*&select=dedupe_key`, { method: 'GET' });
    check('budget-check: alerta del 80% una sola vez', notes.filter((n) => n.dedupe_key.endsWith(':80')).length === 1, `${notes.length} aviso(s)`);
    await rest(`notifications?dedupe_key=like.budget:${budget.id}*`, { method: 'DELETE' });
    await rest(`budgets?id=eq.${budget.id}`, { method: 'DELETE' });
    // avisos del límite diario disparados por los gastos de prueba
    await rest(`notifications?dedupe_key=like.budget:daily:*&created_at=gte.${encodeURIComponent(startedAt)}`, { method: 'DELETE' });
    await rpc('delete_transactions', { p_ids: [txId, b1, b2] });
  } finally {
    const txs = await rest(`transactions?or=(account_id.eq.${acc.id},to_card_id.eq.${card.id},card_id.eq.${card.id})&select=id`, { method: 'GET' });
    if (txs.length) await rpc('delete_transactions', { p_ids: txs.map((t) => t.id) });
    await rest(`credit_cards?id=eq.${card.id}`, { method: 'DELETE' });
    await rest(`accounts?id=eq.${acc.id}`, { method: 'DELETE' });
  }

  // anon no puede llamar RPC ni leer vistas
  const anonRpc = await fetch(`${base}/rest/v1/rpc/home_summary`, { method: 'POST', headers: anonH, body: '{}' });
  check('anon sin acceso a RPC', !anonRpc.ok, `HTTP ${anonRpc.status}`);
  const anonView = await fetch(`${base}/rest/v1/card_status?select=id`, { headers: anonH });
  check('anon sin acceso a vistas', !anonView.ok, `HTTP ${anonView.status}`);

  // CORS con lista exacta
  const pre = async (origin) => (await fetch(`${base}/functions/v1/ai-assistant`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } })).headers.get('access-control-allow-origin');
  const good = await pre('https://miguelgarcia200307.github.io');
  const bad = await pre('https://otro-sitio.github.io');
  check('CORS: solo orígenes permitidos', good === 'https://miguelgarcia200307.github.io' && !bad, `permitido=${good} ajeno=${bad}`);

  // Cuota de la IA: 20 por minuto (se limpia al terminar)
  const quotaStart = new Date().toISOString();
  let blockedAt = null;
  for (let i = 1; i <= 21 && !blockedAt; i++) {
    const q = await rpc('consume_ai_quota', {});
    if (!q.allowed) blockedAt = i;
  }
  check('Cuota de la IA bloquea al pasar el límite por minuto', blockedAt != null && blockedAt <= 21, `bloqueó en la solicitud ${blockedAt}`);
  const aiBlocked = await fetch(`${base}/functions/v1/ai-assistant`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'hola' }) });
  check('ai-assistant responde 429 con la cuota agotada', aiBlocked.status === 429, `HTTP ${aiBlocked.status}`);
  await rest(`ai_requests?created_at=gte.${encodeURIComponent(quotaStart)}`, { method: 'DELETE' });

  // Recordatorios manuales
  const rem = await fetch(`${base}/functions/v1/daily-reminders`, {
    method: 'POST', headers: { ...anonH, 'x-cron-secret': env.CRON_SECRET }, body: JSON.stringify({ slot: 'all' }),
  });
  const remBody = await rem.json().catch(() => ({}));
  check('daily-reminders responde', rem.ok, JSON.stringify(remBody.results ?? remBody));

  console.log(failures ? `\n${failures} verificación(es) fallaron` : '\nTodo verificado');
  return failures;
}

if (process.argv[1]?.endsWith('verify.mjs')) {
  verify().then((f) => process.exit(f ? 1 : 0)).catch((e) => { console.error('✘', e.message); process.exit(1); });
}
