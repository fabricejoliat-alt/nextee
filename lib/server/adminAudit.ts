import { randomUUID } from "node:crypto";
import { legalActor, legalDb } from "@/lib/server/legalAccess";
import { adminNoStore, verifiedAdminAssurance } from "@/lib/server/adminSecurity";
import { initialPasswordRequired } from "@/lib/adminSecurity";

/** Durable intent before the operation, then its HTTP outcome. Never log request bodies or credentials. */
export function withAdminMutationAudit<R extends Request, A extends unknown[]>(handler: (req: R, ...args: A) => Promise<Response>) {
  return async (req: R, ...args: A): Promise<Response> => {
    const failure = (code: string, status: number) => Response.json({ error: code, code }, { status, headers: adminNoStore });
    try {
      const db = legalDb();
      const actor = await legalActor(req, db);
      if (!actor) return failure("UNAUTHORIZED", 401);
      if (initialPasswordRequired(actor)) return failure("INITIAL_PASSWORD_REQUIRED", 403);
      const admin = await db.from("app_admins").select("user_id").eq("user_id", actor.id).maybeSingle();
      if (admin.error) throw admin.error;
      // Legacy club endpoints keep their existing manager/target-scope authorization.
      if (!admin.data) return handler(req, ...args);
      const token = req.headers.get("authorization")!.replace(/^Bearer\s+/i, "").trim();
      const assurance = await verifiedAdminAssurance(db, token, actor.id);
      if (!assurance.mfa || !assurance.recent) return failure(assurance.mfa ? "ADMIN_REAUTH_REQUIRED" : "ADMIN_MFA_REQUIRED", 403);
      const path = new URL(req.url).pathname.slice(0, 300);
      let target: string | null = null;
      // Only the target identifier is retained; no names, passwords or submitted contents.
      if (req.headers.get("content-type")?.includes("application/json")) {
        const body = await req.clone().json().catch(() => null);
        const userTarget = body?.userId ?? body?.user_id ?? body?.document_id;
        if (typeof userTarget === "string" && /^[0-9a-f-]{36}$/i.test(userTarget)) target = userTarget;
        else if (["fr", "en", "de", "it"].includes(body?.locale) && typeof body?.key === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(body.key)) target = `${body.locale}:${body.key}`;
      }
      const requestId = randomUUID();
      const record = async (phase: string, status: number | null) => {
        const result = await db.rpc("record_admin_security_event", {
          p_actor: actor.id, p_request: requestId, p_action: `${req.method} ${path}`,
          p_target: target, p_phase: phase, p_status: status,
        });
        if (result.error) throw result.error;
      };
      await record("started", null);
      let response: Response;
      try { response = await handler(req, ...args); }
      catch { await record("failed", 500); return failure("ADMIN_OPERATION_FAILED", 500); }
      await record(response.ok ? "succeeded" : "failed", response.status);
      response.headers.set("Cache-Control", adminNoStore["Cache-Control"]);
      return response;
    } catch { return failure("ADMIN_AUDIT_UNAVAILABLE", 503); }
  };
}
