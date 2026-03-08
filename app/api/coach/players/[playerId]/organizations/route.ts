import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

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

    const [meRes, playerRes] = await Promise.all([
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
    ]);
    if (meRes.error) return NextResponse.json({ error: meRes.error.message }, { status: 400 });
    if (playerRes.error) return NextResponse.json({ error: playerRes.error.message }, { status: 400 });

    const myClubIds = new Set((meRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
    const playerClubIds = Array.from(
      new Set((playerRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean))
    );
    const shared = playerClubIds.some((id) => myClubIds.has(id));
    if (!shared) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (playerClubIds.length === 0) return NextResponse.json({ organizations: [] });
    const clubsRes = await supabaseAdmin
      .from("clubs")
      .select("id,name")
      .in("id", playerClubIds);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });

    const organizations = (clubsRes.data ?? [])
      .map((c: any) => String(c.name ?? "").trim())
      .filter(Boolean);

    return NextResponse.json({ organizations });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

