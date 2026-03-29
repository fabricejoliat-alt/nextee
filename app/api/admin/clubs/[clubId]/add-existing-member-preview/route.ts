import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function authorizeClubAdmin(supabaseAdmin: any, clubId: string, accessToken: string) {
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) {
    return { ok: false as const, status: 401, error: "Invalid token" };
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

  if (!isAllowed) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const };
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

async function countLinkedParents(supabaseAdmin: any, userId: string) {
  const { count, error } = await supabaseAdmin
    .from("player_guardians")
    .select("guardian_user_id", { count: "exact", head: true })
    .eq("player_id", userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
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

    const auth = await authorizeClubAdmin(supabaseAdmin, clubId, accessToken);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => null);
    const userId = String(body?.user_id ?? "").trim();
    const role = String(body?.role ?? "").trim().toLowerCase();

    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    if (!["manager", "coach", "player", "parent"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const consentStatus =
      role === "player" ? await resolveExistingPlayerConsentStatus(supabaseAdmin, userId) : null;
    const linkedParentsCount =
      role === "player" ? await countLinkedParents(supabaseAdmin, userId) : 0;

    return NextResponse.json({
      consent_status: consentStatus,
      linked_parents_count: linkedParentsCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
