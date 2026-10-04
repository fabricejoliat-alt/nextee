import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export function serviceDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function etiquetteAccess(req: NextRequest, scope?: "player" | "coach" | "manager") {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return null;
  const db = serviceDb();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  if (!scope) {
    const admin = await db.from("app_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
    return admin.data ? { db, userId: data.user.id, token } : null;
  }
  const member = await db.from("club_members").select("user_id").eq("user_id", data.user.id)
    .eq("role", scope).eq("is_active", true).limit(1);
  return member.data?.length ? { db, userId: data.user.id, token } : null;
}

export const etiquetteFields = "id,card_id,version,locale,title,situation,simple_explanation,action_text,common_mistake,mission_text,coach_tip,official_reference,reference_version,reference_kind,image_url,image_alt,editorial_status,approved_at";

export function completeEtiquetteCard(value: Record<string, unknown>) {
  return ["title", "situation", "simple_explanation", "action_text", "common_mistake", "mission_text", "coach_tip", "official_reference", "reference_version"]
    .every((field) => typeof value[field] === "string" && Boolean(String(value[field]).trim()));
}
