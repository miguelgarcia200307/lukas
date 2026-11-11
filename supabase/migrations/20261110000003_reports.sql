-- Lukas · vistas y RPC de reportes (security invoker: respetan RLS)

create or replace view public.account_balances with (security_invoker = true) as
select a.id, a.user_id, a.name, a.type, a.color, a.archived, a.sort_order, a.initial_balance,
  a.initial_balance
  + coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
              from public.transactions t where t.account_id = a.id), 0)
  + coalesce((select sum(t.amount) from public.transactions t
              where t.to_account_id = a.id and t.type = 'transfer'), 0) as balance
from public.accounts a;

create or replace view public.card_status with (security_invoker = true) as
select c.id, c.user_id, c.name, c.bank, c.brand, c.last4, c.credit_limit, c.cut_day, c.due_day,
  c.initial_debt, c.monthly_rate, c.color, c.archived, c.created_at,
  d.debt,
  c.credit_limit - d.debt as available,
  case when c.credit_limit > 0 then round(greatest(d.debt, 0) * 100.0 / c.credit_limit, 1) else 0 end as usage_pct,
  public.next_monthly_date(c.cut_day, public.bogota_today()) as next_cut_date,
  public.next_monthly_date(c.due_day, public.bogota_today()) as next_due_date,
  case when c.monthly_rate is not null then round(greatest(d.debt, 0) * c.monthly_rate / 100)::bigint end as est_interest
from public.credit_cards c
cross join lateral (
  select c.initial_debt + coalesce(sum(case when m.kind = 'payment' then -m.amount else m.amount end), 0) as debt
  from public.card_movements m where m.card_id = c.id
) d;

create or replace view public.debt_status with (security_invoker = true) as
select d.id, d.user_id, d.name, d.lender, d.original_amount, d.starting_balance, d.monthly_payment, d.due_day,
  d.end_date, d.archived, d.created_at,
  coalesce(p.paid, 0) as paid_total,
  greatest(d.starting_balance - coalesce(p.paid, 0), 0) as balance,
  case when d.due_day is not null then public.next_monthly_date(d.due_day, public.bogota_today()) end as next_due_date,
  case when greatest(d.original_amount, d.starting_balance) > 0
       then round((1 - greatest(d.starting_balance - coalesce(p.paid, 0), 0)::numeric
                   / greatest(d.original_amount, d.starting_balance)) * 100, 1) else 0 end as progress_pct
from public.debts d
left join lateral (select sum(amount) as paid from public.debt_payments where debt_id = d.id) p on true;

create or replace view public.goal_status with (security_invoker = true) as
select g.id, g.user_id, g.name, g.target_amount, g.target_date, g.color, g.icon, g.archived, g.created_at,
  coalesce(c.saved, 0) as saved,
  round(least(coalesce(c.saved, 0)::numeric / g.target_amount, 1) * 100, 1) as progress_pct
from public.savings_goals g
left join lateral (select sum(amount) as saved from public.goal_contributions where goal_id = g.id) c on true;

create or replace view public.subscription_status with (security_invoker = true) as
select s.*,
  case s.frequency when 'monthly' then s.amount
                   when 'yearly' then round(s.amount / 12.0)::bigint
                   else round(s.amount * 52 / 12.0)::bigint end as monthly_equivalent,
  s.next_charge_date - public.bogota_today() as days_left
from public.subscriptions s;

-- Estado de presupuestos (incluye el límite diario del perfil como presupuesto especial)
create or replace function public.budget_status(p_user uuid default auth.uid())
returns table (budget_id uuid, category_id uuid, name text, color text, period text, amount bigint,
               spent bigint, pct numeric, period_start date, thresholds int[])
language sql stable security invoker set search_path = public as $$
  with today as (select public.bogota_today() as d),
  b as (
    select bu.id, bu.category_id, coalesce(c.name, 'Total') as name, coalesce(c.color, '#4B3BF5') as color,
           bu.period, bu.amount, bu.alert_thresholds,
           case bu.period when 'daily' then (select d from today)
                          when 'weekly' then date_trunc('week', (select d from today))::date
                          else date_trunc('month', (select d from today))::date end as start
    from budgets bu left join categories c on c.id = bu.category_id
    where bu.user_id = p_user
    union all
    select null, null, 'Límite diario', '#4B3BF5', 'daily', p.daily_limit, '{80,100}'::int[], (select d from today)
    from profiles p where p.user_id = p_user and p.daily_limit > 0
  )
  select b.id, b.category_id, b.name, b.color, b.period, b.amount,
    coalesce(s.spent, 0)::bigint,
    round(coalesce(s.spent, 0) * 100.0 / b.amount, 1),
    b.start, b.alert_thresholds
  from b
  left join lateral (
    select sum(t.amount) as spent
    from transactions t left join categories tc on tc.id = t.category_id
    where t.user_id = p_user and t.type = 'expense'
      and (t.occurred_at at time zone 'America/Bogota')::date between b.start and (select d from today)
      and (b.category_id is null or t.category_id = b.category_id or tc.parent_id = b.category_id)
  ) s on true
