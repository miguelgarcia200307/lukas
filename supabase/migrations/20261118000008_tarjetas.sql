-- Lukas · Tarjetas 2.0: personalización (apodo, emoji, acabado, orden, fijada), pago mínimo, recordatorios por tarjeta,
-- compras a cuotas, apodos para el asistente y la consulta "¿con cuál tarjeta pago hoy?".

-- ───────────────────────── columnas nuevas ─────────────────────────
alter table public.credit_cards
  add column if not exists nickname text check (nickname is null or length(nickname) between 1 and 30),
  add column if not exists emoji text check (emoji is null or length(emoji) <= 8),
  add column if not exists finish text not null default 'gradient' check (finish in ('gradient', 'metal', 'matte', 'glass')),
  -- segundo color para degradados de dos tonos (null = degradado del color principal)
  add column if not exists color2 text check (color2 is null or color2 ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists sort_order int not null default 0,
  add column if not exists pinned boolean not null default false,
  add column if not exists min_payment bigint check (min_payment is null or min_payment >= 0),
  -- días antes del corte / del pago para avisar (null = sin aviso para esta tarjeta; 0 = solo el mismo día)
  add column if not exists remind_cut_days smallint default 1 check (remind_cut_days is null or remind_cut_days between 0 and 10),
  add column if not exists remind_due_days smallint default 3 check (remind_due_days is null or remind_due_days between 0 and 10);

-- ───────────────────────── compras a cuotas ─────────────────────────
create table if not exists public.card_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  card_id uuid not null references public.credit_cards on delete cascade,
  description text not null check (length(description) between 1 and 80),
  installment_current smallint not null default 1 check (installment_current >= 1),
  installments_total smallint not null check (installments_total between 1 and 72),
  installment_amount bigint not null check (installment_amount > 0),
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ci_current_le_total check (installment_current <= installments_total)
);
create index if not exists ci_card_idx on public.card_installments (card_id);
create index if not exists ci_user_idx on public.card_installments (user_id);

drop trigger if exists set_updated_at on public.card_installments;
create trigger set_updated_at before update on public.card_installments for each row execute function public.set_updated_at();
alter table public.card_installments enable row level security;
drop policy if exists "own_select" on public.card_installments;
drop policy if exists "own_insert" on public.card_installments;
drop policy if exists "own_update" on public.card_installments;
drop policy if exists "own_delete" on public.card_installments;
create policy "own_select" on public.card_installments for select to authenticated using (user_id = (select auth.uid()));
-- solo sobre tarjetas propias
create policy "own_insert" on public.card_installments for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.credit_cards c where c.id = card_id and c.user_id = (select auth.uid())));
create policy "own_update" on public.card_installments for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.credit_cards c where c.id = card_id and c.user_id = (select auth.uid())));
create policy "own_delete" on public.card_installments for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.card_installments from anon;
grant select, insert, update, delete on public.card_installments to authenticated;

-- ───────────────────────── vista de estado ─────────────────────────
-- Las columnas nuevas van al final (create or replace view no permite reordenar las existentes)
create or replace view public.card_status with (security_invoker = true) as
select c.id, c.user_id, c.name, c.bank, c.brand, c.last4, c.credit_limit, c.cut_day, c.due_day,
  c.initial_debt, c.monthly_rate, c.color, c.archived, c.created_at,
  d.debt,
  c.credit_limit - d.debt as available,
  case when c.credit_limit > 0 then round(greatest(d.debt, 0) * 100.0 / c.credit_limit, 1) else 0 end as usage_pct,
  public.next_monthly_date(c.cut_day, public.bogota_today()) as next_cut_date,
  public.next_monthly_date(c.due_day, public.bogota_today()) as next_due_date,
  case when c.monthly_rate is not null then round(greatest(d.debt, 0) * c.monthly_rate / 100)::bigint end as est_interest,
  c.nickname, c.emoji, c.finish, c.color2, c.sort_order, c.pinned, c.min_payment, c.remind_cut_days, c.remind_due_days,
  coalesce(i.n, 0)::int as installments_count,
  coalesce(i.monthly, 0)::bigint as installments_monthly
from public.credit_cards c
cross join lateral (
  select c.initial_debt + coalesce(sum(case when m.kind = 'payment' then -m.amount else m.amount end), 0) as debt
  from public.card_movements m where m.card_id = c.id
) d
left join lateral (
  select count(*) as n, sum(ci.installment_amount) as monthly
  from public.card_installments ci where ci.card_id = c.id and ci.balance > 0
) i on true;
grant select on public.card_status to authenticated, service_role;

-- ───────────────────────── reordenar en un solo viaje ─────────────────────────
create or replace function public.reorder_cards(p_ids uuid[]) returns int
language sql security invoker set search_path = public as $$
  with o as (select t.id, t.ord from unnest(p_ids) with ordinality as t(id, ord)),
  u as (update credit_cards c set sort_order = o.ord from o where c.id = o.id returning 1)
  select count(*)::int from u
$$;
revoke all on function public.reorder_cards(uuid[]) from public, anon;
grant execute on function public.reorder_cards(uuid[]) to authenticated;

