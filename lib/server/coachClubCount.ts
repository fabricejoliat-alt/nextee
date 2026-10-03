import type { SupabaseClient } from "@supabase/supabase-js";

export async function coachClubCount(db: SupabaseClient, coachId: string) {
  const result = await db.from("club_members").select("club_id")
    .eq("user_id", coachId).eq("is_active", true).in("role", ["coach", "manager"]);
  if (result.error) throw new Error(result.error.message);
  return new Set((result.data ?? []).map((member) => member.club_id)).size;
}
