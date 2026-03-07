import { supabase } from "@/lib/supabaseClient";

export async function isEffectivePlayerPerformanceEnabled(playerUserId: string): Promise<boolean> {
  if (!playerUserId) return false;

  const res = await supabase
    .from("club_members")
    .select("id")
    .eq("user_id", playerUserId)
    .eq("role", "player")
    .eq("is_active", true)
    .eq("is_performance", true)
    .limit(1);

  if (res.error) return false;
  return (res.data ?? []).length > 0;
}

