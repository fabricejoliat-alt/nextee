import type { SupabaseClient } from "@supabase/supabase-js";

/** A parent's global login must not give a club Manager access to staff accounts. */
export async function protectedParentAccounts(db: SupabaseClient, userIds: string[]) {
  const platform = new Set<string>(), credentials = new Set<string>();
  for (let from = 0; from < userIds.length; from += 100) {
    const ids = userIds.slice(from, from + 100);
    const admins = await db.from("app_admins").select("user_id").in("user_id", ids);
    if (admins.error) throw admins.error;
    for (const row of admins.data ?? []) { platform.add(row.user_id); credentials.add(row.user_id); }
    // Include other clubs and inactive staff roles: reactivation must not expose their login.
    for (const table of ["club_members", "organization_members"]) {
      const roles = table === "club_members" ? ["manager", "coach"] : ["owner", "admin", "manager", "coach", "captain", "staff"];
      for (let offset = 0; ; offset += 500) {
        const result = await db.from(table).select("user_id")
          .in("user_id", ids).in("role", roles)
          .order("user_id").range(offset, offset + 499);
        if (result.error) throw result.error;
        for (const row of result.data ?? []) credentials.add(row.user_id);
        if ((result.data?.length ?? 0) < 500) break;
      }
    }
  }
  return { platform, credentials };
}
