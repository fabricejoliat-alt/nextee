import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function resolveExistingPlayerConsentStatus(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("club_members")
    .select("player_consent_status")
    .eq("user_id", userId)
    .eq("role", "player")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const statuses = (data ?? []).map((row: any) => String(row?.player_consent_status ?? ""));
  if (statuses.includes("granted")) return "granted";
  if (statuses.includes("adult")) return "adult";
  if (statuses.includes("pending")) return "pending";
  return null;
}

async function syncLinkedParentsToClub(supabaseAdmin: any, clubId: string, playerUserId: string) {
  const { data: links, error: linksError } = await supabaseAdmin
    .from("player_guardians")
    .select("guardian_user_id")
    .eq("player_id", playerUserId);
  if (linksError) throw new Error(linksError.message);

  const guardianIds = Array.from(
    new Set(
      ((links ?? []) as Array<{ guardian_user_id: string | null }>)
        .map((row) => String(row.guardian_user_id ?? "").trim())
        .filter(Boolean)
    )
  );

  if (guardianIds.length === 0) return;

  const rows = guardianIds.map((guardianUserId) => ({
    club_id: clubId,
    user_id: guardianUserId,
    role: "parent" as const,
    is_active: true,
  }));

  const { error } = await supabaseAdmin
    .from("club_members")
    .upsert(rows, { onConflict: "club_id,user_id,role" });
  if (error) throw new Error(error.message);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clubId: string }> }
) {
  try {
    const supabaseAdmin = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const callerId = callerData.user.id;
    const { data: adminRow } = await supabaseAdmin
      .from("app_admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    let isAllowed = Boolean(adminRow);
    if (!isAllowed) {
      const { data: membership } = await supabaseAdmin
        .from("club_members")
        .select("id,role,is_active")
        .eq("club_id", clubId)
        .eq("user_id", callerId)
        .eq("is_active", true)
        .maybeSingle();
      isAllowed = Boolean(membership && membership.role === "manager");
    }

    if (!isAllowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const userId = String(body?.user_id ?? "").trim();
    const role = String(body?.role ?? "").trim().toLowerCase();

    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    if (!["manager", "coach", "player", "parent"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const inheritedConsentStatus =
      role === "player" ? await resolveExistingPlayerConsentStatus(supabaseAdmin, userId) : null;

    const { data: memberRow, error: memberError } = await supabaseAdmin
      .from("club_members")
      .upsert(
        {
          club_id: clubId,
          user_id: userId,
          role,
          is_active: true,
          player_consent_status: role === "player" ? inheritedConsentStatus : null,
        },
        { onConflict: "club_id,user_id,role" }
      )
      .select("id")
      .single();

    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 400 });

    if (role === "player" && memberRow?.id) {
      await syncLinkedParentsToClub(supabaseAdmin, clubId, userId);
    }

    return NextResponse.json({ ok: true, member_id: memberRow?.id ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
