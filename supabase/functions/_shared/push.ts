import * as webpush from "jsr:@negrel/webpush@0.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export interface PushPayload {
  type: string;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

let appServerPromise: Promise<webpush.ApplicationServer> | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64url(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Convierte las llaves VAPID de web-push (base64url crudas) a JWK. */
function vapidJwk(publicKey: string, privateKey: string): webpush.ExportedVapidKeys {
  const pub = b64urlToBytes(publicKey); // 0x04 || X(32) || Y(32)
  const base = { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true };
  return {
    publicKey: { ...base, key_ops: ["verify"] },
    privateKey: { ...base, d: privateKey, key_ops: ["sign"] },
  };
}

function appServer(): Promise<webpush.ApplicationServer> {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const pub = Deno.env.get("VAPID_PUBLIC_KEY");
      const priv = Deno.env.get("VAPID_PRIVATE_KEY");
      if (!pub || !priv) throw new Error("Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
      const vapidKeys = await webpush.importVapidKeys(vapidJwk(pub, priv));
      return await webpush.ApplicationServer.new({
        contactInformation: Deno.env.get("VAPID_SUBJECT") || "mailto:dazamiguel95@gmail.com",
        vapidKeys,
      });
    })();
    appServerPromise.catch(() => (appServerPromise = null));
  }
  return appServerPromise;
}

/** Envía un push a todos los dispositivos del usuario y borra las suscripciones vencidas (404/410). */
export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload) {
  const { data: subs, error } = await admin
    .from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (error) throw error;
  if (!subs?.length) return { devices: 0, sent: 0, removed: 0, failed: 0, errors: [] as string[] };

  const server = await appServer();
  let sent = 0, removed = 0, failed = 0;
  const errors: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      const subscriber = server.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
      await subscriber.pushTextMessage(JSON.stringify(payload), { urgency: webpush.Urgency.High, ttl: 86400 });
      sent++;
      await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
    } catch (err) {
      const status = err instanceof webpush.PushMessageError ? err.response.status : 0;
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      } else {
        failed++;
        const detail = err instanceof webpush.PushMessageError ? await err.response.text().catch(() => "") : "";
        errors.push(`${status} ${String(err).slice(0, 120)} ${detail.slice(0, 200)}`.trim());
        console.error("push failed", status, String(err), detail);
      }
    }
  }));
  return { devices: subs.length, sent, removed, failed, errors };
}

/**
 * Crea la notificación in-app (deduplicada por dedupe_key) y, solo si es nueva, la envía por push.
 * Devuelve true si se creó.
 */
export async function notify(
  admin: SupabaseClient, userId: string, payload: PushPayload, dedupeKey: string,
): Promise<boolean> {
  const { data, error } = await admin.from("notifications").upsert({
    user_id: userId, type: payload.type, title: payload.title, body: payload.body ?? null,
    url: payload.url ?? null, dedupe_key: dedupeKey,
  }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  if (!data?.length) return false;
  try {
    await sendPushToUser(admin, userId, { ...payload, tag: payload.tag ?? dedupeKey });
  } catch (err) {
    console.error("push error", err);
  }
  return true;
}
