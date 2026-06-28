import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

type TrainingVolumeTargetRow = {
  id: string;
  ftem_code: string;
  level_label: string;
  handicap_label: string;
  handicap_min: number | null;
  handicap_max: number | null;
  motivation_text: string | null;
  minutes_offseason: number;
  minutes_inseason: number;
  sort_order: number;
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const [meRes, playerMembershipsRes, historyRes, profileRes] = await Promise.all([
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
        .from("player_handicap_history")
        .select("id,effective_date,value,note")
        .eq("user_id", playerId)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("profiles").select("handicap").eq("id", playerId).maybeSingle(),
    ]);

    if (meRes.error) return NextResponse.json({ error: meRes.error.message }, { status: 400 });
    if (playerMembershipsRes.error) return NextResponse.json({ error: playerMembershipsRes.error.message }, { status: 400 });
    if (historyRes.error) return NextResponse.json({ error: historyRes.error.message }, { status: 400 });
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });

    const myClubIds = new Set((meRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
    const playerClubIds = Array.from(
      new Set((playerMembershipsRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean))
    );
    const sharedClubIds = playerClubIds.filter((id) => myClubIds.has(id));
    if (sharedClubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const configsRes = await Promise.all(
      sharedClubIds.map(async (clubId) => {
        const [settingsRes, targetsRes] = await Promise.all([
          supabaseAdmin
            .from("training_volume_settings")
            .select("season_months,offseason_months")
            .eq("organization_id", clubId)
            .maybeSingle(),
          supabaseAdmin
            .from("training_volume_targets")
            .select("id,ftem_code,level_label,handicap_label,handicap_min,handicap_max,motivation_text,minutes_offseason,minutes_inseason,sort_order")
            .eq("organization_id", clubId)
            .order("sort_order", { ascending: true }),
        ]);
        if (settingsRes.error || targetsRes.error) return null;
        return {
          organization_id: clubId,
          season_months: parseMonthArray((settingsRes.data as any)?.season_months),
          offseason_months: parseMonthArray((settingsRes.data as any)?.offseason_months),
          rows: (targetsRes.data ?? []) as TrainingVolumeTargetRow[],
        };
      })
    );

    return NextResponse.json({
      current_handicap: typeof (profileRes.data as any)?.handicap === "number" ? (profileRes.data as any).handicap : null,
      handicap_history: historyRes.data ?? [],
      configs: configsRes.filter(Boolean),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
