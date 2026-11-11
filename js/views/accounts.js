// Cuentas: efectivo, bancos, billeteras (Nequi, Daviplata…) con su saldo calculado
import { html, on } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money } from '../utils/format.js';
import { state, subscribe } from '../state.js';
import { createAccount, updateAccount, deleteAccount } from '../api/accounts.js';
import { updateProfile } from '../api/profile.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { toast } from '../ui/toast.js';

export const title = 'Cuentas';
const TYPES = { cash: 'Efectivo', bank: 'Cuenta bancaria', wallet: 'Billetera digital', savings: 'Ahorros', other: 'Otra' };
const TYPE_ICON = { cash: 'wallet', bank: 'bank', wallet: 'phone', savings: 'target', other: 'dots' };

export function openAccountForm(acc = null) {
  return formSheet({
    title: acc ? 'Editar cuenta' : 'Nueva cuenta',
    fields: [
      { name: 'name', label: 'Nombre', value: acc?.name, required: true, placeholder: 'Ej. Nequi, Bancolombia ahorros' },
      { name: 'type', label: 'Tipo', type: 'select', value: acc?.type ?? 'bank', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) },
      { name: 'initial_balance', label: acc ? 'Saldo inicial' : 'Saldo actual', type: 'amount', value: acc?.initial_balance ?? 0,
        hint: 'Desde aquí sumo ingresos y resto gastos para calcular el saldo.' },
      { name: 'color', label: 'Color', type: 'color', value: acc?.color ?? '#3FA672' },
      ...(acc ? [{ name: 'archived', label: 'Archivar cuenta', type: 'switch', value: acc.archived, hint: 'Deja de aparecer al registrar.' }] : []),
      { name: 'is_default', label: 'Cuenta por defecto', type: 'switch', value: acc ? state.profile?.default_account_id === acc.id : !state.accounts.length,
        hint: 'Se usa cuando no dices con qué pagaste.' },
    ],
    onSubmit: async ({ is_default, ...v }) => {
      let id = acc?.id;
      if (acc) await updateAccount(acc.id, v);
      else id = (await createAccount(v)).id;
      if (is_default && state.profile?.default_account_id !== id) await updateProfile({ default_account_id: id });
      toast(acc ? 'Cuenta actualizada' : 'Cuenta agregada');
    },
    onDelete: acc ? async () => { await deleteAccount(acc.id); toast('Cuenta eliminada'); } : null,
    deleteConfirm: { title: '¿Eliminar esta cuenta?', message: 'Los movimientos se conservan pero quedarán sin cuenta. Si solo quieres ocultarla, mejor archívala.' },
  });
}

export function mount(screen) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Cuentas', back: true, right: html`<button class="icon-btn filled" data-new aria-label="Nueva cuenta">${icon('plus', { stroke: 2.2 })}</button>` })}
    <div class="scroller"><div class="content"><div class="acc-body"></div></div></div>`);
  const body = screen.querySelector('.acc-body');

  const render = () => {
    const active = state.accounts.filter((a) => !a.archived);
    const archived = state.accounts.filter((a) => a.archived);
    if (!state.accounts.length) {
      body.innerHTML = String(emptyState({ illus: 'wallet', title: 'Sin cuentas', text: 'Agrega dónde tienes tu plata: efectivo, bancos o billeteras.', action: { label: 'Agregar cuenta', attrs: 'data-new' } }));
      return;
    }
    const total = active.reduce((s, a) => s + Number(a.balance), 0);
    const row = (a) => html`<button class="list-row tappable" data-id="${a.id}">
      <span class="cat-icon" style="--c:${a.color}">${icon(TYPE_ICON[a.type] ?? 'wallet', { size: 20 })}</span>
      <div class="grow"><div class="row-title">${a.name}${state.profile?.default_account_id === a.id ? html` <span class="tag accent">Por defecto</span>` : ''}</div>
        <div class="row-sub">${TYPES[a.type]}</div></div>
      <div class="row-amount ${Number(a.balance) < 0 ? 'expense-txt' : ''}">${money(a.balance)}</div></button>`;
    body.innerHTML = String(html`
      <div class="big-total"><span class="eyebrow">Saldo total</span><b class="num">${money(total)}</b></div>
      <div class="list stagger">${active.map(row)}</div>
      ${archived.length ? html`<div class="eyebrow mt-8 mb-2">Archivadas</div><div class="list muted-list">${archived.map(row)}</div>` : ''}`);
  };
  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openAccountForm()),
    on(screen, 'click', '[data-id]', (e, b) => openAccountForm(state.accounts.find((a) => a.id === b.dataset.id))),
    subscribe('accounts', render),
    subscribe('profile', render),
  ];
  render();
  refresh('accounts');
  return () => offs.forEach((f) => f());
}
