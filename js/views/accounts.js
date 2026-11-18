// Cuentas: efectivo, bancos, billeteras (Nequi, Daviplata…) con su saldo calculado.
// Tocar una cuenta abre su extracto (#/cuentas/:id); mantener presionado abre sus opciones.
import { html, on, raw } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { money, number } from '../utils/format.js';
import { haptic } from '../utils/haptics.js';
import { reducedMotion } from '../utils/motion.js';
import { state, subscribe, accountById } from '../state.js';
import { createAccount, updateAccount, deleteAccount } from '../api/accounts.js';
import { updateProfile } from '../api/profile.js';
import { refresh } from '../api/catalog.js';
import { topbar, bindTopbar } from '../ui/common.js';
import { emptyState } from '../ui/empty.js';
import { formSheet } from '../ui/form.js';
import { openSheet } from '../ui/sheet.js';
import { actionMenu } from '../ui/action-menu.js';
import { confirmDialog } from '../ui/modal.js';
import { bindAmountInput, autosizeAmount } from '../ui/number-input.js';
import { enableLongPress, pullToRefresh } from '../ui/gestures.js';
import { runSave } from '../ui/submit.js';
import { ORB_SPINNER } from '../ui/orb-loader.js';
import { toast } from '../ui/toast.js';
import { isHidden, toggle as togglePrivacy, onPrivacyChange } from '../privacy.js';
import { sensitiveAmount } from '../ui/sensitive.js';
import { reconcile } from '../utils/account-ledger.js';

export const title = 'Cuentas';
export const PRIV = 'accounts';
export const TYPES = { cash: 'Efectivo', bank: 'Cuenta bancaria', wallet: 'Billetera digital', savings: 'Ahorros', other: 'Otra' };
export const TYPE_ICON = { cash: 'wallet', bank: 'bank', wallet: 'phone', savings: 'target', other: 'dots' };

/** Ícono de la cuenta con su color; `vt` le da nombre para la transición compartida lista ↔ detalle */
export const accountIcon = (a, { lg = false, vt = false } = {}) => html`<span class="cat-icon ${lg ? 'lg' : ''}" style="--c:${a.color}${vt ? ';view-transition-name:acc-hero' : ''}">${icon(TYPE_ICON[a.type] ?? 'wallet', { size: lg ? 24 : 20 })}</span>`;

export const isDefault = (a) => state.profile?.default_account_id === a?.id;

export function openAccountForm(acc = null, { onDeleted } = {}) {
  return formSheet({
    title: acc ? 'Editar cuenta' : 'Nueva cuenta',
    fields: [
      { name: 'name', label: 'Nombre', value: acc?.name, required: true, placeholder: 'Ej. Nequi, Bancolombia ahorros' },
      { name: 'type', label: 'Tipo', type: 'select', value: acc?.type ?? 'bank', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) },
      { name: 'initial_balance', label: acc ? 'Saldo inicial' : 'Saldo actual', type: 'amount', value: acc?.initial_balance ?? 0,
        hint: acc ? 'El saldo con el que empezó la cuenta. Desde aquí sumo ingresos y resto gastos.' : 'Desde aquí sumo ingresos y resto gastos para calcular el saldo.' },
      { name: 'color', label: 'Color', type: 'color', value: acc?.color ?? '#3FA672' },
      ...(acc ? [{ name: 'archived', label: 'Archivar cuenta', type: 'switch', value: acc.archived, hint: 'Deja de aparecer al registrar.' }] : []),
      { name: 'is_default', label: 'Cuenta por defecto', type: 'switch', value: acc ? isDefault(acc) : !state.accounts.length,
        hint: 'Se usa cuando no dices con qué pagaste.' },
    ],
    onSubmit: async ({ is_default, ...v }) => {
      let id = acc?.id;
      if (acc) await updateAccount(acc.id, v);
      else id = (await createAccount(v)).id;
      if (is_default && state.profile?.default_account_id !== id) await updateProfile({ default_account_id: id });
      toast(acc ? 'Cuenta actualizada' : 'Cuenta agregada');
    },
    onDelete: acc ? async () => { await deleteAccount(acc.id); toast('Cuenta eliminada'); onDeleted?.(); } : null,
    deleteConfirm: { title: '¿Eliminar esta cuenta?', message: 'Los movimientos se conservan pero quedarán sin cuenta. Si solo quieres ocultarla, mejor archívala.' },
  });
}

