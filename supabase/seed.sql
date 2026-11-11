-- Lukas · categorías y cuenta "Efectivo" por defecto para cada usuario existente (idempotente).
-- Los usuarios nuevos las reciben automáticamente con el trigger on_auth_user_created.
select public.seed_user_defaults(id) from auth.users;