$$;

-- Próximos eventos (pagos, cortes, cuotas, suscripciones)
create or replace function public.upcoming_events(p_days int default 7, p_user uuid default auth.uid())
returns table (kind text, ref_id uuid, title text, subtitle text, event_date date, days_left int, amount bigint, color text)
language sql stable security invoker set search_path = public as $$
  with today as (select public.bogota_today() as d)
  select * from (
    select 'card_due', c.id, 'Pago ' || c.name, coalesce(c.bank, ''), c.next_due_date,
           c.next_due_date - (select d from today), greatest(c.debt, 0), c.color
    from card_status c where c.user_id = p_user and not c.archived
    union all
    select 'card_cut', c.id, 'Corte ' || c.name, coalesce(c.bank, ''), c.next_cut_date,
           c.next_cut_date - (select d from today), null::bigint, c.color
    from card_status c where c.user_id = p_user and not c.archived
    union all
    select 'debt', d.id, 'Cuota ' || d.name, coalesce(d.lender, ''), d.next_due_date,
           d.next_due_date - (select d2.d from today d2), d.monthly_payment, '#6B7280'
    from debt_status d where d.user_id = p_user and not d.archived and d.next_due_date is not null and d.balance > 0
    union all
    select 'subscription', s.id, s.name, 'Suscripción', s.next_charge_date,
           s.next_charge_date - (select d from today), s.amount, s.color
    from subscriptions s where s.user_id = p_user and s.active
  ) e(kind, ref_id, title, subtitle, event_date, days_left, amount, color)
  where e.days_left between 0 and p_days
  order by e.event_date, e.kind
$$;

create or replace function public.home_summary() returns jsonb
language sql stable security invoker set search_path = public as $$
  with today as (select public.bogota_today() as d),
  p as (select * from profiles where user_id = auth.uid())
  select jsonb_build_object(
    'name', (select name from p),
    'daily_limit', coalesce((select daily_limit from p), 0),
    'today_expense', coalesce((select sum(amount) from transactions
        where type = 'expense' and (occurred_at at time zone 'America/Bogota')::date = (select d from today)), 0),
    'today_income', coalesce((select sum(amount) from transactions
        where type = 'income' and (occurred_at at time zone 'America/Bogota')::date = (select d from today)), 0),
    'month_expense', coalesce((select sum(amount) from transactions
        where type = 'expense' and (occurred_at at time zone 'America/Bogota')::date >= date_trunc('month', (select d from today))::date), 0),
    'month_income', coalesce((select sum(amount) from transactions
        where type = 'income' and (occurred_at at time zone 'America/Bogota')::date >= date_trunc('month', (select d from today))::date), 0),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(u)) from public.upcoming_events(7) u), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(to_jsonb(b)) from public.budget_status() b), '[]'::jsonb),
    'unread', (select count(*) from notifications where read_at is null),
    'card_debt', coalesce((select sum(greatest(debt, 0)) from card_status where not archived), 0),
    'recent', coalesce((select jsonb_agg(r) from (
        select t.id, t.type, t.amount, t.occurred_at, t.description, t.category_id, t.account_id, t.card_id,
               t.to_account_id, t.to_card_id, t.source, c.name as category_name, c.icon as category_icon, c.color as category_color
        from transactions t left join categories c on c.id = t.category_id
        order by t.occurred_at desc, t.created_at desc limit 5) r), '[]'::jsonb)
  )
$$;

