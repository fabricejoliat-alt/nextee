import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess } from "@/app/api/camps/_lib";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  try {
    const { campId: rawCampId } = await params;
    const campId = String(rawCampId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const membershipRes = await supabaseAdmin
      .from("club_camp_players")
      .select("camp_id,registration_status")
      .eq("camp_id", campId)
      .eq("player_id", access.effectiveUserId)
      .maybeSingle();
    if (membershipRes.error) return NextResponse.json({ error: membershipRes.error.message }, { status: 400 });
    if (!membershipRes.data?.camp_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const updateCampPlayerRes = await supabaseAdmin
      .from("club_camp_players")
      .update({
        registration_status: "registered",
        registered_at: new Date().toISOString(),
      })
      .eq("camp_id", campId)
      .eq("player_id", access.effectiveUserId);
    if (updateCampPlayerRes.error) return NextResponse.json({ error: updateCampPlayerRes.error.message }, { status: 400 });

    const dayIdsRes = await supabaseAdmin.from("club_camp_days").select("event_id").eq("camp_id", campId);
    if (dayIdsRes.error) return NextResponse.json({ error: dayIdsRes.error.message }, { status: 400 });

    const eventIds = (dayIdsRes.data ?? []).map((row: any) => String(row.event_id ?? "").trim()).filter(Boolean);
    if (eventIds.length > 0) {
      const attendeesRes = await supabaseAdmin
        .from("club_event_attendees")
        .update({ status: "present" })
        .in("event_id", eventIds)
        .eq("player_id", access.effectiveUserId);
      if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  try {
    const { campId: rawCampId } = await params;
    const campId = String(rawCampId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const membershipRes = await supabaseAdmin
      .from("club_camp_players")
      .select("camp_id")
      .eq("camp_id", campId)
      .eq("player_id", access.effectiveUserId)
      .maybeSingle();
    if (membershipRes.error) return NextResponse.json({ error: membershipRes.error.message }, { status: 400 });
    if (!membershipRes.data?.camp_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const updateCampPlayerRes = await supabaseAdmin
      .from("club_camp_players")
      .update({
        registration_status: "invited",
        registered_at: null,
      })
      .eq("camp_id", campId)
      .eq("player_id", access.effectiveUserId);
    if (updateCampPlayerRes.error) return NextResponse.json({ error: updateCampPlayerRes.error.message }, { status: 400 });

    const dayIdsRes = await supabaseAdmin.from("club_camp_days").select("event_id").eq("camp_id", campId);
    if (dayIdsRes.error) return NextResponse.json({ error: dayIdsRes.error.message }, { status: 400 });

    const eventIds = (dayIdsRes.data ?? []).map((row: any) => String(row.event_id ?? "").trim()).filter(Boolean);
    if (eventIds.length > 0) {
      const attendeesRes = await supabaseAdmin
        .from("club_event_attendees")
        .update({ status: "not_registered" })
        .in("event_id", eventIds)
        .eq("player_id", access.effectiveUserId);
      if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Server error" }, { status: 500 });
  }
}
