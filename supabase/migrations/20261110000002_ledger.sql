-- Lukas · datos por defecto, libro mayor de tarjetas y RPC transaccionales

-- ───────────────────────── datos por defecto del usuario ─────────────────────────
create or replace function public.seed_user_defaults(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_cash uuid;
begin
  if p_user is null then return; end if;

  insert into public.profiles (user_id) values (p_user) on conflict (user_id) do nothing;

  insert into public.categories (user_id, system_key, name, kind, icon, color, sort_order)
  select p_user, k, n, kd, i, c, o from (values
    ('food',          'Comida y restaurantes',   'expense', 'utensils', '#F08A4B', 10),
    ('groceries',     'Mercado',                 'expense', 'cart',     '#3FA672', 20),
    ('transport',     'Transporte',              'expense', 'bus',      '#3D8BE0', 30),
    ('home',          'Hogar',                   'expense', 'home',     '#B9855A', 40),
    ('utilities',     'Servicios públicos',      'expense', 'bolt',     '#E6B422', 50),
    ('rent',          'Arriendo',                'expense', 'key',      '#7A6A58', 60),
    ('partner',       'Pareja',                  'expense', 'heart',    '#E5527A', 70),
    ('health',        'Salud',                   'expense', 'pulse',    '#2FB3A6', 80),
    ('education',     'Educación',               'expense', 'book',     '#5B6CF0', 90),
    ('entertainment', 'Entretenimiento',         'expense', 'ticket',   '#A65BE0', 100),
    ('subscriptions', 'Suscripciones',           'expense', 'repeat',   '#E0606B', 110),
    ('clothes',       'Ropa',                    'expense', 'shirt',    '#D3779F', 120),
    ('tech',          'Tecnología',              'expense', 'device',   '#4A5568', 130),
    ('pets',          'Mascotas',                'expense', 'paw',      '#C08A3E', 140),
    ('gifts',         'Regalos',                 'expense', 'gift',     '#E46C9A', 150),
    ('travel',        'Viajes',                  'expense', 'plane',    '#2E9FD0', 160),
    ('finance',       'Gastos financieros',      'expense', 'bank',     '#6B7280', 170),
    ('other_expense', 'Otros',                   'expense', 'dots',     '#9A9A92', 180),
    ('salary',        'Salario',                 'income',  'briefcase','#1E9E6A', 10),
    ('sales',         'Ventas',                  'income',  'tag',      '#2BAE7E', 20),
    ('freelance',     'Freelance',               'income',  'laptop',   '#34A0A4', 30),
    ('transfers_in',  'Transferencias recibidas','income',  'arrow-in', '#4C9F70', 40),
    ('refunds',       'Reembolsos',              'income',  'undo',     '#6DAF5F', 50),
    ('other_income',  'Otros ingresos',          'income',  'plus',     '#7FB77E', 60)
  ) as v(k, n, kd, i, c, o)
  on conflict (user_id, system_key) do nothing;

  insert into public.categories (user_id, system_key, name, kind, icon, color, sort_order, parent_id)
  select p_user, v.k, v.n, 'expense', v.i, p.color, v.o, p.id
  from (values
    ('transport_bus',     'Bus',                'bus',     'transport', 1),
    ('transport_taxi',    'Taxi',               'car',     'transport', 2),
    ('transport_fuel',    'Gasolina',           'fuel',    'transport', 3),
    ('transport_parking', 'Parqueadero',        'parking', 'transport', 4),
    ('finance_interest',  'Intereses',          'percent', 'finance',   1),
    ('finance_fee',       'Cuota de manejo',    'card',    'finance',   2),
    ('finance_4x1000',    '4x1000',             'bank',    'finance',   3),
    ('finance_debt',      'Cuotas de créditos', 'bank',    'finance',   4)
  ) as v(k, n, i, parent_key, o)
  join public.categories p on p.user_id = p_user and p.system_key = v.parent_key
  on conflict (user_id, system_key) do nothing;

  if not exists (select 1 from public.accounts where user_id = p_user) then
    insert into public.accounts (user_id, name, type, color, sort_order)
    values (p_user, 'Efectivo', 'cash', '#3FA672', 0) returning id into v_cash;
    update public.profiles set default_account_id = v_cash where user_id = p_user and default_account_id is null;
  end if;
end $$;

revoke all on function public.seed_user_defaults(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_user_defaults(new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Red de seguridad: el cliente la llama al iniciar sesión
create or replace function public.ensure_profile() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  perform public.seed_user_defaults(auth.uid());
  select * into v from public.profiles where user_id = auth.uid();
  return v;
end $$;
revoke all on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- ───────────────────────── libro mayor de tarjetas ─────────────────────────
-- Toda transacción que toca una tarjeta mantiene su card_movement en la misma transacción SQL:
--   gasto con tarjeta      → charge / interest / fee (sube la deuda)
--   ingreso a la tarjeta   → adjustment negativo (reembolso)
--   transfer a la tarjeta  → payment (baja la deuda, no es gasto)
create or replace function public.sync_transaction_links() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  delete from card_movements where transaction_id = new.id;

  if new.type = 'expense' and new.card_id is not null then
    insert into card_movements (user_id, card_id, kind, amount, occurred_at, note, transaction_id)
    values (new.user_id, new.card_id, new.card_movement_kind, new.amount, new.occurred_at, new.description, new.id);
  elsif new.type = 'income' and new.card_id is not null then
    insert into card_movements (user_id, card_id, kind, amount, occurred_at, note, transaction_id)
    values (new.user_id, new.card_id, 'adjustment', -new.amount, new.occurred_at, new.description, new.id);
  elsif new.type = 'transfer' and new.to_card_id is not null then
    insert into card_movements (user_id, card_id, kind, amount, occurred_at, note, transaction_id)
    values (new.user_id, new.to_card_id, 'payment', new.amount, new.occurred_at, new.description, new.id);
  end if;

  if tg_op = 'UPDATE' then
    update debt_payments set amount = new.amount, paid_at = (new.occurred_at at time zone 'America/Bogota')::date
      where transaction_id = new.id;
    update goal_contributions set amount = new.amount, contributed_at = (new.occurred_at at time zone 'America/Bogota')::date
      where transaction_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists sync_transaction_links on public.transactions;
create trigger sync_transaction_links after insert or update on public.transactions
  for each row execute function public.sync_transaction_links();

-- Ancla del día de cobro de suscripciones (para no "derivar" fechas en meses cortos)
create or replace function public.subscription_anchor() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('lukas.advancing', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' or new.next_charge_date is distinct from old.next_charge_date then
    new.anchor_day := extract(day from new.next_charge_date)::smallint;
  end if;
  return new;
end $$;

drop trigger if exists subscription_anchor on public.subscriptions;
create trigger subscription_anchor before insert or update on public.subscriptions
  for each row execute function public.subscription_anchor();

create or replace function public.next_subscription_date(p_date date, p_frequency text, p_anchor int) returns date
language sql immutable as $$
  select case p_frequency
    when 'weekly' then p_date + 7
    when 'yearly' then public.clamp_day(extract(year from p_date)::int + 1, extract(month from p_date)::int, coalesce(p_anchor, extract(day from p_date)::int))
    else public.clamp_day(extract(year from (p_date + interval '1 month'))::int,
                          extract(month from (p_date + interval '1 month'))::int,
                          coalesce(p_anchor, extract(day from p_date)::int))
  end
$$;

-- helper: id de categoría del sistema para el usuario actual (o dado)
create or replace function public.system_category(p_key text, p_user uuid default auth.uid()) returns uuid
language sql stable security invoker set search_path = public as $$
  select id from categories where user_id = p_user and system_key = p_key limit 1
$$;

-- ───────────────────────── RPC: transacciones ─────────────────────────
create or replace function public.create_transactions(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb; it jsonb; v_id uuid; v_ids jsonb := '[]'::jsonb; v_groups jsonb := '{}'::jsonb;
  v_gkey text; v_gid uuid; i int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No hay movimientos para guardar';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_gkey := nullif(r->>'group_id', '');
    v_gid := null;
    if v_gkey is not null then
      if v_groups ? v_gkey then
        v_gid := (v_groups->>v_gkey)::uuid;
      else
        v_gid := case when v_gkey ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then v_gkey::uuid else gen_random_uuid() end;
        v_groups := v_groups || jsonb_build_object(v_gkey, v_gid);
      end if;
    end if;

    insert into transactions (id, type, amount, occurred_at, description, category_id, account_id, card_id,
      to_account_id, to_card_id, notes, source, transcript, group_id, card_movement_kind)
    values (
      coalesce(nullif(r->>'id', '')::uuid, gen_random_uuid()),
      r->>'type',
      (r->>'amount')::bigint,
      coalesce(nullif(r->>'occurred_at', '')::timestamptz, now()),
      coalesce(r->>'description', ''),
      nullif(r->>'category_id', '')::uuid,
      nullif(r->>'account_id', '')::uuid,
      nullif(r->>'card_id', '')::uuid,
      nullif(r->>'to_account_id', '')::uuid,
      nullif(r->>'to_card_id', '')::uuid,
      nullif(r->>'notes', ''),
      coalesce(nullif(r->>'source', ''), 'manual'),
      nullif(r->>'transcript', ''),
      v_gid,
      coalesce(nullif(r->>'card_movement_kind', ''), 'charge')
    )
    on conflict (id) do nothing
    returning id into v_id;

    if v_id is null then continue; end if; -- ya existía (reintento de la cola offline)

    i := 0;
    if jsonb_typeof(r->'items') = 'array' then
      for it in select value from jsonb_array_elements(r->'items') loop
        insert into transaction_items (transaction_id, name, qty, unit_amount, sort_order)
        values (v_id, coalesce(nullif(it->>'name', ''), 'Ítem'), greatest(coalesce((it->>'qty')::numeric, 1), 0.01),
                greatest(coalesce((it->>'unit_amount')::bigint, 0), 0), i);
        i := i + 1;
      end loop;
    end if;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return v_ids;
end $$;

create or replace function public.update_transaction(p_id uuid, p_row jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare it jsonb; i int := 0;
begin
  update transactions set
    type = coalesce(p_row->>'type', type),
    amount = coalesce((p_row->>'amount')::bigint, amount),
    occurred_at = coalesce(nullif(p_row->>'occurred_at', '')::timestamptz, occurred_at),
    description = coalesce(p_row->>'description', description),
    category_id = case when p_row ? 'category_id' then nullif(p_row->>'category_id', '')::uuid else category_id end,
    account_id = case when p_row ? 'account_id' then nullif(p_row->>'account_id', '')::uuid else account_id end,
    card_id = case when p_row ? 'card_id' then nullif(p_row->>'card_id', '')::uuid else card_id end,
    to_account_id = case when p_row ? 'to_account_id' then nullif(p_row->>'to_account_id', '')::uuid else to_account_id end,
    notes = case when p_row ? 'notes' then nullif(p_row->>'notes', '') else notes end
  where id = p_id;
  if not found then raise exception 'Movimiento no encontrado'; end if;

  if jsonb_typeof(p_row->'items') = 'array' then
    delete from transaction_items where transaction_id = p_id;
    for it in select value from jsonb_array_elements(p_row->'items') loop
      insert into transaction_items (transaction_id, name, qty, unit_amount, sort_order)
      values (p_id, coalesce(nullif(it->>'name', ''), 'Ítem'), greatest(coalesce((it->>'qty')::numeric, 1), 0.01),
              greatest(coalesce((it->>'unit_amount')::bigint, 0), 0), i);
      i := i + 1;
    end loop;
  end if;
  return p_id;
end $$;

create or replace function public.delete_transactions(p_ids uuid[]) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  delete from transactions where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────── RPC: tarjetas ─────────────────────────
-- Pagar la tarjeta: transferencia desde una cuenta (no es gasto) + intereses opcionales (sí son gasto).
create or replace function public.pay_card(
  p_card_id uuid, p_account_id uuid, p_amount bigint,
  p_date timestamptz default now(), p_interest bigint default 0, p_note text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_card credit_cards; v_pay uuid; v_int uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select * into v_card from credit_cards where id = p_card_id;
  if not found then raise exception 'Tarjeta no encontrada'; end if;

  insert into transactions (user_id, type, amount, occurred_at, description, account_id, to_card_id, notes, source)
  values (v_card.user_id, 'transfer', p_amount, coalesce(p_date, now()), 'Pago ' || v_card.name, p_account_id, p_card_id, p_note, 'manual')
  returning id into v_pay;

  if coalesce(p_interest, 0) > 0 then
    insert into transactions (user_id, type, amount, occurred_at, description, category_id, card_id, card_movement_kind, source)
    values (v_card.user_id, 'expense', p_interest, coalesce(p_date, now()), 'Intereses ' || v_card.name,
            public.system_category('finance_interest', v_card.user_id), p_card_id, 'interest', 'manual')
    returning id into v_int;
  end if;
  return jsonb_build_object('payment_id', v_pay, 'interest_id', v_int);
end $$;

-- Interés o cuota de manejo: sube la deuda y cuenta como gasto en "Gastos financieros"
create or replace function public.card_extra_charge(
  p_card_id uuid, p_kind text, p_amount bigint, p_date timestamptz default now(), p_note text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_card credit_cards; v_id uuid;
begin
  if p_kind not in ('interest', 'fee') then raise exception 'Tipo inválido'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select * into v_card from credit_cards where id = p_card_id;
  if not found then raise exception 'Tarjeta no encontrada'; end if;

  insert into transactions (user_id, type, amount, occurred_at, description, category_id, card_id, card_movement_kind, notes, source)
  values (v_card.user_id, 'expense', p_amount, coalesce(p_date, now()),
          case p_kind when 'interest' then 'Intereses ' else 'Cuota de manejo ' end || v_card.name,
          public.system_category(case p_kind when 'interest' then 'finance_interest' else 'finance_fee' end, v_card.user_id),
          p_card_id, p_kind, p_note, 'manual')
  returning id into v_id;
  return v_id;
end $$;

-- Cuadrar con el extracto: ajuste por la diferencia (no es gasto)
create or replace function public.adjust_card_balance(p_card_id uuid, p_target_debt bigint, p_note text default null)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare v_card credit_cards; v_debt bigint; v_delta bigint;
begin
  select * into v_card from credit_cards where id = p_card_id;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select v_card.initial_debt + coalesce(sum(case when kind = 'payment' then -amount else amount end), 0)
    into v_debt from card_movements where card_id = p_card_id;
  v_delta := p_target_debt - v_debt;
  if v_delta <> 0 then
    insert into card_movements (user_id, card_id, kind, amount, note)
    values (v_card.user_id, p_card_id, 'adjustment', v_delta, coalesce(p_note, 'Ajuste con extracto'));
  end if;
  return v_delta;
end $$;

-- ───────────────────────── RPC: créditos, metas, suscripciones ─────────────────────────
create or replace function public.pay_debt(
  p_debt_id uuid, p_amount bigint, p_account_id uuid default null, p_mode text default 'expense',
  p_date timestamptz default now(), p_note text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_debt debts; v_tx uuid; v_acc uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  if p_mode not in ('expense', 'transfer') then raise exception 'Modo inválido'; end if;
  select * into v_debt from debts where id = p_debt_id;
  if not found then raise exception 'Crédito no encontrado'; end if;
  v_acc := coalesce(p_account_id, (select default_account_id from profiles where user_id = v_debt.user_id));

  insert into transactions (user_id, type, amount, occurred_at, description, category_id, account_id, debt_id, notes, source)
  values (v_debt.user_id, p_mode, p_amount, coalesce(p_date, now()), 'Cuota ' || v_debt.name,
          case when p_mode = 'expense' then public.system_category('finance_debt', v_debt.user_id) end,
          v_acc, p_debt_id, p_note, 'manual')
  returning id into v_tx;

  insert into debt_payments (user_id, debt_id, amount, paid_at, mode, transaction_id)
  values (v_debt.user_id, p_debt_id, p_amount, (coalesce(p_date, now()) at time zone 'America/Bogota')::date, p_mode, v_tx);
  return v_tx;
end $$;

create or replace function public.contribute_goal(
  p_goal_id uuid, p_amount bigint, p_account_id uuid default null,
  p_date timestamptz default now(), p_note text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_goal savings_goals; v_tx uuid;
begin
  if p_amount is null or p_amount = 0 then raise exception 'El monto no puede ser cero'; end if;
  select * into v_goal from savings_goals where id = p_goal_id;
  if not found then raise exception 'Meta no encontrada'; end if;

  if p_account_id is not null and p_amount > 0 then
    insert into transactions (user_id, type, amount, occurred_at, description, account_id, goal_id, notes, source)
    values (v_goal.user_id, 'transfer', p_amount, coalesce(p_date, now()), 'Ahorro ' || v_goal.name, p_account_id, p_goal_id, p_note, 'manual')
    returning id into v_tx;
  end if;

  insert into goal_contributions (user_id, goal_id, amount, contributed_at, account_id, transaction_id, note)
  values (v_goal.user_id, p_goal_id, p_amount, (coalesce(p_date, now()) at time zone 'America/Bogota')::date, p_account_id, v_tx, p_note);
  return p_goal_id;
end $$;

-- Registra el cobro de una suscripción y avanza su próxima fecha (lo usa el cron y el usuario)
create or replace function public.charge_subscription(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_sub subscriptions; v_tx uuid;
begin
  select * into v_sub from subscriptions where id = p_id for update;
  if not found then raise exception 'Suscripción no encontrada'; end if;

  insert into transactions (user_id, type, amount, occurred_at, description, category_id, account_id, card_id, source, subscription_id)
  values (v_sub.user_id, 'expense', v_sub.amount,
          (v_sub.next_charge_date + time '12:00') at time zone 'America/Bogota',
          v_sub.name,
          coalesce(v_sub.category_id, public.system_category('subscriptions', v_sub.user_id)),
          case when v_sub.card_id is null then coalesce(v_sub.account_id, (select default_account_id from profiles where user_id = v_sub.user_id)) end,
          v_sub.card_id, 'subscription', v_sub.id)
  returning id into v_tx;

  perform set_config('lukas.advancing', '1', true);
  update subscriptions
     set next_charge_date = public.next_subscription_date(next_charge_date, frequency, anchor_day)
   where id = p_id;
  perform set_config('lukas.advancing', '', true);
  return v_tx;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update notifications set read_at = now()
   where read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- Las RPC solo para usuarios autenticados (y service_role)
do $$
declare f text;
begin
  foreach f in array array[
    'create_transactions(jsonb)', 'update_transaction(uuid,jsonb)', 'delete_transactions(uuid[])',
    'pay_card(uuid,uuid,bigint,timestamptz,bigint,text)', 'card_extra_charge(uuid,text,bigint,timestamptz,text)',
    'adjust_card_balance(uuid,bigint,text)', 'pay_debt(uuid,bigint,uuid,text,timestamptz,text)',
    'contribute_goal(uuid,bigint,uuid,timestamptz,text)', 'charge_subscription(uuid)',
    'mark_notifications_read(uuid[])', 'system_category(text,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
