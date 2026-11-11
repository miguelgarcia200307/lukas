import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.49.4";
import { HttpError } from "./cors.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Se prefieren las llaves nuevas (secrets propios); si no, las que inyecta la plataforma.
const PUBLIC_KEY = Deno.env.get("SB_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SECRET_KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SECRET_KEY, { auth: noSession });
}

/** Valida el JWT del usuario y devuelve un cliente que actúa como él (RLS activo). */
export async function requireUser(req: Request): Promise<{ user: User; db: SupabaseClient }> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Sesión requerida", "unauthorized");
  const db = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Tu sesión expiró. Vuelve a entrar.", "unauthorized");
  return { user: data.user, db };
}

/** Llamadas internas (pg_cron / pg_net / triggers) firmadas con el secreto compartido. */
export function requireInternal(req: Request): void {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected || !timingSafeEqual(expected, got)) throw new HttpError(401, "No autorizado", "unauthorized");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
