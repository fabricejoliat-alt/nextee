import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

type TrainingVolumeTargetRow = {
  level_label: string;
  motivation_text?: string | null;
  handicap_min: number | null;
  handicap_max: number | null;
  minutes_offseason: number;
  minutes_inseason: number;
};

function parseMonthArray(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const uniq = new Set<number>();
  for (const v of values) {
    const n = Number(v);
    if (!Number.isInteger(n)) continue;
    if (n < 1 || n > 12) continue;
    uniq.add(n);
  }
  return Array.from(uniq);
}

function pickTrainingVolumeTarget(
  handicap: number | null | undefined,
  rows: TrainingVolumeTargetRow[]
): TrainingVolumeTargetRow | null {
  if (!rows.length) return null;
  if (typeof handicap !== "number" || !Number.isFinite(handicap)) return rows[0] ?? null;

  const matched = rows.find((row) => {
    if (typeof row.handicap_min !== "number" || typeof row.handicap_max !== "number") return false;
    const lo = Math.min(row.handicap_min, row.handicap_max);
    const hi = Math.max(row.handicap_min, row.handicap_max);
    return handicap >= lo && handicap <= hi;
  });
  return matched ?? rows[0] ?? null;
}

function objectiveForMonth(
  target: TrainingVolumeTargetRow | null,
  seasonMonths: number[],
  offseasonMonths: number[],
  month: number
) {
  if (!target) return 0;
  const inSeason =
    seasonMonths.includes(month) || (!offseasonMonths.includes(month) && seasonMonths.length > 0);
  return inSeason ? target.minutes_inseason : target.minutes_offseason;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });
    const requestedOrganizationId = String(req.nextUrl.searchParams.get("organization_id") ?? "").trim();

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const [meRes, playerMembershipsRes, profileRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", callerId)
        .eq("is_active", true)
        .in("role", ["coach", "manager"]),
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", playerId)
        .eq("is_active", true),
      supabaseAdmin
        .from("profiles")
        .select("handicap")
        .eq("id", playerId)
        .maybeSingle(),
    ]);
    if (meRes.error) return NextResponse.json({ error: meRes.error.message }, { status: 400 });
    if (playerMembershipsRes.error) return NextResponse.json({ error: playerMembershipsRes.error.message }, { status: 400 });
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });

    const myClubIds = new Set((meRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
    const playerClubIds = Array.from(
      new Set((playerMembershipsRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean))
    );
    const sharedClubIds = playerClubIds.filter((id) => myClubIds.has(id));
    if (sharedClubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (requestedOrganizationId && !sharedClubIds.includes(requestedOrganizationId)) {
      return NextResponse.json({ error: "Forbidden organization" }, { status: 403 });
    }

    const handicap = (profileRes.data as any)?.handicap;
    const nowMonth = new Date().getMonth() + 1;

    const scopedClubIds = requestedOrganizationId ? [requestedOrganizationId] : sharedClubIds;

    const perClub = await Promise.all(
      scopedClubIds.map(async (clubId) => {
        const [settingsRes, targetsRes] = await Promise.all([
          supabaseAdmin
            .from("training_volume_settings")
            .select("season_months,offseason_months")
            .eq("organization_id", clubId)
            .maybeSingle(),
          supabaseAdmin
            .from("training_volume_targets")
            .select("level_label,motivation_text,handicap_min,handicap_max,minutes_offseason,minutes_inseason,sort_order")
            .eq("organization_id", clubId)
            .order("sort_order", { ascending: true }),
        ]);
        if (settingsRes.error || targetsRes.error) return null;
        const rows = (targetsRes.data ?? []) as TrainingVolumeTargetRow[];
        const seasonMonths = parseMonthArray((settingsRes.data as any)?.season_months);
        const offseasonMonths = parseMonthArray((settingsRes.data as any)?.offseason_months);
        const target = pickTrainingVolumeTarget(typeof handicap === "number" ? handicap : null, rows);
        const objective = objectiveForMonth(target, seasonMonths, offseasonMonths, nowMonth);
        return { target, objective, organization_id: clubId };
      })
    );

    const best = perClub
      .filter((x): x is { target: TrainingVolumeTargetRow | null; objective: number; organization_id: string } => Boolean(x))
      .sort((a, b) => b.objective - a.objective)[0];

    return NextResponse.json({
      organization_id: best?.organization_id ?? null,
      level_label: best?.target?.level_label ?? null,
      objective_minutes: best?.objective ?? null,
      motivation_text: String(best?.target?.motivation_text ?? "").trim() || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
