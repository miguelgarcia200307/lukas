-- Lukas · esquema base
-- Montos en bigint (pesos enteros, COP sin decimales). Fechas en timestamptz; los reportes usan America/Bogota.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

-- ───────────────────────── utilidades ─────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Hoy en Bogotá
create or replace function public.bogota_today() returns date
language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;

-- Fecha con el día ajustado al último día del mes si no existe (31 en febrero → 28/29)
create or replace function public.clamp_day(p_year int, p_month int, p_day int) returns date
language sql immutable as $$
  select make_date(p_year, p_month,
    least(greatest(p_day, 1), extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::int))
$$;

-- Próxima fecha (>= p_from) con día de mes p_day
create or replace function public.next_monthly_date(p_day int, p_from date) returns date
language sql immutable as $$
  select case
    when public.clamp_day(extract(year from p_from)::int, extract(month from p_from)::int, p_day) >= p_from
      then public.clamp_day(extract(year from p_from)::int, extract(month from p_from)::int, p_day)
    else public.clamp_day(extract(year from (p_from + interval '1 month'))::int,
                          extract(month from (p_from + interval '1 month'))::int, p_day)
  end
$$;

-- ───────────────────────── tablas ─────────────────────────
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users on delete cascade,
  name text,
  currency text not null default 'COP',
  timezone text not null default 'America/Bogota',
  reminder_time time not null default '08:00',
  daily_limit bigint not null default 80000 check (daily_limit >= 0),
  notification_prefs jsonb not null default
    '{"card_cut":true,"card_due":true,"debts":true,"subscriptions":true,"weekly_summary":true,"no_activity":true,"budget":true}'::jsonb,
  default_account_id uuid,
  voice_reply boolean not null default false,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 60),
  kind text not null check (kind in ('expense', 'income')),
  icon text not null default 'tag',
  color text not null default '#8A8A84',
  parent_id uuid references public.categories on delete set null,
  sort_order int not null default 0,
  archived boolean not null default false,
  system_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, system_key)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 60),
  type text not null default 'bank' check (type in ('cash', 'bank', 'wallet', 'savings', 'other')),
  initial_balance bigint not null default 0,
  color text not null default '#1D1D1B',
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.profiles add constraint profiles_default_account_fk
    foreign key (default_account_id) references public.accounts on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 60),
  bank text,
  brand text not null default 'visa' check (brand in ('visa', 'mastercard', 'amex', 'diners', 'other')),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  credit_limit bigint not null default 0 check (credit_limit >= 0),
  cut_day smallint not null check (cut_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  initial_debt bigint not null default 0,
  monthly_rate numeric(6, 3),
  color text not null default '#1D1D1B',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  lender text,
  original_amount bigint not null default 0 check (original_amount >= 0),
  starting_balance bigint not null default 0 check (starting_balance >= 0),
  monthly_payment bigint not null default 0 check (monthly_payment >= 0),
  due_day smallint check (due_day between 1 and 31),
  end_date date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  target_amount bigint not null check (target_amount > 0),
  target_date date,
  color text not null default '#4B3BF5',
  icon text not null default 'target',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('expense', 'income', 'transfer')),
  amount bigint not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  description text not null default '',
  category_id uuid references public.categories on delete set null,
  account_id uuid references public.accounts on delete set null,
  card_id uuid references public.credit_cards on delete set null,
  -- destinos de una transferencia
  to_account_id uuid references public.accounts on delete set null,
  to_card_id uuid references public.credit_cards on delete set null,
  debt_id uuid references public.debts on delete set null,
  goal_id uuid references public.savings_goals on delete set null,
  -- tipo de movimiento en tarjeta que genera un gasto con tarjeta
  card_movement_kind text not null default 'charge' check (card_movement_kind in ('charge', 'interest', 'fee')),
  notes text,
  source text not null default 'manual' check (source in ('voice', 'manual', 'subscription', 'recurring', 'system')),
  transcript text,
  group_id uuid,
  subscription_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tx_single_payment check (not (account_id is not null and card_id is not null))
);

