-- Lukas · automatizaciones: pg_net + pg_cron + Vault
-- La URL del proyecto y el secreto interno viven en Vault (lukas_project_url, lukas_cron_secret);
-- se cargan desde scripts/deploy.mjs, nunca en texto plano aquí.

create or replace function public.invoke_internal_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_req bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'lukas_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lukas_cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'Lukas: faltan secretos en Vault para invocar %', p_name;
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_name,
    body := coalesce(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 30000
  ) into v_req;
  return v_req;
end $$;

revoke all on function public.invoke_internal_function(text, jsonb) from public, anon, authenticated;

-- Trigger de presupuestos: cada gasto nuevo/editado dispara budget-check (asíncrono, no bloquea)
create or replace function public.trigger_budget_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'expense' then
    perform public.invoke_internal_function('budget-check',
      jsonb_build_object('user_id', new.user_id, 'transaction_id', new.id));
  end if;
  return new;
exception when others then
  raise warning 'Lukas: budget-check no disponible (%)', sqlerrm;
  return new;
end $$;

drop trigger if exists budget_check on public.transactions;
create trigger budget_check after insert or update of amount, category_id, occurred_at, type on public.transactions
  for each row execute function public.trigger_budget_check();

-- Recordatorios: el job corre cada hora (UTC) y la función decide según la hora de Bogotá:
--   hora preferida del perfil (08:00 por defecto = 13:00 UTC) → cortes, pagos, cuotas, suscripciones
--   domingo 19:00 → resumen semanal · 21:00 → recordatorio si no hubo movimientos
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lukas-reminders';
  perform cron.schedule('lukas-reminders', '0 * * * *',
    $cron$ select public.invoke_internal_function('daily-reminders', '{"slot":"auto"}'::jsonb) $cron$);

  perform cron.unschedule(jobid) from cron.job where jobname = 'lukas-cleanup';
  perform cron.schedule('lukas-cleanup', '30 8 * * 1',
    $cron$ delete from public.ai_logs where created_at < now() - interval '60 days';
           delete from net._http_response where created < now() - interval '2 days' $cron$);
end $$;
