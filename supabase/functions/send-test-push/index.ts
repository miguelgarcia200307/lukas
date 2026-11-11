// send-test-push: el usuario se envía una notificación de prueba a todos sus dispositivos.
import { errorResponse, HttpError, json, preflight } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/auth.ts";
import { sendPushToUser } from "../_shared/push.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") throw new HttpError(405, "Método no permitido");
    const { user } = await requireUser(req);
    const admin = adminClient();
    const payload = {
      type: "test",
      title: "¡Las notificaciones funcionan!",
      body: "Así te avisaré de cortes, pagos y presupuestos.",
      url: "#/notificaciones",
    };
    const { error } = await admin.from("notifications").insert({
      user_id: user.id, type: payload.type, title: payload.title, body: payload.body, url: payload.url,
      dedupe_key: `test:${Date.now()}`,
    });
    if (error) throw error;
    const result = await sendPushToUser(admin, user.id, { ...payload, tag: "test" });
    if (result.devices === 0) {
      throw new HttpError(404, "No encontré dispositivos con notificaciones activas. Actívalas primero en este dispositivo.", "no_devices");
    }
    if (result.sent === 0) {
      console.error("test push failed", result.errors);
      throw new HttpError(502, "No se pudo entregar la notificación. Desactívalas y vuelve a activarlas en este dispositivo.", "push_failed");
    }
    return json(req, { ok: true, sent: result.sent, removed: result.removed, failed: result.failed });
  } catch (err) {
    return errorResponse(req, err);
  }
});
