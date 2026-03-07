import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sanitizeMonths(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const uniq = new Set<number>();
  for (const m of value) {
    const n = Number(m);
    if (!Number.isInteger(n)) continue;
    if (n < 1 || n > 12) continue;
    uniq.add(n);
  }
  return Array.from(uniq);
}

async function canReadTrainingVolume(supabaseAdmin: any, callerId: string, clubId: string, playerId?: string | null) {
  const effectivePlayerId = (playerId ?? callerId).trim();

  const directPlayerMembership = await supabaseAdmin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("role", "player")
    .eq("is_active", true)
    .maybeSingle();
  if (directPlayerMembership.data?.id) return true;

  if (!effectivePlayerId) return false;

  const parentMembership = await supabaseAdmin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("role", "parent")
    .eq("is_active", true)
    .maybeSingle();

  if (!parentMembership.data?.id) return false;

  const playerMembership = await supabaseAdmin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", effectivePlayerId)
    .eq("role", "player")
    .eq("is_active", true)
    .maybeSingle();
  if (!playerMembership.data?.id) return false;

  const guardianLink = await supabaseAdmin
    .from("player_guardians")
    .select("player_id")
    .eq("guardian_user_id", callerId)
    .eq("player_id", effectivePlayerId)
    .eq("can_view", true)
    .maybeSingle();

  return Boolean(guardianLink.data?.player_id);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const url = new URL(req.url);
    const playerId = (url.searchParams.get("player_id") ?? "").trim() || null;

    const allowed = await canReadTrainingVolume(supabaseAdmin, callerData.user.id, clubId, playerId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [settingsRes, rowsRes] = await Promise.all([
      supabaseAdmin
        .from("training_volume_settings")
        .select("season_months,offseason_months")
        .eq("organization_id", clubId)
        .maybeSingle(),
      supabaseAdmin
        .from("training_volume_targets")
        .select("id,ftem_code,level_label,handicap_label,handicap_min,handicap_max,motivation_text,minutes_offseason,minutes_inseason,sort_order")
        .eq("organization_id", clubId)
        .order("sort_order", { ascending: true })
        .order("ftem_code", { ascending: true }),
    ]);

    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 400 });
    if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 400 });

    return NextResponse.json({
      settings: {
        season_months: sanitizeMonths(settingsRes.data?.season_months ?? []),
        offseason_months: sanitizeMonths(settingsRes.data?.offseason_months ?? []),
      },
      rows: rowsRes.data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
