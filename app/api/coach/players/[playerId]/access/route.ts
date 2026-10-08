import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";
import { coachClubCount } from "@/lib/server/coachClubCount";

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
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId,requestedOrganizationId(req.url));
    if (access.sharedClubIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [profileRes, clubsRes, clubCount] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .eq("id", playerId)
        .maybeSingle(),
      supabaseAdmin
        .from("organizations")
        .select("id,name")
        .in("id", access.sharedClubIds),
      coachClubCount(supabaseAdmin, callerId),
    ]);

    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });

    return NextResponse.json({
      access: {
        coach_club_count: clubCount,
        shared_club_ids: access.sharedClubIds,
        sensitive_club_ids: access.sensitiveClubIds,
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