/** Cuadrar saldo con el banco: ajusta el saldo inicial por la diferencia (no crea ingresos ni gastos) */
export function openReconcile(acc) {
  const hidden = isHidden(PRIV);
  const s = openSheet({
    title: 'Cuadrar saldo',
    detent: 'large',
    body: html`<p class="muted small">Escribe lo que te muestra la app de tu banco o lo que tienes en la mano. Ajusto el saldo inicial por la diferencia: no aparece como ingreso ni como gasto.</p>
      <div class="rc-now"><span class="eyebrow">Lukas calcula</span><b class="num">${sensitiveAmount(acc.balance, { hidden })}</b></div>
      <label class="amount-input"><span class="cur">$</span><input name="amount" value="${hidden ? '' : number(Math.max(0, acc.balance))}" placeholder="0" aria-label="Saldo real"></label>
      <p class="rc-diff center small" aria-live="polite"></p>`,
    footer: html`<button class="btn btn-primary btn-block" data-submit><span class="btn-label">Cuadrar</span>${raw(ORB_SPINNER)}</button>`,
  });
  const diffEl = s.body.querySelector('.rc-diff');
  const input = s.body.querySelector('[name="amount"]');
  let amt = null;
  const paintDiff = () => {
    if (!amt) return; // bindAmountInput avisa una vez antes de devolver el control
    const empty = !input.value.trim();
    const { delta } = reconcile(acc, amt.value);
    diffEl.className = `rc-diff center small ${empty ? '' : delta > 0 ? 'income' : delta < 0 ? 'expense-txt' : 'muted'}`;
    diffEl.textContent = empty ? '' : hidden ? (delta === 0 ? 'Ya está cuadrada' : 'Ajustaré la diferencia')
      : delta === 0 ? 'Ya está cuadrada' : `${delta > 0 ? 'Sumo' : 'Resto'} ${money(Math.abs(delta))} al saldo`;
  };
  amt = bindAmountInput(input, { onChange: paintDiff });
  autosizeAmount(input); // el "$" queda pegado al número
  paintDiff();
  setTimeout(() => { input.focus(); input.select?.(); }, 420);
  const btn = s.foot.querySelector('[data-submit]');
  btn.addEventListener('click', async () => {
    if (!input.value.trim()) { toast('Escribe el saldo real', { type: 'err' }); return; }
    const r = await runSave(async () => {
      const { delta, initial_balance } = reconcile(acc, amt.value);
      if (delta === 0) { toast('Ya estaba cuadrada', { type: 'info' }); return; }
      await updateAccount(acc.id, { initial_balance });
      toast(`Listo: ${delta > 0 ? 'sumé' : 'resté'} ${money(Math.abs(delta))}`);
    }, { button: btn });
    if (r.ok) { haptic.success(); s.close(); }
  });
}

/**
 * Menú de opciones de una cuenta (botón ⋯ del detalle o mantener presionado en la lista).
 * onDeleted: qué hacer después de eliminarla (p. ej. volver a la lista).
 */