create table if not exists public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  transaction_id uuid not null references public.transactions on delete cascade,
  name text not null,
  qty numeric(10, 2) not null default 1 check (qty > 0),
  unit_amount bigint not null check (unit_amount >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  card_id uuid not null references public.credit_cards on delete cascade,
  kind text not null check (kind in ('charge', 'payment', 'interest', 'fee', 'adjustment')),
  amount bigint not null,
  occurred_at timestamptz not null default now(),
  note text,
  transaction_id uuid references public.transactions on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cm_amount_sign check (kind = 'adjustment' or amount > 0)
);

create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  debt_id uuid not null references public.debts on delete cascade,
  amount bigint not null check (amount > 0),
  paid_at date not null default public.bogota_today(),
  mode text not null default 'expense' check (mode in ('expense', 'transfer')),
  transaction_id uuid references public.transactions on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  amount bigint not null check (amount > 0),
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'yearly')),
  next_charge_date date not null,
  anchor_day smallint,
  account_id uuid references public.accounts on delete set null,
  card_id uuid references public.credit_cards on delete set null,
  category_id uuid references public.categories on delete set null,
  color text not null default '#1D1D1B',
  active boolean not null default true,
  auto_register boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sub_single_payment check (not (account_id is not null and card_id is not null))
);

do $$ begin
  alter table public.transactions add constraint transactions_subscription_fk
    foreign key (subscription_id) references public.subscriptions on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  category_id uuid references public.categories on delete cascade,
  period text not null default 'monthly' check (period in ('daily', 'weekly', 'monthly')),
  amount bigint not null check (amount > 0),
  alert_thresholds int[] not null default '{80,100}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists budgets_unique on public.budgets
  (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period);

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references public.savings_goals on delete cascade,
  amount bigint not null check (amount <> 0),
  contributed_at date not null default public.bogota_today(),
  account_id uuid references public.accounts on delete set null,
  transaction_id uuid references public.transactions on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null,
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table if not exists public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  transcript text,
  response jsonb,
  model text,
  latency_ms int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── índices ─────────────────────────
create index if not exists categories_user_idx on public.categories (user_id, kind, sort_order);
create index if not exists accounts_user_idx on public.accounts (user_id);
create index if not exists cards_user_idx on public.credit_cards (user_id);
create index if not exists debts_user_idx on public.debts (user_id);
create index if not exists goals_user_idx on public.savings_goals (user_id);
create index if not exists tx_user_date_idx on public.transactions (user_id, occurred_at desc);
create index if not exists tx_user_cat_idx on public.transactions (user_id, category_id, occurred_at);
create index if not exists tx_group_idx on public.transactions (group_id);
create index if not exists tx_items_tx_idx on public.transaction_items (transaction_id);
create index if not exists cm_card_date_idx on public.card_movements (card_id, occurred_at desc);
create index if not exists cm_tx_idx on public.card_movements (transaction_id);
create index if not exists dp_debt_idx on public.debt_payments (debt_id, paid_at);
create index if not exists subs_user_next_idx on public.subscriptions (user_id, next_charge_date);
create index if not exists budgets_user_idx on public.budgets (user_id);
create index if not exists gc_goal_idx on public.goal_contributions (goal_id);
create index if not exists push_user_idx on public.push_subscriptions (user_id);
create index if not exists notif_user_idx on public.notifications (user_id, created_at desc);
create index if not exists ai_logs_user_idx on public.ai_logs (user_id, created_at desc);

-- ───────────────────────── updated_at + RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profiles','categories','accounts','credit_cards','debts','savings_goals','transactions',
    'transaction_items','card_movements','debt_payments','subscriptions','budgets','goal_contributions',
    'push_subscriptions','notifications','ai_logs']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);
    execute format('create policy "own_select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "own_insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "own_update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "own_delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;
