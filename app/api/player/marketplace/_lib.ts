import { createClient } from "@supabase/supabase-js";

export function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export function createAdminClient() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export async function resolveMarketplaceAccess(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  accessToken: string,
  childIdRaw: string,
  mode: "view" | "edit" = "view"
) {
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) {
    return { error: "Invalid token", status: 401 as const };
  }

  const viewerUserId = String(callerData.user.id ?? "").trim();
  const childId = String(childIdRaw ?? "").trim();

  const membershipsRes = await supabaseAdmin
    .from("club_members")
    .select("role")
    .eq("user_id", viewerUserId)
    .eq("is_active", true);
  if (membershipsRes.error) {
    return { error: membershipsRes.error.message, status: 400 as const };
  }

  const roles = new Set(((membershipsRes.data ?? []) as Array<{ role: string | null }>).map((row) => String(row.role ?? "")));
  const isParent = roles.has("parent");

  let effectiveUserId = viewerUserId;
  if (isParent && childId) {
    const guardianRes = await supabaseAdmin
      .from("player_guardians")
      .select("player_id")
      .eq("guardian_user_id", viewerUserId)
      .eq("player_id", childId)
      .or(mode === "edit" ? "can_edit.eq.true" : "can_view.is.null,can_view.eq.true")
      .maybeSingle();
    if (guardianRes.error) {
      return { error: guardianRes.error.message, status: 400 as const };
    }
    if (!guardianRes.data?.player_id) {
      return { error: "Forbidden", status: 403 as const };
    }
    effectiveUserId = String(guardianRes.data.player_id ?? "").trim();
  } else if (isParent) {
    const childrenRes = await supabaseAdmin
      .from("player_guardians")
      .select("player_id,is_primary")
      .eq("guardian_user_id", viewerUserId)
      .or(mode === "edit" ? "can_edit.eq.true" : "can_view.is.null,can_view.eq.true")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (childrenRes.error) {
      return { error: childrenRes.error.message, status: 400 as const };
    }
    const fallbackChildId = String(childrenRes.data?.[0]?.player_id ?? "").trim();
    if (!fallbackChildId) {
      return { error: "Forbidden", status: 403 as const };
    }
    effectiveUserId = fallbackChildId;
  }

  const [clubMembersRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true),
    supabaseAdmin.from("profiles").select("phone").eq("id", effectiveUserId).maybeSingle(),
  ]);
  if (clubMembersRes.error) {
    return { error: clubMembersRes.error.message, status: 400 as const };
  }
  if (profileRes.error) {
    return { error: profileRes.error.message, status: 400 as const };
  }

  const clubIds = uniq(((clubMembersRes.data ?? []) as Array<{ club_id: string | null }>).map((row) => row.club_id));

  return {
    viewerUserId,
    effectiveUserId,
    clubIds,
    preferredClubId: clubIds[0] ?? "",
    phone: String((profileRes.data as { phone?: string | null } | null)?.phone ?? "").trim(),
    isParent,
  };
}

