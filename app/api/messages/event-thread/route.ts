import { NextResponse, type NextRequest } from "next/server";
import { isOrgMemberActive, isOrgStaffMember, requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const eventId = (new URL(req.url).searchParams.get("event_id") ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing event_id" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const evRes = await supabaseAdmin
      .from("club_events")
      .select("id,club_id")
      .eq("id", eventId)
      .maybeSingle();
    if (evRes.error) return NextResponse.json({ error: evRes.error.message }, { status: 400 });
    if (!evRes.data?.id) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const organizationId = String(evRes.data.club_id ?? "");
    if (!organizationId) return NextResponse.json({ error: "Event organization missing" }, { status: 400 });

    const [orgMember, orgStaff] = await Promise.all([
      isOrgMemberActive(supabaseAdmin, organizationId, callerId),
      isOrgStaffMember(supabaseAdmin, organizationId, callerId),
    ]);
    if (!orgMember && !orgStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const ensureRes = await supabaseAdmin.rpc("ensure_event_thread_for_event", { p_event_id: eventId });
    if (ensureRes.error) return NextResponse.json({ error: ensureRes.error.message }, { status: 400 });

    return NextResponse.json({ thread_id: ensureRes.data ?? null, organization_id: organizationId, event_id: eventId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
