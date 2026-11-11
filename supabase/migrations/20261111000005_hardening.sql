-- Lukas · endurecimiento: cuota de uso de la IA por usuario y permisos mínimos (anon sin acceso)

-- ───────────────────────── cuota de la IA ─────────────────────────
create table if not exists public.ai_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ai_requests_user_time_idx on public.ai_requests (user_id, created_at desc);
alter table public.ai_requests enable row level security;
drop policy if exists "own_select" on public.ai_requests;
drop policy if exists "own_delete" on public.ai_requests;
create policy "own_select" on public.ai_requests for select to authenticated using (user_id = (select auth.uid()));
create policy "own_delete" on public.ai_requests for delete to authenticated using (user_id = (select auth.uid()));
-- Sin política de insert: solo se registra a través de consume_ai_quota()

/** Registra una solicitud a la IA si el usuario está dentro de su cuota. */
create or replace function public.consume_ai_quota(p_per_minute int default 20, p_per_day int default 300)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_min int;
  v_day int;
  v_oldest timestamptz;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  -- Serializa por usuario para que dos solicitudes simultáneas no se salten el límite
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));

  select count(*) filter (where created_at > now() - interval '1 minute'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_min, v_day
    from public.ai_requests where user_id = v_uid and created_at > now() - interval '1 day';

  if v_min >= least(p_per_minute, 60) then
    select min(created_at) into v_oldest from public.ai_requests where user_id = v_uid and created_at > now() - interval '1 minute';
    return jsonb_build_object('allowed', false, 'scope', 'minute',
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 minute' - now())))::int));
  end if;
  if v_day >= least(p_per_day, 1000) then
    select min(created_at) into v_oldest from public.ai_requests where user_id = v_uid and created_at > now() - interval '1 day';
    return jsonb_build_object('allowed', false, 'scope', 'day',
      'retry_after', greatest(60, ceil(extract(epoch from (v_oldest + interval '1 day' - now())))::int));
  end if;

  insert into public.ai_requests (user_id) values (v_uid);
  return jsonb_build_object('allowed', true, 'minute_left', least(p_per_minute, 60) - v_min - 1, 'day_left', least(p_per_day, 1000) - v_day - 1);
end $$;

-- Limpieza diaria de registros viejos
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lukas-ai-requests-cleanup';
  perform cron.schedule('lukas-ai-requests-cleanup', '15 9 * * *',
    $cron$ delete from public.ai_requests where created_at < now() - interval '2 days' $cron$);
end $$;

-- ───────────────────────── permisos mínimos ─────────────────────────
-- anon (la llave publicable) no necesita tocar ninguna tabla, vista ni función: solo inicia sesión con Auth.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- Funciones: nadie por PUBLIC; authenticated y service_role explícitos (las vistas security_invoker las usan)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- Internas: ni siquiera authenticated
revoke all on function public.seed_user_defaults(uuid) from authenticated;
revoke all on function public.invoke_internal_function(text, jsonb) from authenticated;
revoke all on function public.handle_new_user() from authenticated;
revoke all on function public.trigger_budget_check() from authenticated;

-- Tablas y vistas: solo authenticated (con RLS) y service_role
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke insert, update on public.ai_requests from authenticated;
grant usage on all sequences in schema public to authenticated, service_role;
