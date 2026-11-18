// Hojas inferiores de Tarjetas: registrar pago, personalizar, cuotas, simulador, recordatorios, desglose y
// "¿Con cuál pago hoy?". Todas son bottom sheets nativas (manija, arrastre para cerrar, detents de openSheet).
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number, percent } from '../utils/format.js';
import { todayISO, dateShort } from '../utils/dates.js';
import { haptic } from '../utils/haptics.js';
import { reducedMotion } from '../utils/motion.js';
import { state } from '../state.js';
import { payCard, updateCard, listInstallments, createInstallment, updateInstallment, deleteInstallment } from '../api/cards.js';
import { deleteTransactions } from '../api/transactions.js';
import { openSheet } from '../ui/sheet.js';
import { formSheet } from '../ui/form.js';
import { segmented, selectSegment } from '../ui/common.js';
import { bindAmountInput } from '../ui/number-input.js';
import { runSave } from '../ui/submit.js';
import { toast } from '../ui/toast.js';
import { loaderHtml } from '../ui/orb-loader.js';
import { creditCard, cardTheme, bankColors, GRADIENTS, SOLIDS, FINISHES, EMOJIS, relDate } from '../ui/card-art.js';
import { minimumPayment, simulateMinimum, bestCardToday, purchaseWindow, usageTone, diffDays } from '../utils/card-pick.js';

const debtOf = (c) => Math.max(0, Number(c.debt) || 0);
/** "Banco Falabella" → "Falabella" (para chips y frases cortas) */
export const shortName = (c) => c.nickname || String(c.bank || c.name).replace(/^banco\s+/i, '').replace(/\s+bank$/i, '') || c.name;

