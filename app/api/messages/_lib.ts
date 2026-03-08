import { createClient } from "@supabase/supabase-js";

export function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function createSupabaseAdmin() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export async function requireCaller(accessToken: string) {
  const supabaseAdmin = createSupabaseAdmin();
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) throw new Error("Invalid token");
  return { supabaseAdmin, callerId: callerData.user.id };
}

export async function isOrgMemberActive(supabaseAdmin: any, organizationId: string, userId: string) {
  const memRes = await supabaseAdmin
    .from("club_members")
    .select("id")
    .eq("club_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return Boolean(memRes.data?.id);
}

export async function isOrgStaffMember(supabaseAdmin: any, organizationId: string, userId: string) {
  const staffRes = await supabaseAdmin.rpc("is_org_staff_member", {
    p_org_id: organizationId,
    p_user_id: userId,
  });
  return !staffRes.error && Boolean(staffRes.data);
}

