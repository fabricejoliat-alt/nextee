import type { SupabaseClient } from "@supabase/supabase-js";

export type CoachClubPermission = "groups" | "planning" | "transfer";

export async function hasCoachClubPermission(
  db: SupabaseClient,
  userId: string,
  clubId: string,
  permission: CoachClubPermission,
  groupId?: string
) {
  const membership = await db.from("club_members")
    .select("role,is_active,can_manage_assigned_groups,can_manage_assigned_group_planning,can_transfer_players_between_club_groups")
    .eq("club_id", clubId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (membership.error) throw new Error(membership.error.message);
  if (!membership.data) return false;
  if (membership.data.role === "manager") return true;
  if (membership.data.role !== "coach") return false;
  const enabled = permission === "groups"
    ? membership.data.can_manage_assigned_groups
    : permission === "planning"
      ? membership.data.can_manage_assigned_group_planning
      : membership.data.can_transfer_players_between_club_groups;
  if (!enabled) return false;
  if (permission === "transfer" || !groupId) return true;
  const [group, link] = await Promise.all([
    db.from("coach_groups").select("id").eq("id", groupId).eq("club_id", clubId).eq("head_coach_user_id", userId).maybeSingle(),
    db.from("coach_group_coaches").select("id").eq("group_id", groupId).eq("coach_user_id", userId).maybeSingle(),
  ]);
  if (group.error || link.error) throw new Error(group.error?.message ?? link.error?.message);
  return Boolean(group.data || link.data);
}
