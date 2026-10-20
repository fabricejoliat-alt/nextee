import type { SupabaseClient } from "@supabase/supabase-js";

type Access = { viewerUserId: string; effectiveUserId: string; clubIds: string[] };
export type MarketplaceListing = { id: string; user_id: string; club_id: string; is_active: boolean; moderation_status: string };

export async function marketplaceSafetyContext(db: SupabaseClient, access: Access) {
  const ids = [...new Set([access.viewerUserId, access.effectiveUserId])];
  const [outgoing, incoming, suspensions] = await Promise.all([
    db.from("marketplace_blocks").select("blocked_id").in("blocker_id", ids),
    db.from("marketplace_blocks").select("blocker_id").in("blocked_id", ids),
    db.from("marketplace_suspensions").select("user_id,club_id").in("club_id", access.clubIds),
  ]);
  if (outgoing.error || incoming.error || suspensions.error) throw new Error("Marketplace safety unavailable");
  const blocked = new Set<string>([
    ...(outgoing.data ?? []).map(row => row.blocked_id),
    ...(incoming.data ?? []).map(row => row.blocker_id),
  ]);
  const suspended = suspensions.data ?? [];
  return {
    canMessage(userId: string, clubId: string, actorId?: string | null) {
      const others = [...new Set([userId, actorId].filter((id): id is string => Boolean(id)))];
      return !others.some(id => blocked.has(id))
        && !suspended.some(row => row.club_id === clubId && [...ids, ...others].includes(row.user_id));
    },
    visible(item: MarketplaceListing) {
      return item.is_active && item.moderation_status === "approved" && !blocked.has(item.user_id)
        && !suspended.some(row => row.club_id === item.club_id && [...ids, item.user_id].includes(row.user_id));
    },
    canPublish(clubId: string) {
      return !suspended.some(row => row.club_id === clubId && ids.includes(row.user_id));
    },
  };
}

export const marketplaceSafetyHeaders = { "Cache-Control": "private, no-store" };
export const marketplaceReportReasons = ["inappropriate", "harassment", "fraud", "other"] as const;
export const marketplaceUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