/** Actualiza una tarjeta en memoria al instante (la recarga del servidor llega después) */
export function patchLocal(id, patch) {
  state.cards = state.cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/** Contador animado de un monto (count-up / count-down) */
export function countTo(node, from, to, { ms = 800, format = money } = {}) {
  if (!node) return;
  if (reducedMotion() || from === to) { node.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - p, 4);
    node.textContent = format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const thumb = (c) => {
  const t = cardTheme(c);
  return html`<span class="cl-thumb ${t.light ? 'light' : ''}" style="--c:${t.c};--c2:${t.c2}" aria-hidden="true">${c.emoji ? c.emoji : html`<i></i>`}</span>`;
};
export { thumb as cardThumb };

// ───────────────────────── deslizar para confirmar ─────────────────────────
function slideToConfirm(el, onConfirm) {
  const knob = el.querySelector('.knob');
  let g = null, done = false;
  const max = () => el.clientWidth - knob.offsetWidth - 8;
  const setX = (x) => el.style.setProperty('--x', `${x}px`);
  el.addEventListener('pointerdown', (e) => {
    if (done || el.classList.contains('busy')) return;
    g = { x0: e.clientX, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    el.classList.add('drag');
  });
  el.addEventListener('pointermove', (e) => {
    if (!g) return;
    const x = Math.max(0, Math.min(max(), e.clientX - g.x0));
    if (x > 6) g.moved = true;
    if (x >= max() * 0.9 && !g.armed) { g.armed = true; haptic.select(); }
    if (x < max() * 0.9) g.armed = false;
    setX(x);
  });
  const release = () => {
    if (!g) return;
    const { moved } = g;
    const x = parseFloat(el.style.getPropertyValue('--x')) || 0;
    g = null;
    el.classList.remove('drag');
    if (x >= max() * 0.9) { setX(max()); done = true; onConfirm(); return; }
    setX(0); // regresa de forma natural
    if (!moved) { el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge'); }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  // Teclado y lectores de pantalla: activar el botón confirma (el gesto no es la única forma)
  el.addEventListener('click', (e) => { if (e.detail === 0 && !done) { done = true; setX(max()); onConfirm(); } });
  return { reset: () => { done = false; el.classList.remove('busy'); setX(0); } };
}

// ───────────────────────── registrar pago ─────────────────────────
export function openPay(card) {
  const debt = debtOf(card);
  const min = minimumPayment(card);
  const accounts = state.accounts.filter((a) => !a.archived);
  let mode = debt > 0 ? 'total' : 'other';
  const s = openSheet({
    title: 'Registrar pago', className: 'pay-sheet',
    body: html`<div class="pay-head">${thumb(card)}<div><b>${card.nickname || card.name}</b><span>Debes <b class="num">${money(debt)}</b>${card.next_due_date ? ` · ${relDate('pago', card.next_due_date, todayISO())}` : ''}</span></div></div>
      <div class="pay-chips" role="group" aria-label="Monto a pagar">
        <button type="button" class="pay-chip" data-mode="min" aria-pressed="false" ${min ? '' : 'disabled'}>Mínimo<small class="num">${min ? money(min) : '—'}</small></button>
        <button type="button" class="pay-chip" data-mode="total" aria-pressed="false" ${debt ? '' : 'disabled'}>Total<small class="num">${money(debt)}</small></button>
        <button type="button" class="pay-chip" data-mode="other" aria-pressed="false">Otro<small>monto</small></button>
      </div>
      <label class="amount-input"><span class="cur">$</span><input name="amount" placeholder="0" aria-label="Monto del pago"></label>
      <div class="pay-warn" data-warn hidden></div>
      <div class="field mt-4"><label for="pay-acc">Sale de la cuenta</label>
        <select id="pay-acc" class="input" name="account">${accounts.map((a) => html`<option value="${a.id}" ${a.id === state.profile?.default_account_id ? 'selected' : ''}>${a.name} · ${money(a.balance)}</option>`)}</select></div>
      <div class="pay-after" data-after></div>`,
    footer: html`<button type="button" class="slide-ok" data-slide aria-label="Desliza para confirmar el pago"><span class="fill"></span><span class="knob">${icon('chevron-right', { stroke: 2.4 })}</span><span class="lbl">Desliza para confirmar</span></button>`,
  });
  const input = s.body.querySelector('[name="amount"]');
  const warn = s.body.querySelector('[data-warn]');
  const after = s.body.querySelector('[data-after]');
  let warned = false;
  const amt = bindAmountInput(input, { onChange: () => { mode = [min, debt].includes(amt.value) ? mode : 'other'; paint(); } });
  const paint = () => {
    const v = amt.value;
    s.body.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const over = debt > 0 && v > debt;
    warn.hidden = !over;
    if (over) { warn.textContent = `Es más de lo que debes: te quedará un saldo a favor de ${money(v - debt)}.`; if (!warned) { haptic.warning(); warned = true; } } else warned = false;
    after.innerHTML = v ? String(html`<span>Deuda después: <b class="num">${money(Math.max(0, debt - v))}</b></span><span>Disponible: <b class="num">${money(Number(card.available) + v)}</b></span>`) : '';
  };
  const setMode = (m) => {
    mode = m;
    amt.value = m === 'min' ? min : m === 'total' ? debt : 0;
    if (m === 'other') { input.value = ''; input.focus(); }
    haptic.tap();
    paint();
  };
  on(s.body, 'click', '[data-mode]', (e, b) => setMode(b.dataset.mode));
  setMode(mode);
  if (!accounts.length) { after.textContent = 'Primero agrega una cuenta en Más → Cuentas para registrar de dónde sale el pago.'; }

  const slider = slideToConfirm(s.foot.querySelector('[data-slide]'), async () => {
    const v = amt.value;
    const slideEl = s.foot.querySelector('[data-slide]');
    if (!v || !accounts.length) {
      haptic.error();
      input.classList.add('invalid');
      s.body.classList.remove('shake'); void s.body.offsetWidth; s.body.classList.add('shake');
      toast(!accounts.length ? 'Agrega una cuenta primero' : 'Escribe el monto del pago', { type: 'err' });
      slider.reset();
      return;
    }
    slideEl.classList.add('busy');
    const r = await runSave(() => payCard({ cardId: card.id, accountId: s.body.querySelector('[name="account"]').value, amount: v, date: new Date().toISOString() }), {});
    if (!r.ok) { slider.reset(); return; }
    haptic.success();
    patchLocal(card.id, { debt: Number(card.debt) - v, available: Number(card.available) + v, usage_pct: Number(card.credit_limit) > 0 ? Math.max(0, (debtOf(card) - v) * 100 / Number(card.credit_limit)) : 0 });
    s.body.innerHTML = String(html`<div class="pay-done" role="status"><span class="ok">${raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>')}</span>
      <span class="muted">Pago de ${money(v)} registrado</span><span class="eyebrow">Ahora debes</span><b class="num" data-left>${money(debt)}</b></div>`);
    s.foot.innerHTML = '';
    countTo(s.body.querySelector('[data-left]'), debt, Math.max(0, debt - v), { ms: 900 });
    const ids = [r.value?.payment_id, r.value?.interest_id].filter(Boolean);
    setTimeout(() => {
      s.close();
      toast(`Pago de ${money(v)} registrado`, { action: ids.length ? { label: 'Deshacer', fn: async () => { await deleteTransactions(ids); toast('Pago deshecho', { type: 'info' }); } } : null });
    }, 1400);
  });
  return s;
}

// ───────────────────────── personalizar ─────────────────────────
export function openPersonalize(card, { onPin } = {}) {
  let d = { ...card };
  const bank = bankColors(card);
  const swatches = [
    ...(bank ? [['Color del banco', bank[0], bank[1], 'bank']] : []),
    ...GRADIENTS.map(([n, a, b]) => [n, a, b]),
    ...SOLIDS.map((c) => [c, c, c]),
  ];
  let timer = 0, pending = {};
  const flush = async () => {
    clearTimeout(timer);
    const patch = pending; pending = {};
    if (!Object.keys(patch).length) return;
    try { await updateCard(card.id, patch); } catch (e) { toast(e.message || 'No se pudo guardar', { type: 'err' }); }
  };
  const save = (patch) => {
    Object.assign(d, patch); Object.assign(pending, patch);
    patchLocal(card.id, patch);
    paint();
    clearTimeout(timer); timer = setTimeout(flush, 450);
  };
  const s = openSheet({
    title: 'Personalizar', detent: 'large', onClose: flush,
    body: html`<div class="pz-preview" data-preview></div>
      <div class="pz-sec"><span class="eyebrow">Color</span><div class="pz-swatches" role="group" aria-label="Color de la tarjeta">${swatches.map(([n, a, b, k]) => html`<button type="button" class="pz-sw ${k ?? ''}" style="--c:${a};--c2:${b}" data-sw="${a}|${b}" aria-label="${n}" aria-pressed="false"></button>`)}</div></div>
      <div class="pz-sec"><span class="eyebrow">Acabado</span>${segmented('finish', FINISHES.map(([v, l]) => ({ value: v, label: l })), cardTheme(card).finish)}</div>
      <div class="pz-sec"><label class="eyebrow" for="pz-nick">Apodo</label><input id="pz-nick" class="input" maxlength="30" placeholder="Ej. Mercado, Viajes, Gasolina" value="${card.nickname ?? ''}"></div>
      <div class="pz-sec"><span class="eyebrow">Emoji</span><div class="pz-emojis" role="group" aria-label="Emoji de la tarjeta">
        <button type="button" class="pz-emoji none" data-emoji="" aria-pressed="false">Sin</button>${EMOJIS.map((e) => html`<button type="button" class="pz-emoji" data-emoji="${e}" aria-label="${e}" aria-pressed="false">${e}</button>`)}</div></div>
      <label class="pz-sec switch-row" for="pz-pin"><span class="grow"><b>Fijar arriba</b><span class="row-sub">Siempre primero, sin importar el orden</span></span>
        <span class="switch"><input id="pz-pin" type="checkbox" ${card.pinned ? 'checked' : ''}><span class="track"></span></span></label>`,
    footer: html`<button class="btn btn-primary btn-block" data-sheet-close>Listo</button>`,
  });
  const preview = s.body.querySelector('[data-preview]');
  const paint = () => {
    preview.innerHTML = String(creditCard(d, { today: todayISO() }));
    const t = cardTheme(d);
    s.body.querySelectorAll('[data-sw]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sw.toLowerCase() === `${t.c}|${t.c2}`.toLowerCase())));
    s.body.querySelectorAll('[data-emoji]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.emoji === (d.emoji ?? ''))));
  };
  on(s.body, 'click', '[data-sw]', (e, b) => { const [c, c2] = b.dataset.sw.split('|'); haptic.select(); save({ color: c, color2: c2 === c ? null : c2 }); });
  on(s.body, 'click', '[data-seg="finish"] button', (e, b) => { selectSegment(b.parentElement, b.dataset.value); haptic.select(); save({ finish: b.dataset.value }); });
  on(s.body, 'click', '[data-emoji]', (e, b) => { haptic.select(); save({ emoji: b.dataset.emoji || null }); });
  s.body.querySelector('#pz-nick').addEventListener('input', (e) => save({ nickname: e.target.value.trim() || null }));
  s.body.querySelector('#pz-pin').addEventListener('change', (e) => { haptic.tap(); save({ pinned: e.target.checked }); onPin?.(e.target.checked); });
  paint();
  return s;
}

// ───────────────────────── compras a cuotas ─────────────────────────
function installmentForm(card, it = null, onSaved) {
  formSheet({
    title: it ? 'Editar compra a cuotas' : 'Compra a cuotas',
    fields: [
      { name: 'description', label: 'Qué compraste', value: it?.description, required: true, placeholder: 'Ej. Televisor, tiquetes', maxlength: 80 },
      { name: 'installments_total', label: 'Total de cuotas', type: 'number', min: 1, max: 72, value: it?.installments_total ?? 12, required: true },
      { name: 'installment_current', label: 'Vas en la cuota', type: 'number', min: 1, max: 72, value: it?.installment_current ?? 1, required: true,
        validate: (v, all) => (v > all.installments_total ? 'No puede ser mayor que el total de cuotas' : null) },
      { name: 'installment_amount', label: 'Valor de cada cuota', type: 'amount', value: it?.installment_amount, required: true },
      { name: 'balance', label: 'Saldo que falta (opcional)', type: 'amount', value: it?.balance ?? 0, hint: 'Si lo dejas vacío lo calculo: cuotas que faltan × valor de la cuota.' },
    ],
    onSubmit: async (v) => {
      const row = { ...v, balance: v.balance || Math.max(0, (v.installments_total - v.installment_current + 1) * v.installment_amount) };
      if (it) await updateInstallment(it.id, row); else await createInstallment({ ...row, card_id: card.id });
      toast(it ? 'Compra actualizada' : 'Compra a cuotas agregada');
      onSaved?.();
    },
    onDelete: it ? async () => { await deleteInstallment(it.id); toast('Compra eliminada'); onSaved?.(); } : null,
    deleteConfirm: { title: '¿Eliminar esta compra a cuotas?', message: 'Solo se borra de esta lista; tu deuda no cambia.' },
  });
}

export function openInstallments(card) {
  const s = openSheet({
    title: 'Cuotas pendientes', detent: 'large',
    body: html`<p class="muted small mb-4">${card.nickname || card.name}</p><div data-list>${loaderHtml()}</div>`,
    footer: html`<button class="btn btn-primary btn-block" data-add>${icon('plus', { size: 18 })}Agregar compra a cuotas</button>`,
  });
  const box = s.body.querySelector('[data-list]');
  let rows = [];
  const load = async () => {
    try { rows = await listInstallments(card.id); } catch (e) { box.innerHTML = String(html`<p class="muted">${e.message || 'No se pudieron cargar las cuotas.'}</p>`); return; }
    const active = rows.filter((r) => Number(r.balance) > 0);
    const monthly = active.reduce((a, r) => a + Number(r.installment_amount), 0);
    const bal = active.reduce((a, r) => a + Number(r.balance), 0);
    box.innerHTML = String(rows.length ? html`
      <div class="inst-sum"><div><span class="eyebrow">Pagas al mes</span><b class="num">${money(monthly)}</b></div><div><span class="eyebrow">Saldo en cuotas</span><b class="num">${money(bal)}</b></div></div>
      <div class="list">${rows.map((r) => {
        const p = Math.round((Number(r.installment_current) / Number(r.installments_total)) * 100);
        return html`<button class="list-row tappable inst-row" data-inst="${r.id}">
          <div class="inst-top"><b class="ellipsis">${r.description}</b><b class="num">${money(r.installment_amount)}</b></div>
          <div class="inst-meta"><span>Cuota ${r.installment_current} de ${r.installments_total}</span><span>Saldo <b class="num">${money(r.balance)}</b></span></div>
          <div class="cl-bar" style="--tone:var(--accent)"><span style="--p:${p}%"></span></div></button>`;
      })}</div>` : html`<div class="center muted" style="padding:32px 0">${icon('layers', { size: 32 })}<p class="mt-2">No tienes compras a cuotas en esta tarjeta.</p></div>`);
  };
  on(s.body, 'click', '[data-inst]', (e, b) => installmentForm(card, rows.find((r) => r.id === b.dataset.inst), load));
  s.foot.querySelector('[data-add]').addEventListener('click', () => installmentForm(card, null, load));
  load();
  return s;
}

// ───────────────────────── simulador mínimo vs total ─────────────────────────
export function openSimulator(card) {
  const debt = debtOf(card);
  const s = openSheet({
    title: 'Mínimo vs. total', detent: 'large',
    body: html`<p class="muted small">Con ${card.nickname || card.name} debes <b class="num">${money(debt)}</b>. Así cambia lo que pagas según cuánto abones cada mes.</p>
      <div class="input-row mt-4">
        <div class="field"><label for="sim-rate">Tasa mensual</label><div class="input-prefix suffix"><input id="sim-rate" class="input" inputmode="decimal" value="${String(card.monthly_rate ?? 2.2).replace('.', ',')}"><span>%</span></div></div>
        <div class="field"><label for="sim-min">Pago mínimo</label><div class="input-prefix"><span>$</span><input id="sim-min" class="input" placeholder="${number(minimumPayment(card))}" value="${card.min_payment ? number(card.min_payment) : ''}"></div></div>
      </div>
      <div data-out></div>
      <p class="sim-note">${card.monthly_rate == null ? 'Usé una tasa aproximada; cámbiala por la de tu extracto. ' : ''}Si dejas el mínimo vacío, lo estimo mes a mes (intereses + 3 % del saldo, mínimo $30.000). Es un estimado: tu banco puede calcularlo distinto.</p>`,
    footer: html`<button class="btn btn-secondary btn-block" data-save>Guardar tasa y mínimo en la tarjeta</button>`,
  });
  const rateEl = s.body.querySelector('#sim-rate');
  const minAmt = bindAmountInput(s.body.querySelector('#sim-min'), { onChange: () => paint() });
  const rate = () => Math.max(0, Math.min(10, Number(String(rateEl.value).replace(',', '.')) || 0));
  const out = s.body.querySelector('[data-out]');
  const paint = () => {
    const sim = simulateMinimum({ debt, rate: rate(), minPayment: minAmt.value || null });
    const maxPaid = sim.never ? debt * 3 : Math.max(debt, sim.totalPaid);
    const w = (v) => `${Math.max(4, Math.round((v / maxPaid) * 100))}%`;
    out.innerHTML = String(html`<div class="sim-grid mt-4">
        <div class="sim-card good"><span class="eyebrow">Pago total</span><b class="num">${money(debt)}</b><span>Intereses: $0 · listo este mes</span></div>
        <div class="sim-card bad"><span class="eyebrow">Solo el mínimo</span>${sim.never
          ? html`<b>Nunca terminas</b><span>El mínimo no alcanza ni para los intereses</span>`
          : html`<b class="num">${money(sim.totalInterest)}</b><span>de intereses en ${sim.months} ${sim.months === 1 ? 'mes' : 'meses'} (${sim.months >= 12 ? `${(sim.months / 12).toLocaleString('es-CO', { maximumFractionDigits: 1 })} años` : 'menos de un año'})</span>`}</div>
      </div>
      ${sim.never ? '' : html`<div class="sim-bars" aria-hidden="true">
        <div class="sim-bar"><span>Pago total</span><i style="--w:${w(debt)};--c:#2E9E5B"></i></div>
        <div class="sim-bar"><span>Mínimo</span><i style="--w:${w(sim.totalPaid)};--c:var(--danger)"></i></div></div>
        <p class="sim-note">Pagando solo el mínimo terminarías pagando <b class="num">${money(sim.totalPaid)}</b> en total: ${percent(debt ? (sim.totalInterest / debt) * 100 : 0)} más.</p>`}`);
  };
  rateEl.addEventListener('input', paint);
  s.foot.querySelector('[data-save]').addEventListener('click', async (e) => {
    const r = await runSave(() => updateCard(card.id, { monthly_rate: rate() || null, min_payment: minAmt.value || null }), { button: e.currentTarget });
    if (r.ok) { haptic.success(); patchLocal(card.id, { monthly_rate: rate() || null, min_payment: minAmt.value || null }); toast('Guardado en la tarjeta'); s.close(); }
  });
  paint();
  return s;
}

// ───────────────────────── recordatorios ─────────────────────────
export function openReminders(card) {
  const CUT = [[null, 'No avisar'], [0, 'El mismo día'], [1, '1 día antes'], [2, '2 días antes'], [3, '3 días antes'], [5, '5 días antes']];
  const DUE = [[null, 'No avisar'], [0, 'Solo el día'], [3, '3 días antes'], [5, '5 días antes'], [7, '7 días antes'], [10, '10 días antes']];
  const cur = { cut: card.remind_cut_days === undefined ? 1 : card.remind_cut_days, due: card.remind_due_days === undefined ? 3 : card.remind_due_days };
  const prefs = state.profile?.notification_prefs ?? {};
  const opts = (k, list) => html`<div class="rem-opts" role="group">${list.map(([v, l]) => html`<button type="button" class="chip" data-rem="${k}" data-v="${v ?? ''}" aria-pressed="${String((cur[k] ?? null) === v)}">${l}</button>`)}</div>`;
  const s = openSheet({
    title: 'Recordatorios', className: 'pay-sheet',
    body: html`<p class="muted small">${card.nickname || card.name}: elige con cuánta anticipación te aviso.</p>
      <div class="pz-sec"><span class="eyebrow">Antes del corte</span>${opts('cut', CUT)}</div>
      <div class="pz-sec"><span class="eyebrow">Antes del pago</span>${opts('due', DUE)}<p class="sim-note">Si debes algo, también te aviso el día anterior y el mismo día del pago.</p></div>
      ${prefs.card_cut === false || prefs.card_due === false ? html`<p class="pay-warn">Tienes apagados algunos avisos de tarjetas en Ajustes → Notificaciones.</p>` : ''}`,
    footer: html`<button class="btn btn-primary btn-block" data-sheet-close>Listo</button>`,
  });
  on(s.body, 'click', '[data-rem]', async (e, b) => {
    const k = b.dataset.rem;
    const v = b.dataset.v === '' ? null : Number(b.dataset.v);
    cur[k] = v;
    s.body.querySelectorAll(`[data-rem="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    haptic.select();
    const patch = k === 'cut' ? { remind_cut_days: v } : { remind_due_days: v };
    patchLocal(card.id, patch);
    try { await updateCard(card.id, patch); } catch (err) { toast(err.message || 'No se pudo guardar', { type: 'err' }); }
  });
  return s;
}

// ───────────────────────── desglose de una cifra ─────────────────────────
export function openBreakdown(kind, cards, { hidden = false } = {}) {
  const val = { debt: debtOf, limit: (c) => Number(c.credit_limit) || 0, avail: (c) => Number(c.available) || 0 }[kind];
  const title = { debt: 'Deuda por tarjeta', limit: 'Cupo por tarjeta', avail: 'Disponible por tarjeta' }[kind];
  const rows = [...cards].sort((a, b) => val(b) - val(a));
  const total = rows.reduce((s, c) => s + val(c), 0);
  openSheet({
    title, className: 'pay-sheet',
    body: html`<div>${rows.map((c) => html`<div class="bd-row">${thumb(c)}<div class="ellipsis"><b>${c.nickname || c.name}</b><div class="row-sub">${c.bank ?? ''}${c.last4 ? ` · •••• ${c.last4}` : ''}</div></div>
        <b class="num">${hidden ? '$••••••' : money(val(c))}</b>
        <div class="cl-bar ${kind === 'debt' ? `tone-${usageTone(c.usage_pct)}` : ''}" style="${kind === 'debt' ? '' : '--tone:var(--accent)'}"><span style="--p:${total > 0 ? Math.max(2, (val(c) / total) * 100) : 0}%"></span></div></div>`)}</div>
      <div class="pay-after"><span>Total</span><b class="num">${hidden ? '$••••••' : money(total)}</b></div>`,
  });
}

// ───────────────────────── ¿con cuál pago hoy? ─────────────────────────
export function openBest(cards, { onPick } = {}) {
  const today = todayISO();
  const best = bestCardToday(cards, today);
  const ranked = cards.filter((c) => c.cut_day && c.due_day).map((c) => ({ c, w: purchaseWindow(c, today) })).sort((a, b) => b.w.daysToPay - a.w.daysToPay);
  const s = openSheet({
    title: '¿Con cuál pago hoy?', className: 'pay-sheet',
    body: html`${best ? html`<div class="best-why">Usa <b>${best.card.nickname || best.card.name}</b>: ${best.daysSinceCut <= 7 ? html`cortó hace ${best.daysSinceCut} ${best.daysSinceCut === 1 ? 'día' : 'días'}, así que ` : ''}lo que compres hoy lo pagas el <b>${dateShort(best.payDate)}</b>, en <b>${best.daysToPay} días</b>. Te quedan <b class="num">${money(best.card.available)}</b> de cupo.</div>`
      : html`<div class="best-why">Ahora ninguna tarjeta tiene cupo cómodo (sin disponible o por encima del 90 % de uso).</div>`}
      <span class="eyebrow">Días para pagar lo que compres hoy</span>
      <div class="mt-2">${ranked.map(({ c, w }) => html`<button class="bd-row" style="width:100%;text-align:left" data-pick="${c.id}">${thumb(c)}<div class="ellipsis"><b>${c.nickname || c.name}</b>
          <div class="row-sub">Corte ${dateShort(w.cutDate)} · pago ${dateShort(w.payDate)} · uso ${percent(c.usage_pct)}</div></div><b class="num">${w.daysToPay} d</b></button>`)}</div>
      <p class="sim-note">Elijo la que acaba de cortar: lo que compres hoy entra al próximo extracto y tienes más días para pagarlo. Descarto las que no tienen cupo o pasan del 90 % de uso, y castigo las que van por encima del 70 %.</p>`,
  });
  on(s.body, 'click', '[data-pick]', (e, b) => { s.close(); onPick?.(b.dataset.pick); });
  return s;
}

/** Elegir una tarjeta (para atajos como "Registrar pago" sin tarjeta definida) */
export function pickCard(cards, title = '¿A cuál tarjeta?') {
  return new Promise((resolve) => {
    let picked = null;
    const s = openSheet({
      title, className: 'pay-sheet', onClose: () => resolve(picked),
      body: html`${cards.map((c) => html`<button class="bd-row" style="width:100%;text-align:left" data-pick="${c.id}">${thumb(c)}<div class="ellipsis"><b>${c.nickname || c.name}</b><div class="row-sub">Debes ${money(debtOf(c))}</div></div>${icon('chevron-right', { size: 18 })}</button>`)}`,
    });
    on(s.body, 'click', '[data-pick]', (e, b) => { picked = cards.find((c) => c.id === b.dataset.pick) ?? null; s.close(); });
  });
}

export { diffDays };