-- ───────────────────────── asistente: apodos y "¿con cuál pago hoy?" ─────────────────────────
-- El contexto incluye el apodo de cada tarjeta (6.º elemento) y las ordena como el usuario.
create or replace function public.ai_context_json(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', (select name from public.profiles where user_id = p_uid),
    'def', (select default_account_id from public.profiles where user_id = p_uid),
    'cats', coalesce((
      select jsonb_agg(jsonb_build_array(c.id, c.name, c.kind, c.parent_id, c.system_key)
        order by c.kind, coalesce(p.sort_order, c.sort_order), c.parent_id nulls first, c.sort_order, c.name)
      from public.categories c left join public.categories p on p.id = c.parent_id
      where c.user_id = p_uid and not c.archived and (p.id is null or not p.archived)), '[]'::jsonb),
    'accs', coalesce((select jsonb_agg(jsonb_build_array(a.id, a.name, a.type) order by a.sort_order, a.created_at)
      from public.accounts a where a.user_id = p_uid and not a.archived), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.name, c.bank, c.brand, c.last4, c.nickname)
        order by c.pinned desc, c.sort_order, c.created_at)
      from public.credit_cards c where c.user_id = p_uid and not c.archived), '[]'::jsonb),
    'debts', coalesce((select jsonb_agg(jsonb_build_array(d.id, d.name, d.lender, d.monthly_payment) order by d.created_at)
      from public.debts d where d.user_id = p_uid and not d.archived), '[]'::jsonb),
    'subs', coalesce((select jsonb_agg(jsonb_build_array(s.id, s.name, s.amount, s.frequency) order by s.created_at)
      from public.subscriptions s where s.user_id = p_uid and s.active), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(jsonb_build_array(g.id, g.name, g.target_amount) order by g.created_at)
      from public.savings_goals g where g.user_id = p_uid and not g.archived), '[]'::jsonb),
    'hints', coalesce((select jsonb_agg(jsonb_build_array(h.keyword, h.category_id, h.uses) order by h.uses desc, h.keyword)
      from (select h.keyword, h.category_id, h.uses from public.category_hints h
            join public.categories c on c.id = h.category_id and not c.archived
            where h.user_id = p_uid order by h.uses desc limit 300) h), '[]'::jsonb)
  )
$$;
revoke all on function public.ai_context_json(uuid) from public, anon, authenticated;

-- p_metric admite además card_best (todas las tarjetas activas, para elegir con cuál comprar hoy)
create or replace function public.ai_query(p_metric text, p_from date default null, p_to date default null,
  p_category uuid default null, p_card uuid default null, p_account uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', public.bogota_today())::date);
  v_to date := least(coalesce(p_to, public.bogota_today()), public.bogota_today());
  v_len int;
  v_res jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if v_to < v_from then v_to := v_from; end if;
  v_len := v_to - v_from + 1;

  if p_metric in ('spending', 'income') then
    with tx as (
      select t.amount, coalesce(c.parent_id, c.id) as top_cat, (t.occurred_at at time zone 'America/Bogota')::date as d
      from transactions t left join categories c on c.id = t.category_id
      where t.type = case when p_metric = 'spending' then 'expense' else 'income' end
        and t.occurred_at >= ((v_from - v_len)::timestamp at time zone 'America/Bogota')
        and t.occurred_at < ((v_to + 1)::timestamp at time zone 'America/Bogota')
        and (p_category is null or t.category_id = p_category or c.parent_id = p_category)
    )
    select jsonb_build_object(
      'total', coalesce(sum(amount) filter (where d >= v_from), 0),
      'count', count(*) filter (where d >= v_from),
      'prev_total', coalesce(sum(amount) filter (where d < v_from), 0),
      'top', coalesce((select jsonb_agg(jsonb_build_array(x.name, x.total) order by x.total desc) from (
          select c.name, sum(tx.amount) as total from tx join categories c on c.id = tx.top_cat
          where tx.d >= v_from group by c.name order by 2 desc limit 3) x), '[]'::jsonb))
    into v_res from tx;
  elsif p_metric = 'balance' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, balance) order by sort_order), '[]'::jsonb))
    into v_res from account_balances where not archived and (p_account is null or id = p_account);
  elsif p_metric in ('card_debt', 'card_dates', 'card_best') then
    -- card_best: todas las tarjetas activas (la mejor para comprar hoy se elige en código: _shared/card-pick.ts)
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, bank, greatest(debt, 0), available, credit_limit,
        next_cut_date, next_due_date, nickname, cut_day, due_day, usage_pct) order by pinned desc, sort_order, created_at), '[]'::jsonb))
    into v_res from card_status where not archived and (p_metric = 'card_best' or p_card is null or id = p_card);
  elsif p_metric = 'debts' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, balance, monthly_payment, next_due_date) order by created_at), '[]'::jsonb))
    into v_res from debt_status where not archived;
  elsif p_metric = 'subscriptions' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, amount, frequency, next_charge_date, monthly_equivalent) order by next_charge_date), '[]'::jsonb))
    into v_res from subscription_status where active;
  elsif p_metric = 'budget' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, period, spent, amount, pct)), '[]'::jsonb))
    into v_res from public.budget_status() where p_category is null or category_id = p_category;
  elsif p_metric = 'goals' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, saved, target_amount) order by created_at), '[]'::jsonb))
    into v_res from goal_status where not archived;
  else
    raise exception 'Métrica inválida: %', p_metric;
  end if;
  return v_res || jsonb_build_object('from', v_from, 'to', v_to);
end $$;
revoke all on function public.ai_query(text, date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.ai_query(text, date, date, uuid, uuid, uuid) to authenticated, service_role;
