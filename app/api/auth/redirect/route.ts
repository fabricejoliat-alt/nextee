import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { playerConsentAllowsAccess } from "@/lib/playerConsent";
import { loadPlayerActorAuthorization, visibleGuardianLinks } from "@/app/api/player/access";
import { selectPrimaryApplicationRole } from "@/lib/playerAccessPolicy";

async function resolvePlayerConsentPending(supabaseAdmin: SupabaseClient, userId: string) {
  const membershipsRes = await supabaseAdmin
    .from("club_members")
    .select("player_consent_status")
    .eq("user_id", userId)
    .eq("role", "player")
    .eq("is_active", true);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);
  return !playerConsentAllowsAccess(
    ((membershipsRes.data ?? []) as Array<{ player_consent_status: string | null }>).map(
      (row) => row.player_consent_status
    )
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Qui est-ce ? (à partir du token utilisateur)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = userData.user.id;

    // Superadmin ?
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json({ error: adminErr.message }, { status: 400 });
    }

    const resHeaders = { "Cache-Control": "no-store" as const };

    if (adminRow) {
      return NextResponse.json({ redirectTo: "/admin" }, { headers: resHeaders });
    }

    const actor = await loadPlayerActorAuthorization(supabaseAdmin, userId);
    const role = selectPrimaryApplicationRole(actor.actorRoles);
    if (!role) {
      return NextResponse.json({ redirectTo: "/no-access" }, { headers: resHeaders });
    }

    if (role === "manager") return NextResponse.json({ redirectTo: "/manager" }, { headers: resHeaders });
    if (role === "coach") return NextResponse.json({ redirectTo: "/coach" }, { headers: resHeaders });
    if (role === "parent") {
      if (visibleGuardianLinks(actor.guardianLinks).length === 0) {
        return NextResponse.json({ redirectTo: "/no-access" }, { headers: resHeaders });
      }
      return NextResponse.json({ redirectTo: "/player" }, { headers: resHeaders });
    }
    if (role === "player") {
      const pendingConsent = await resolvePlayerConsentPending(supabaseAdmin, userId);
      if (pendingConsent) return NextResponse.json({ redirectTo: "/player/consent-required" }, { headers: resHeaders });
    }
    return NextResponse.json({ redirectTo: "/player" }, { headers: resHeaders });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
