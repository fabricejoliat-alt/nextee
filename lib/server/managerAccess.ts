import type { SupabaseClient } from "@supabase/supabase-js";

/** Service-role callers must establish both the actor's and the target's scope. */
export async function requireManagerClub(req: Request, db: SupabaseClient, clubId: string) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false as const, status: 401, error: "Missing token" };
  const caller = await db.auth.getUser(token);
  if (caller.error || !caller.data.user) return { ok: false as const, status: 401, error: "Invalid token" };
  const callerId = caller.data.user.id;
  const admin = await db.from("app_admins").select("user_id").eq("user_id", callerId).maybeSingle();
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data) return { ok: true as const, callerId, isSuperadmin: true };
  const member = await activeClubMember(db, clubId, callerId, "manager");
  if (!member) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, callerId, isSuperadmin: false };
}

export async function activeClubMember(db: SupabaseClient, clubId: string, userId: string, role: string) {
  const result = await db.from("club_members").select("id,user_id,club_id,role")
    .eq("club_id", clubId).eq("user_id", userId).eq("role", role).eq("is_active", true).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function isPlatformAccount(db: SupabaseClient, userId: string) {
  const result = await db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}

export async function canReuseClubAccount(db: SupabaseClient, clubId: string, userId: string, role: string) {
  if (await isPlatformAccount(db, userId)) return false;
  if (role === "parent") {
    // A club can add parental access to one of its active members without
    // replacing the person's existing roles or changing their global account.
    const member = await db.from("club_members").select("id")
      .eq("club_id", clubId).eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle();
    if (member.error) throw new Error(member.error.message);
    if (member.data) return true;
  }
  // Matching an e-mail/identity is not consent to a new club or a new role.
  return Boolean(await activeClubMember(db, clubId, userId, role));
}
