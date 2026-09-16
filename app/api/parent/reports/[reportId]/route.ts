import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest, ctx: { params: Promise<{ reportId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { reportId } = await ctx.params; const { supabaseAdmin: db, callerId } = await requireCaller(token);
    const report = await db.from("player_periodic_reports").select("id,club_id,player_user_id,period_from,period_to,period_label,published_content,personalized_comment,generated_at").eq("id", reportId).maybeSingle();
    if (report.error) throw new Error(report.error.message); if (!report.data) return NextResponse.json({ error: "Rapport introuvable." }, { status: 404 });
    const link = await db.from("player_guardians").select("player_id,can_view").eq("player_id", report.data.player_user_id).eq("guardian_user_id", callerId).maybeSingle();
    if (link.error || !link.data || link.data.can_view === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const club = await db.from("clubs").select("name").eq("id", report.data.club_id).maybeSingle();
    return NextResponse.json({ report: { ...report.data, club_name: club.data?.name ?? "Club" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}
