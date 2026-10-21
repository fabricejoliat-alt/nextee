import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadNotificationBadgeCounts(db: SupabaseClient, userIds: string[]) {
  const ids = [...new Set(userIds)];
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const { data, error } = await db.rpc("notification_badge_counts_v1", { p_user_ids: batch });
    if (error || !Array.isArray(data)) throw new Error("Notification badge count unavailable");
    for (const row of data) {
      const count = Number(row.unread_count);
      if (batch.includes(row.user_id) && row.unread_count != null && Number.isSafeInteger(count) && count >= 0) counts.set(row.user_id, count);
    }
  }
  return counts;
}
