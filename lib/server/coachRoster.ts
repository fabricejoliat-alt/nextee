import type { SupabaseClient } from "@supabase/supabase-js";
import { coachRows } from "@/lib/server/coachRows";

/** Basic roster visibility only. Callers must first authorize the group/event
 * and supply its organization and actual roster IDs. This never authorizes
 * player history, evaluations, private notes, AI or account access. */
export async function coachRosterPlayerIds(db: SupabaseClient, actorId: string, organizationId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return new Set<string>();
  const [staff, access, legal] = await Promise.all([
    db.from("club_members").select("user_id").eq("club_id", organizationId).eq("user_id", actorId)
      .eq("is_active", true).in("role", ["coach", "manager"]).limit(1).maybeSingle(),
    db.rpc("organization_actor_access", { p_org: organizationId, p_actor: actorId }),
    db.rpc("organization_actor_legal_ready", { p_org: organizationId, p_actor: actorId }),
  ]);
  if (staff.error || access.error || legal.error) throw new Error("roster_access_failed");
  if (!staff.data || access.data !== true || legal.data !== true) return new Set<string>();
  const allowed = new Set<string>();
  for (let offset = 0; offset < uniqueIds.length; offset += 150) {
    const batch = uniqueIds.slice(offset, offset + 150);
    const [members, excluded] = await Promise.all([
      coachRows<{ user_id: string }>((from, to) => db.from("club_members").select("user_id")
        .eq("club_id", organizationId).eq("role", "player").eq("is_active", true).in("user_id", batch).order("user_id").range(from, to)),
      coachRows<{ player_id: string }>((from, to) => db.from("academy_roster_entries").select("player_id")
        .eq("academy_id", organizationId).in("player_id", batch).in("status", ["suspended", "ended"]).order("player_id").range(from, to)),
    ]);
    const blocked = new Set(excluded.map((row) => row.player_id));
    members.forEach((row) => { if (!blocked.has(row.user_id)) allowed.add(row.user_id); });
  }
  return allowed;
}
