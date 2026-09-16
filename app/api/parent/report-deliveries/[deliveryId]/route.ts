import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest, ctx: { params: Promise<{ deliveryId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { deliveryId } = await ctx.params;
    const { supabaseAdmin: db, callerId } = await requireCaller(token);
    const delivery = await db.from("player_periodic_report_deliveries").select("id,club_id,recipient_user_id,report_ids,player_user_ids,period_from,period_to").eq("id", deliveryId).maybeSingle();
    if (delivery.error) throw new Error(delivery.error.message);
    if (!delivery.data) return NextResponse.json({ error: "Livraison introuvable." }, { status: 404 });
    if (delivery.data.recipient_user_id !== callerId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const playerIds = (delivery.data.player_user_ids ?? []).map(String);
    const links = playerIds.length ? await db.from("player_guardians").select("player_id,can_view").eq("guardian_user_id", callerId).in("player_id", playerIds) : { data: [], error: null };
    if (links.error) throw new Error(links.error.message);
    const allowed = new Set((links.data ?? []).filter((link) => link.can_view !== false).map((link) => String(link.player_id)));
    if (playerIds.some((id) => !allowed.has(id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const reports = await db.from("player_periodic_reports").select("id,club_id,player_user_id,period_label,published_content,personalized_comment").in("id", delivery.data.report_ids ?? []);
    if (reports.error) throw new Error(reports.error.message);
    const club = await db.from("clubs").select("name").eq("id", delivery.data.club_id).maybeSingle();
    return NextResponse.json({ reports: (reports.data ?? []).map((report) => ({ ...report, club_name: club.data?.name ?? "Club" })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
