// Verificación local del JWT del usuario (ES256 con la JWKS del proyecto, en caché): evita una llamada a Auth
// por solicitud. Si el token no es asimétrico o no se reconoce la llave, se valida contra /auth/v1/user.
import { HttpError } from "./cors.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const PUBLIC_KEY = Deno.env.get("SB_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

let jwks: { keys: Map<string, CryptoKey>; at: number } | null = null;

async function loadJwks(force = false): Promise<Map<string, CryptoKey>> {
  if (jwks && !force && Date.now() - jwks.at < 10 * 60e3) return jwks.keys;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const keys = new Map<string, CryptoKey>();
  for (const k of (await res.json()).keys ?? []) {
    if (k.kty !== "EC" || k.crv !== "P-256") continue;
    keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: k.kty, crv: k.crv, x: k.x, y: k.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  jwks = { keys, at: Date.now() };
  return keys;
}

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

export interface AuthUser { id: string; token: string }

/** Pre-carga la JWKS (se llama en el ping de calentamiento). */
export const warmJwks = () => loadJwks().catch(() => {});

export async function verifyUser(req: Request): Promise<AuthUser> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Sesión requerida", "unauthorized");
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Tu sesión expiró. Vuelve a entrar.", "unauthorized");
  let header: any, payload: any;
  try {
    header = JSON.parse(new TextDecoder().decode(b64(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64(parts[1])));
  } catch { throw new HttpError(401, "Tu sesión expiró. Vuelve a entrar.", "unauthorized"); }

  if (header.alg === "ES256" && header.kid) {
    let keys = await loadJwks().catch(() => new Map<string, CryptoKey>());
    if (!keys.has(header.kid)) keys = await loadJwks(true).catch(() => keys);
    const key = keys.get(header.kid);
    if (key) {
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
      const now = Math.floor(Date.now() / 1000);
      if (!ok || !payload.sub || payload.role !== "authenticated" || !(payload.exp > now)) {
        throw new HttpError(401, "Tu sesión expiró. Vuelve a entrar.", "unauthorized");
      }
      return { id: payload.sub, token };
    }
  }
  // Respaldo: Auth valida el token
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(401, "Tu sesión expiró. Vuelve a entrar.", "unauthorized");
  const user = await res.json();
  return { id: user.id, token };
}

/** RPC de PostgREST actuando como el usuario (RLS activo), sin supabase-js */
export async function rpc(token: string, fn: string, args: Record<string, unknown>, timeoutMs = 6000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

export async function insertRow(token: string, table: string, row: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  }).catch(() => {});
}