export async function accountMenu(acc, { fromList = false, onDeleted } = {}) {
  const hidden = isHidden(PRIV);
  const act = await actionMenu({
    label: `Opciones de ${acc.name}`,
    header: html`<div class="am-acc">${accountIcon(acc)}<div class="grow"><b class="ellipsis">${acc.name}</b><span>${TYPES[acc.type] ?? ''} · ${sensitiveAmount(acc.balance, { hidden })}</span></div></div>`,
    quick: fromList ? [{ id: 'open', label: 'Movimientos', icon: 'list', primary: true }, { id: 'edit', label: 'Editar', icon: 'edit' },
      { id: 'reconcile', label: 'Cuadrar', icon: 'check' }, { id: 'archive', label: acc.archived ? 'Desarchivar' : 'Archivar', icon: 'archive' }] : [],
    actions: [
      ...(fromList ? [] : [{ id: 'edit', label: 'Editar cuenta', icon: 'edit' }, { id: 'reconcile', label: 'Cuadrar saldo con el banco', icon: 'check' }]),
      ...(isDefault(acc) || acc.archived ? [] : [{ id: 'default', label: 'Usar por defecto', icon: 'pin' }]),
      ...(fromList ? [] : [{ id: 'archive', label: acc.archived ? 'Desarchivar' : 'Archivar', icon: 'archive' }]),
      { id: 'delete', label: 'Eliminar cuenta', icon: 'trash', danger: true },
    ],
  });
  if (!act) return;
  const fresh = accountById(acc.id) ?? acc;
  try {
    if (act === 'open') location.hash = `#/cuentas/${acc.id}`;
    if (act === 'edit') openAccountForm(fresh, { onDeleted });
    if (act === 'reconcile') openReconcile(fresh);
    if (act === 'default') { await updateProfile({ default_account_id: acc.id }); haptic.success(); toast(`${acc.name} es ahora tu cuenta por defecto`); }
    if (act === 'archive') {
      await updateAccount(acc.id, { archived: !fresh.archived });
      toast(fresh.archived ? 'Cuenta desarchivada' : 'Cuenta archivada', fresh.archived ? {} : { action: { label: 'Deshacer', fn: () => updateAccount(acc.id, { archived: false }) } });
    }
    if (act === 'delete') {
      const ok = await confirmDialog({ title: `¿Eliminar ${acc.name}?`, message: 'Los movimientos se conservan pero quedarán sin cuenta. Si solo quieres ocultarla, mejor archívala.', confirm: 'Eliminar', danger: true });
      if (!ok) return;
      await deleteAccount(acc.id);
      haptic.warning();
      toast('Cuenta eliminada');
      onDeleted?.();
    }
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

// La última cuenta abierta conserva el nombre de transición al volver, para que el ícono regrese a su fila
let lastOpened = null;

export function mount(screen, { navigate }) {
  screen.innerHTML = String(html`
    ${topbar({ title: 'Cuentas', back: true, right: html`<div class="tb-right">
      <button class="icon-btn" data-eye aria-pressed="false">${icon('eye')}</button>
      <button class="icon-btn filled" data-new aria-label="Nueva cuenta">${icon('plus', { stroke: 2.2 })}</button></div>` })}
    <div class="scroller"><div class="content"><div class="acc-body"></div></div></div>`);
  const body = screen.querySelector('.acc-body');
  const eye = screen.querySelector('[data-eye]');
  const scroller = screen.querySelector('.scroller');
  let firstPaint = true;

  const render = () => {
    const h = isHidden(PRIV);
    eye.innerHTML = String(icon(h ? 'eye-off' : 'eye'));
    eye.classList.toggle('on', h);
    eye.setAttribute('aria-pressed', String(h));
    eye.setAttribute('aria-label', h ? 'Mostrar saldos' : 'Ocultar saldos');
    const active = state.accounts.filter((a) => !a.archived);
    const archived = state.accounts.filter((a) => a.archived);
    if (!state.accounts.length) {
      body.innerHTML = String(emptyState({ illus: 'wallet', title: 'Sin cuentas', text: 'Agrega dónde tienes tu plata: efectivo, bancos o billeteras.', action: { label: 'Agregar cuenta', attrs: 'data-new' } }));
      return;
    }
    const total = active.reduce((s, a) => s + Number(a.balance), 0);
    const row = (a, i) => html`<button class="list-row tappable acc-row" data-id="${a.id}" style="--i:${Math.min(i, 10)}"
        aria-label="${a.name}, ${h ? 'saldo oculto' : money(a.balance)}. Ver movimientos">
      ${accountIcon(a, { vt: a.id === lastOpened && !reducedMotion() })}
      <div class="grow"><div class="row-title ellipsis">${a.name}${isDefault(a) ? html` <span class="tag accent">Por defecto</span>` : ''}</div>
        <div class="row-sub">${TYPES[a.type]}</div></div>
      <div class="row-amount ${Number(a.balance) < 0 ? 'expense-txt' : ''}">${sensitiveAmount(a.balance, { hidden: h })}</div>
      ${icon('chevron-right', { size: 18, cls: 'chev' })}</button>`;
    body.innerHTML = String(html`
      <div class="big-total"><span class="eyebrow">Saldo total</span><b class="num">${sensitiveAmount(total, { hidden: h })}</b>
        <span class="muted small">${active.length} ${active.length === 1 ? 'cuenta activa' : 'cuentas activas'}</span></div>
      <div class="list ${firstPaint ? 'stagger' : ''}">${active.map(row)}</div>
      ${archived.length ? html`<div class="eyebrow mt-8 mb-2">Archivadas</div><div class="list muted-list">${archived.map(row)}</div>` : ''}
      <p class="acc-hint">Toca una cuenta para ver de dónde entra y a dónde sale tu plata</p>`);
    firstPaint = false;
    // La transición de vuelta ya ocurrió: se quita el nombre para que no choque con el siguiente detalle
    if (lastOpened) setTimeout(() => body.querySelector('[style*="view-transition-name"]')?.style.removeProperty('view-transition-name'), 700);
  };

  const open = (id) => {
    haptic.tap();
    lastOpened = id;
    body.querySelectorAll('[style*="view-transition-name"]').forEach((n) => n.style.removeProperty('view-transition-name'));
    const ic = body.querySelector(`.acc-row[data-id="${id}"] .cat-icon`);
    if (ic && !reducedMotion()) ic.style.viewTransitionName = 'acc-hero'; // el ícono "vuela" al encabezado del detalle
    navigate(`cuentas/${id}`);
  };

  const offs = [
    bindTopbar(screen),
    on(screen, 'click', '[data-new]', () => openAccountForm()),
    on(screen, 'click', '[data-id]', (e, b) => open(b.dataset.id)),
    on(screen, 'click', '[data-eye]', () => { haptic.select(); togglePrivacy(PRIV); }),
    enableLongPress(body, '.acc-row', (node) => { const a = accountById(node.dataset.id); if (a) accountMenu(a, { fromList: true }); }),
    pullToRefresh(scroller, () => refresh('accounts')),
    onPrivacyChange(render),
    subscribe('accounts', render),
    subscribe('profile', render),
  ];
  render();
  refresh('accounts');
  return () => offs.forEach((f) => f());
}
