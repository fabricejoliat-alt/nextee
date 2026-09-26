import { createClient } from "@supabase/supabase-js";
import { PlayerAccessError, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";

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
  try {
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken,
      requestedPlayerId: childIdRaw,
      mode,
      supabaseAdmin,
    });
    const profileRes = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", access.subjectPlayerId)
      .maybeSingle();
    if (profileRes.error) return { error: profileRes.error.message, status: 400 as const };

    return {
      viewerUserId: access.actorUserId,
      effectiveUserId: access.subjectPlayerId,
      clubIds: access.organizationIds,
      preferredClubId: access.organizationId,
      phone: String((profileRes.data as { phone?: string | null } | null)?.phone ?? "").trim(),
      isParent: access.isGuardianContext,
    };
  } catch (error: unknown) {
    if (error instanceof PlayerAccessError) return { error: error.message, status: error.status };
    throw error;
  }
}
