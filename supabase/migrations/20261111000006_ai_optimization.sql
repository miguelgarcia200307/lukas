-- Lukas · optimización del asistente: contexto compacto en una sola RPC, cuota con tipo (audio/texto),
-- consultas calculadas en SQL, memoria de categorización (category_hints) y preferencia de auto-envío.

-- ───────────────────────── preferencias ─────────────────────────
alter table public.profiles add column if not exists voice_autosend boolean not null default true;

-- ───────────────────────── cuota con tipo ─────────────────────────
alter table public.ai_requests add column if not exists kind text not null default 'text';
do $$ begin
  alter table public.ai_requests add constraint ai_requests_kind_chk check (kind in ('text', 'audio'));
exception when duplicate_object then null; end $$;

-- Texto en minúsculas y sin tildes (para comparar palabras)
create or replace function public.ai_fold(p text) returns text
language sql immutable parallel safe as $$
  select translate(lower(coalesce(p, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou')
$$;

-- ───────────────────────── memoria de categorización ─────────────────────────
create table if not exists public.category_hints (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  keyword text not null check (length(keyword) between 3 and 40),
  category_id uuid not null references public.categories on delete cascade,
  uses int not null default 1 check (uses > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, keyword, category_id)
);
create index if not exists category_hints_user_idx on public.category_hints (user_id, uses desc);
alter table public.category_hints enable row level security;
drop trigger if exists set_updated_at on public.category_hints;
create trigger set_updated_at before update on public.category_hints for each row execute function public.set_updated_at();
drop policy if exists "own_select" on public.category_hints;
drop policy if exists "own_insert" on public.category_hints;
drop policy if exists "own_update" on public.category_hints;
drop policy if exists "own_delete" on public.category_hints;
create policy "own_select" on public.category_hints for select to authenticated using (user_id = (select auth.uid()));
create policy "own_insert" on public.category_hints for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own_update" on public.category_hints for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own_delete" on public.category_hints for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.category_hints from anon;
grant select, insert, update, delete on public.category_hints to authenticated;
grant all on public.category_hints to service_role;

/**
 * Aprende palabra clave → categoría a partir de lo que el usuario confirmó.
 * p_rows: [{ "text": "Salchipapa y gaseosas", "category_id": "uuid" }, …]. Hasta 4 palabras por fila.
 */
create or replace function public.learn_category_hints(p_rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_cat uuid;
  v_n int := 0;
  v_word text;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) limit 20 loop
    v_cat := nullif(v_row->>'category_id', '')::uuid;
    continue when v_cat is null or not exists (select 1 from categories where id = v_cat and user_id = v_uid);
    for v_word in
      select w from (
        select t.w, min(t.o) as o
        from regexp_split_to_table(public.ai_fold(left(v_row->>'text', 200)), '[^a-z0-9]+') with ordinality as t(w, o)
        where length(w) between 4 and 40 and w !~ '^[0-9]+$'
          and w not in ('para','pero','como','porque','donde','cuando','unos','unas','este','esta','esto','esos','esas',
                        'gaste','pague','compre','compra','compras','pago','pesos','lucas','luca','mils','todo','cada',
                        'otro','otra','otros','otras','mismo','misma','algo','cosa','cosas','tambien','despues','antes',
                        'ayer','anoche','antier','hoy','semana','manana','tarde','noche','sabado','domingo','lunes',
                        'martes','miercoles','jueves','viernes','con','desde','hasta','entre','sobre','tarjeta','cuenta',
                        'efectivo','nequi','daviplata','visa','mastercard','novia','novio','mama','papa')
        group by t.w
      ) x order by o limit 4
    loop
      insert into category_hints (user_id, keyword, category_id) values (v_uid, v_word, v_cat)
      on conflict (user_id, keyword, category_id) do update set uses = category_hints.uses + 1;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

-- ───────────────────────── contexto compacto ─────────────────────────
-- Todo lo que el asistente necesita del usuario, en arreglos posicionales (pocos bytes).
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
    'cards', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.name, c.bank, c.brand, c.last4) order by c.created_at)
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

/**
 * Inicio de cada solicitud al asistente, en un solo viaje:
 *  1) cuota del usuario (por minuto y por día calendario de Bogotá) y registro de la solicitud;
 *  2) contexto compacto con su versión (md5). Si p_version coincide, no se reenvía el contexto.
 */
create or replace function public.ai_begin(p_version text default null, p_kind text default 'text',
  p_per_minute int default 20, p_per_day int default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_min int;
  v_day int;
  v_oldest timestamptz;
  v_day_start timestamptz := (public.bogota_today()::timestamp at time zone 'America/Bogota');
  v_ctx jsonb;
  v_ver text;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));

  select count(*) filter (where created_at > now() - interval '1 minute'),
         count(*) filter (where created_at >= v_day_start)
    into v_min, v_day
    from public.ai_requests where user_id = v_uid and created_at > least(now() - interval '1 minute', v_day_start);

  if v_min >= least(p_per_minute, 60) then
    select min(created_at) into v_oldest from public.ai_requests where user_id = v_uid and created_at > now() - interval '1 minute';
    return jsonb_build_object('quota', jsonb_build_object('allowed', false, 'scope', 'minute',
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 minute' - now())))::int)));
  end if;
  if v_day >= least(p_per_day, 2000) then
    return jsonb_build_object('quota', jsonb_build_object('allowed', false, 'scope', 'day', 'used', v_day, 'limit', p_per_day,
      'retry_after', greatest(60, ceil(extract(epoch from (v_day_start + interval '1 day' - now())))::int)));
  end if;

  insert into public.ai_requests (user_id, kind) values (v_uid, case when p_kind = 'audio' then 'audio' else 'text' end);
  v_ctx := public.ai_context_json(v_uid);
  v_ver := md5(v_ctx::text);
  return jsonb_build_object(
    'quota', jsonb_build_object('allowed', true, 'used', v_day + 1, 'limit', p_per_day),
    'v', v_ver,
    'ctx', case when p_version is distinct from v_ver then v_ctx end);
end $$;

/** Solo el contexto (pre-calentamiento al tocar el orbe). No consume cuota. */
create or replace function public.ai_context(p_version text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ctx jsonb; v_ver text;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  v_ctx := public.ai_context_json(auth.uid());
  v_ver := md5(v_ctx::text);
  return jsonb_build_object('v', v_ver, 'ctx', case when p_version is distinct from v_ver then v_ctx end);
end $$;

/** Uso de hoy (día calendario de Bogotá) para Ajustes → Uso de IA */
create or replace function public.ai_usage() returns jsonb
language sql stable security invoker set search_path = public as $$
  with d as (select (public.bogota_today()::timestamp at time zone 'America/Bogota') as s)
  select jsonb_build_object(
    'audio_today', (select count(*) from ai_requests where kind = 'audio' and created_at >= (select s from d)),
    'text_today', (select count(*) from ai_requests where kind = 'text' and created_at >= (select s from d)),
    'last_model', (select model from ai_logs where model is not null order by created_at desc limit 1)
  )
$$;

-- Compatibilidad: consume_ai_quota ahora también registra el tipo
drop function if exists public.consume_ai_quota(int, int);
create or replace function public.consume_ai_quota(p_per_minute int default 20, p_per_day int default 300, p_kind text default 'text')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r := public.ai_begin(null, p_kind, p_per_minute, p_per_day);
  return r->'quota';
end $$;

-- ───────────────────────── consultas calculadas en SQL ─────────────────────────
/**
 * Datos para responder preguntas del asistente sin una segunda llamada al LLM.
 * p_metric: spending | income | balance | card_debt | card_dates | debts | subscriptions | budget | goals
 */
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
  elsif p_metric in ('card_debt', 'card_dates') then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_array(name, bank, greatest(debt, 0), available, credit_limit,
        next_cut_date, next_due_date) order by created_at), '[]'::jsonb))
    into v_res from card_status where not archived and (p_card is null or id = p_card);
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

-- ───────────────────────── permisos ─────────────────────────
revoke all on function public.ai_fold(text) from public, anon;
revoke all on function public.learn_category_hints(jsonb) from public, anon;
revoke all on function public.ai_begin(text, text, int, int) from public, anon;
revoke all on function public.ai_context(text) from public, anon;
revoke all on function public.ai_usage() from public, anon;
revoke all on function public.consume_ai_quota(int, int, text) from public, anon;
revoke all on function public.ai_query(text, date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.ai_fold(text), public.learn_category_hints(jsonb), public.ai_begin(text, text, int, int),
  public.ai_context(text), public.ai_usage(), public.consume_ai_quota(int, int, text),
  public.ai_query(text, date, date, uuid, uuid, uuid) to authenticated, service_role;
