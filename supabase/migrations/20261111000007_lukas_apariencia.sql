-- Lukas · apariencia del personaje por cuenta (accesorios y colores). Solo IDs y colores del catálogo, nunca SVG.

create table if not exists public.lukas_apariencia (
  user_id uuid primary key references auth.users on delete cascade,
  config jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint lukas_apariencia_config_objeto check (jsonb_typeof(config) = 'object'),
  constraint lukas_apariencia_config_tamano check (pg_column_size(config) <= 4096)
);

alter table public.lukas_apariencia enable row level security;
drop policy if exists "own_select" on public.lukas_apariencia;
drop policy if exists "own_insert" on public.lukas_apariencia;
drop policy if exists "own_update" on public.lukas_apariencia;
create policy "own_select" on public.lukas_apariencia for select to authenticated using (user_id = (select auth.uid()));
create policy "own_insert" on public.lukas_apariencia for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own_update" on public.lukas_apariencia for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on table public.lukas_apariencia from anon, public;
grant select, insert, update on table public.lukas_apariencia to authenticated;

/**
 * Guarda la apariencia del usuario actual. En conflicto gana el updated_at más reciente: si la fila del servidor es
 * más nueva (otro dispositivo guardó después), no se pisa. Devuelve siempre la fila vigente.
 * SECURITY INVOKER: las políticas RLS de arriba aplican igual que en una consulta directa.
 */
create or replace function public.guardar_lukas_apariencia(p_config jsonb, p_version int default 1, p_updated_at timestamptz default null)
returns public.lukas_apariencia
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := least(coalesce(p_updated_at, now()), now() + interval '5 minutes');
  r public.lukas_apariencia;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  insert into public.lukas_apariencia as a (user_id, config, version, updated_at)
  values (v_uid, coalesce(p_config, '{}'::jsonb), coalesce(p_version, 1), v_at)
  on conflict (user_id) do update
    set config = excluded.config, version = excluded.version, updated_at = excluded.updated_at
    where a.updated_at < excluded.updated_at;
  select * into r from public.lukas_apariencia where user_id = v_uid;
  return r;
end $$;

revoke all on function public.guardar_lukas_apariencia(jsonb, int, timestamptz) from anon, public;
grant execute on function public.guardar_lukas_apariencia(jsonb, int, timestamptz) to authenticated;
