import type { SupabaseClient } from "@supabase/supabase-js";
import { adminAssurance } from "@/lib/adminSecurity";

export async function verifiedAdminAssurance(db: SupabaseClient, token: string, actorId: string) {
  const result = await db.auth.getClaims(token);
  if (result.error) throw new Error("Unable to verify admin assurance");
  return adminAssurance(result.data?.claims ?? null, actorId);
}

export const adminNoStore = { "Cache-Control": "private, no-store, max-age=0" };
