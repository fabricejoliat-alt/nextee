import type { SupabaseClient } from "@supabase/supabase-js";
import { legalActor, legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { NextResponse } from "next/server";

export const organizationReply = (value: object, status = 200) => NextResponse.json(value, { status, headers: legalNoStore });
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function organizationActor(req: Request, organizationId?: string, adminOnly = false) {
  if (organizationId && !uuidPattern.test(organizationId)) return null;
  const db = legalDb();
  const actor = adminOnly ? await legalAdmin(req, db) : await legalActor(req, db);
  if (!actor) return null;
  if (adminOnly) return { db, actor };
  const admin = await db.from("app_admins").select("user_id").eq("user_id", actor.id).maybeSingle();
  if (admin.error) throw admin.error;
  if (admin.data) return { db, actor };
  if (!organizationId || !uuidPattern.test(organizationId)) return null;
  const manager = await db.rpc("organization_is_manager", { p_org: organizationId, p_actor: actor.id });
  if (manager.error) throw manager.error;
  return manager.data === true ? { db, actor } : null;
}

/** This server-only check is also required for service-role reads. */
export async function organizationSubjectAccess(db: SupabaseClient, actorId: string, playerId: string, organizationId: string, edit = false) {
  const result = await db.rpc("organization_actor_access", {
    p_org: organizationId, p_actor: actorId, p_player: playerId, p_edit: edit,
  });
  if (result.error) throw result.error;
  if(result.data!==true)return false;
  const legal=await db.rpc("organization_actor_legal_ready",{p_org:organizationId,p_actor:actorId});
  if(legal.error)throw legal.error;return legal.data===true;
}

export function organizationFailure(error: unknown) {
  const e = error as { code?: string; message?: string };
  const status = e?.code === "42501" ? 403 : ["40001", "23505"].includes(e?.code ?? "") ? 409
    : ["PGRST202", "PGRST205", "42P01"].includes(e?.code ?? "") ? 503 : 400;
  return organizationReply({ error: "organization.operationFailed", code: e?.code ?? "UNKNOWN" }, status);
}
