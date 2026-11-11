// Suscripciones: costo mensual equivalente, próxima fecha, auto-registro
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, initials } from '../utils/format.js';
import { inDays, dateShort, addMonths, todayISO } from '../utils/dates.js';
import { state, subscribe, activeCategories } from '../state.js';
import { createSubscription, updateSubscription, deleteSubscription, chargeNow } from '../api/subscriptions.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

export const title = 'Suscripciones';
const FREQ = { monthly: 'al mes', yearly: 'al año', weekly: 'a la semana' };
const BRAND_COLORS = { netflix: '#E50914', spotify: '#1DB954', disney: '#113CCF', icloud: '#3693F3', youtube: '#FF0033', amazon: '#00A8E1', prime: '#00A8E1', hbo: '#5822B4', max: '#002BE7', chatgpt: '#10A37F', apple: '#1D1D1B', google: '#4285F4', xbox: '#107C10', playstation: '#003791' };
const brandColor = (name) => Object.entries(BRAND_COLORS).find(([k]) => name.toLowerCase().includes(k))?.[1];

function openSubForm(sub = null) {
  const pay = [...state.accounts.filter((a) => !a.archived).map((a) => ({ value: `account:${a.id}`, label: a.name })),
    ...state.cards.filter((c) => !c.archived).map((c) => ({ value: `card:${c.id}`, label: `${c.name} (tarjeta)` }))];
  const current = sub?.card_id ? `card:${sub.card_id}` : sub?.account_id ? `account:${sub.account_id}` : pay[0]?.value;
  formSheet({
    title: sub ? 'Editar suscripción' : 'Nueva suscripción',
    fields: [
      { name: 'name', label: 'Nombre', value: sub?.name, required: true, placeholder: 'Netflix, Spotify, iCloud…' },
      { name: 'amount', label: 'Valor', type: 'amount', value: sub?.amount, required: true },
      { name: 'frequency', label: 'Frecuencia', type: 'select', value: sub?.frequency ?? 'monthly', options: [
        { value: 'monthly', label: 'Mensual' }, { value: 'yearly', label: 'Anual' }, { value: 'weekly', label: 'Semanal' }] },
      { name: 'next_charge_date', label: 'Próximo cobro', type: 'date', value: sub?.next_charge_date ?? addMonths(todayISO(), 1), required: true },
      { name: 'pay', label: 'Se paga con', type: 'select', value: current, options: pay },
      { name: 'category_id', label: 'Categoría', type: 'select', value: sub?.category_id ?? state.categories.find((c) => c.system_key === 'subscriptions')?.id,
        options: activeCategories('expense').map((c) => ({ value: c.id, label: c.name })) },
      { name: 'auto_register', label: 'Registrar el gasto automáticamente', type: 'switch', value: sub?.auto_register ?? true, hint: 'El día del cobro creo el gasto por ti.' },
      ...(sub ? [{ name: 'active', label: 'Activa', type: 'switch', value: sub.active }] : []),
      { name: 'color', label: 'Color', type: 'color', value: sub?.color ?? '#1D1D1B' },
    ],
    onSubmit: async ({ pay: p, ...v }) => {
      const [kind, id] = (p || ':').split(':');
      const row = { ...v, account_id: kind === 'account' ? id : null, card_id: kind === 'card' ? id : null };
      if (!sub && v.color === '#1D1D1B') row.color = brandColor(v.name) ?? v.color;
      if (sub) await updateSubscription(sub.id, row); else await createSubscription(row);
      toast(sub ? 'Suscripción actualizada' : 'Suscripción agregada');
    },
    onDelete: sub ? async () => { await deleteSubscription(sub.id); toast('Suscripción eliminada'); } : null,
  });
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Suscripciones', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nueva suscripción">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="subs-body"></div></div></div>`);
  const body = screen.querySelector('.subs-body');
  const render = () => {
    const list = state.subscriptions;
    if (!list.length) {
      body.innerHTML = String(emptyState({ illus: 'list', title: 'Sin suscripciones', text: 'Agrega Netflix, Spotify o lo que pagues cada mes y te aviso un día antes del cobro.', action: { label: 'Agregar suscripción', attrs: 'data-new' } }));
      return;
    }
    const active = list.filter((s) => s.active);
    const monthly = active.reduce((s, x) => s + Number(x.monthly_equivalent), 0);
    body.innerHTML = String(html`
      <div class="totals-strip"><div><span class="eyebrow">Al mes</span><b class="num">${money(monthly)}</b></div>
        <div><span class="eyebrow">Al año</span><b class="num">${money(monthly * 12)}</b></div></div>
      <div class="list stagger">${list.map((s, i) => html`<div class="list-row sub-row ${s.active ? '' : 'inactive'}" style="--i:${i}">
        <button class="sub-main" data-id="${s.id}">
          <span class="sub-logo" style="--c:${s.color}">${initials(s.name).slice(0, 1)}</span>
          <div class="grow"><div class="row-title">${s.name}</div>
            <div class="row-sub">${s.active ? `${inDays(s.days_left)} · ${dateShort(s.next_charge_date)}` : 'Pausada'}${s.auto_register ? ' · automático' : ''}</div></div>
          <div class="stack" style="align-items:flex-end"><span class="row-amount">${money(s.amount)}</span><span class="row-sub">${FREQ[s.frequency]}</span></div>
        </button>
        ${s.active ? html`<button class="icon-btn" data-charge="${s.id}" aria-label="Registrar cobro de ${s.name} ahora">${icon('check')}</button>` : ''}
      </div>`)}</div>`);
  };
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openSubForm()),
    on(screen, 'click', '[data-id]', (e, b) => openSubForm(state.subscriptions.find((s) => s.id === b.dataset.id))),
    on(screen, 'click', '[data-charge]', async (e, b) => {
      const s = state.subscriptions.find((x) => x.id === b.dataset.charge);
      if (!(await confirmDialog({ title: `¿Registrar el cobro de ${s.name}?`, message: `Creo un gasto de ${money(s.amount)} y paso la próxima fecha al siguiente periodo.`, confirm: 'Registrar' }))) return;
      try { await chargeNow(s.id); toast('Cobro registrado'); } catch (err) { toast(err.message, { type: 'err' }); }
    }),
    subscribe('subscriptions', render),
  ];
  render();
  refresh('subscriptions');
  return () => offs.forEach((f) => f());
}
