import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess } from "@/app/api/camps/_lib";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId: rawEventId } = await params;
    const eventId = String(rawEventId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const nextStatus = String(body?.status ?? "").trim();
    if (nextStatus !== "present" && nextStatus !== "absent") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const campDayRes = await supabaseAdmin
      .from("club_camp_days")
      .select("camp_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (campDayRes.error) return NextResponse.json({ error: campDayRes.error.message }, { status: 400 });
    if (!campDayRes.data?.camp_id) return NextResponse.json({ error: "Camp day not found" }, { status: 404 });

    const campPlayerRes = await supabaseAdmin
      .from("club_camp_players")
      .select("camp_id,registration_status")
      .eq("camp_id", campDayRes.data.camp_id)
      .eq("player_id", access.effectiveUserId)
      .maybeSingle();
    if (campPlayerRes.error) return NextResponse.json({ error: campPlayerRes.error.message }, { status: 400 });
    if (!campPlayerRes.data?.camp_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (campPlayerRes.data.registration_status !== "registered") {
      return NextResponse.json({ error: "Inscription au stage requise." }, { status: 400 });
    }

    const attendeeUpdateRes = await supabaseAdmin
      .from("club_event_attendees")
      .update({ status: nextStatus })
      .eq("event_id", eventId)
      .eq("player_id", access.effectiveUserId);
    if (attendeeUpdateRes.error) return NextResponse.json({ error: attendeeUpdateRes.error.message }, { status: 400 });

    if (nextStatus === "present" && campPlayerRes.data.registration_status !== "registered") {
      const campPlayerUpdateRes = await supabaseAdmin
        .from("club_camp_players")
        .update({
          registration_status: "registered",
          registered_at: new Date().toISOString(),
        })
        .eq("camp_id", campDayRes.data.camp_id)
        .eq("player_id", access.effectiveUserId);
      if (campPlayerUpdateRes.error) return NextResponse.json({ error: campPlayerUpdateRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
