// CORS con lista exacta de orígenes (sin comodines): GitHub Pages del repo + localhost de desarrollo.
// ALLOWED_ORIGINS (secret opcional, separado por comas) agrega orígenes exactos adicionales.
const DEV_PORTS = [3000, 4173, 5173, 5179, 5500, 8000, 8080];
const ALLOWED = new Set<string>([
  "https://miguelgarcia200307.github.io",
  ...DEV_PORTS.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]),
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ALLOWED.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders(req) }) : null;
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export class HttpError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(status: number, message: string, code = "error", retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function errorResponse(req: Request, err: unknown): Response {
  if (err instanceof HttpError) {
    const extra: Record<string, string> = err.retryAfter ? { "Retry-After": String(err.retryAfter) } : {};
    return json(req, { error: { code: err.code, message: err.message, retry_after: err.retryAfter ?? null } }, err.status, extra);
  }
  console.error(err);
  return json(req, { error: { code: "internal", message: "Algo salió mal. Intenta de nuevo." } }, 500);
}
