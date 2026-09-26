import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

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

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const url = new URL(req.url);
    const playerId = (url.searchParams.get("player_id") ?? "").trim() || null;
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: playerId,
      requestedOrganizationId: clubId,
      mode: "view",
    });
    const { supabaseAdmin } = access;

    const [settingsRes, rowsRes, seasonsRes] = await Promise.all([
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
      supabaseAdmin
        .from("club_seasons")
        .select("id,name,starts_on,ends_on,is_current")
        .eq("club_id", clubId)
        .order("starts_on", { ascending: false }),
    ]);

    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 400 });
    if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 400 });
    if (seasonsRes.error) return NextResponse.json({ error: seasonsRes.error.message }, { status: 400 });

    return NextResponse.json({
      settings: {
        season_months: sanitizeMonths(settingsRes.data?.season_months ?? []),
        offseason_months: sanitizeMonths(settingsRes.data?.offseason_months ?? []),
      },
      rows: rowsRes.data ?? [],
      seasons: seasonsRes.data ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: playerAccessErrorStatus(e) }
    );
  }
}