-- Datos completos para la sección de reportes en un solo viaje
create or replace function public.report_data(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_days int := (p_to - p_from) + 1;
  v_prev_from date := p_from - ((p_to - p_from) + 1);
  v_prev_to date := p_from - 1;
  v_res jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rango inválido'; end if;

  with tx as (
    select t.*, (t.occurred_at at time zone 'America/Bogota')::date as d,
           coalesce(c.parent_id, c.id) as top_cat
    from transactions t left join categories c on c.id = t.category_id
    where t.type in ('expense', 'income')
      and (t.occurred_at at time zone 'America/Bogota')::date between v_prev_from and p_to
  ),
  cur as (select * from tx where d between p_from and p_to),
  prev as (select * from tx where d between v_prev_from and v_prev_to),
  months as (
    select generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month')::date as m
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_days,
    'income', coalesce((select sum(amount) from cur where type = 'income'), 0),
    'expense', coalesce((select sum(amount) from cur where type = 'expense'), 0),
    'expense_count', (select count(*) from cur where type = 'expense'),
    'prev_income', coalesce((select sum(amount) from prev where type = 'income'), 0),
    'prev_expense', coalesce((select sum(amount) from prev where type = 'expense'), 0),
    'by_category', coalesce((
      select jsonb_agg(x order by x.total desc) from (
        select c.id, c.name, c.color, c.icon, sum(cur.amount) as total, count(*) as count,
          coalesce((select sum(pv.amount) from prev pv where pv.type = 'expense' and pv.top_cat is not distinct from c.id), 0) as prev_total
        from cur left join categories c on c.id = cur.top_cat
        where cur.type = 'expense'
        group by c.id, c.name, c.color, c.icon
      ) x), '[]'::jsonb),
    'income_by_category', coalesce((
      select jsonb_agg(x order by x.total desc) from (
        select c.id, c.name, c.color, sum(cur.amount) as total
        from cur left join categories c on c.id = cur.top_cat
        where cur.type = 'income' group by c.id, c.name, c.color
      ) x), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('d', g.d, 'expense', coalesce(s.e, 0), 'income', coalesce(s.i, 0)) order by g.d)
      from generate_series(p_from, p_to, interval '1 day') as g0(x)
      cross join lateral (select g0.x::date as d) g
      left join (
        select d, sum(amount) filter (where type = 'expense') as e, sum(amount) filter (where type = 'income') as i
        from cur group by d
      ) s on s.d = g.d), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('m', mm.m,
        'income', coalesce((select sum(amount) from transactions t where t.type = 'income'
            and (t.occurred_at at time zone 'America/Bogota')::date >= mm.m
            and (t.occurred_at at time zone 'America/Bogota')::date < (mm.m + interval '1 month')::date), 0),
        'expense', coalesce((select sum(amount) from transactions t where t.type = 'expense'
            and (t.occurred_at at time zone 'America/Bogota')::date >= mm.m
            and (t.occurred_at at time zone 'America/Bogota')::date < (mm.m + interval '1 month')::date), 0)
      ) order by mm.m) from months mm), '[]'::jsonb),
    'top_descriptions', coalesce((
      select jsonb_agg(x) from (
        select initcap(lower(trim(description))) as name, count(*) as count, sum(amount) as total
        from cur where type = 'expense' and trim(description) <> ''
        group by lower(trim(description)), initcap(lower(trim(description)))
        order by count(*) desc, sum(amount) desc limit 8
      ) x), '[]'::jsonb),
    'ant', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(amount), 0), 'threshold', 20000,
        'top', coalesce((select jsonb_agg(y) from (
            select initcap(lower(trim(description))) as name, count(*) as count, sum(amount) as total
            from cur where type = 'expense' and amount <= 20000 and trim(description) <> ''
            group by lower(trim(description)), initcap(lower(trim(description)))
            order by sum(amount) desc limit 5) y), '[]'::jsonb))
      from cur where type = 'expense' and amount <= 20000),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name, 'color', cs.color, 'debt', cs.debt,
        'limit', cs.credit_limit, 'usage_pct', cs.usage_pct,
        'history', (select jsonb_agg(jsonb_build_object('m', mm.m,
            'debt', cs.initial_debt + coalesce((select sum(case when m.kind = 'payment' then -m.amount else m.amount end)
              from card_movements m where m.card_id = cs.id
                and (m.occurred_at at time zone 'America/Bogota')::date < (mm.m + interval '1 month')::date), 0))
          order by mm.m) from months mm where mm.m >= date_trunc('month', p_to) - interval '5 months')))
      from card_status cs where not cs.archived), '[]'::jsonb),
    'debts', coalesce((
      select jsonb_agg(jsonb_build_object('id', ds.id, 'name', ds.name, 'balance', ds.balance,
        'history', (select jsonb_agg(jsonb_build_object('m', mm.m,
            'balance', greatest(ds.starting_balance - coalesce((select sum(dp.amount) from debt_payments dp
              where dp.debt_id = ds.id and dp.paid_at < (mm.m + interval '1 month')::date), 0), 0))
          order by mm.m) from months mm where mm.m >= date_trunc('month', p_to) - interval '5 months')))
      from debt_status ds where not ds.archived), '[]'::jsonb),
    'subscriptions', jsonb_build_object(
      'monthly', coalesce((select sum(monthly_equivalent) from subscription_status where active), 0),
      'yearly', coalesce((select sum(monthly_equivalent) * 12 from subscription_status where active), 0),
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'monthly', monthly_equivalent, 'color', color)
          order by monthly_equivalent desc) from subscription_status where active), '[]'::jsonb)),
    'daily_limit', coalesce((select daily_limit from profiles where user_id = auth.uid()), 0),
    'monthly_budget', (select amount from budgets where category_id is null and period = 'monthly' limit 1)
  ) into v_res;
  return v_res;
end $$;

grant select on public.account_balances, public.card_status, public.debt_status, public.goal_status,
  public.subscription_status to authenticated, service_role;
revoke all on function public.budget_status(uuid) from public, anon;
revoke all on function public.upcoming_events(int, uuid) from public, anon;
revoke all on function public.home_summary() from public, anon;
revoke all on function public.report_data(date, date) from public, anon;
grant execute on function public.budget_status(uuid), public.upcoming_events(int, uuid), public.home_summary(),
  public.report_data(date, date) to authenticated, service_role;
