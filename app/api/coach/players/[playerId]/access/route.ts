import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

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
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (access.sharedClubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [profileRes, clubsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .eq("id", playerId)
        .maybeSingle(),
      supabaseAdmin
        .from("clubs")
        .select("id,name")
        .in("id", access.sharedClubIds),
    ]);

    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });

    return NextResponse.json({
      access: {
        shared_club_ids: access.sharedClubIds,
        can_access_sensitive_sections: access.canAccessSensitiveSections,
      },
      profile: profileRes.data ?? null,
      organizations: (clubsRes.data ?? [])
        .map((club: any) => String(club?.name ?? "").trim())
        .filter(Boolean),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
