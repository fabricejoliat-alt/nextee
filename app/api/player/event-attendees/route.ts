import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import {
  bearerTokenFromRequest,
  playerAccessErrorStatus,
  resolveAuthenticatedPlayerAccess,
} from "@/app/api/player/access";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const eventId = String(url.searchParams.get("event_id") ?? "").trim();
    const childId = String(url.searchParams.get("child_id") ?? "").trim();
    if (!eventId) return NextResponse.json({ attendees: [] });
    const access = await resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedOrganizationId: requestedOrganizationId(req.url),
      requestedPlayerId: childId,
      mode: "view",
    });
    const { supabaseAdmin } = access;
    const effectivePlayerId = access.subjectPlayerId;

    const accessCheck = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId)
      .eq("player_id", effectivePlayerId)
      .maybeSingle();
    if (accessCheck.error) return NextResponse.json({ error: accessCheck.error.message }, { status: 400 });
    if (!accessCheck.data?.player_id) return NextResponse.json({ attendees: [] });

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("group_id,event_type,club_id")
      .eq("id", eventId)
      .in("club_id", access.organizationIds)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const eventType = String((eventRes.data as { event_type?: string | null } | null)?.event_type ?? "").trim();

    if (eventType === "camp") {
      const campDayRes = await supabaseAdmin
        .from("club_camp_days")
        .select("camp_id")
        .eq("event_id", eventId)
        .maybeSingle();
      if (campDayRes.error) return NextResponse.json({ error: campDayRes.error.message }, { status: 400 });
      const campId = String((campDayRes.data as { camp_id?: string | null } | null)?.camp_id ?? "").trim();
      if (!campId) return NextResponse.json({ attendees: [] });

      const registeredPlayersRes = await supabaseAdmin
        .from("club_camp_players")
        .select("player_id,registration_status")
        .eq("camp_id", campId)
        .eq("registration_status", "registered");
      if (registeredPlayersRes.error) return NextResponse.json({ error: registeredPlayersRes.error.message }, { status: 400 });

      const registeredPlayerIds = Array.from(
        new Set(
          ((registeredPlayersRes.data ?? []) as Array<{ player_id: string | null }>)
            .map((row) => String(row.player_id ?? "").trim())
            .filter(Boolean)
        )
      );
      if (registeredPlayerIds.length === 0) return NextResponse.json({ attendees: [] });

      const attendeesRes = await supabaseAdmin
        .from("club_event_attendees")
        .select("player_id,status")
        .eq("event_id", eventId)
        .eq("status", "present")
        .in("player_id", registeredPlayerIds);
      if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });

      const presentPlayerIds = Array.from(
        new Set(
          ((attendeesRes.data ?? []) as Array<{ player_id: string | null }>)
            .map((row) => String(row.player_id ?? "").trim())
            .filter(Boolean)
        )
      );
      if (presentPlayerIds.length === 0) return NextResponse.json({ attendees: [] });

      const profilesRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,avatar_url")
        .in("id", presentPlayerIds);
      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });

      const namesById: Record<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }> = {};
      (profilesRes.data ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }) => {
        namesById[String(p.id)] = {
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      });

      const attendees = presentPlayerIds
        .map((pid) => ({
          player_id: pid,
          status: "present" as const,
          first_name: namesById[pid]?.first_name ?? null,
          last_name: namesById[pid]?.last_name ?? null,
          avatar_url: namesById[pid]?.avatar_url ?? null,
        }))
        .sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, "fr"));

      return NextResponse.json({ attendees });
    }

    const groupId = String((eventRes.data as { group_id?: string | null } | null)?.group_id ?? "").trim();
    if (!groupId) return NextResponse.json({ attendees: [] });

    const groupPlayersRes = await supabaseAdmin
      .from("coach_group_players")
      .select("player_user_id")
      .eq("group_id", groupId);
    if (groupPlayersRes.error) return NextResponse.json({ error: groupPlayersRes.error.message }, { status: 400 });

    const groupPlayerIds = Array.from(
      new Set(
        ((groupPlayersRes.data ?? []) as Array<{ player_user_id: string | null }>)
          .map((r) => String(r.player_user_id ?? "").trim())
          .filter(Boolean)
      )
    );
    if (groupPlayerIds.length === 0) return NextResponse.json({ attendees: [] });

    const attendeesRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id,status")
      .eq("event_id", eventId)
      .in("player_id", groupPlayerIds);
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });

    const attendanceRows = (attendeesRes.data ?? []) as Array<{
      player_id: string | null;
      status: "expected" | "present" | "absent" | "excused" | null;
    }>;
    const statusByPlayerId: Record<string, "expected" | "present" | "absent" | "excused"> = {};
    attendanceRows.forEach((r) => {
      const pid = String(r.player_id ?? "").trim();
      if (!pid) return;
      statusByPlayerId[pid] = (r.status ?? "expected") as "expected" | "present" | "absent" | "excused";
    });

    const namesById: Record<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }> = {};
    if (groupPlayerIds.length > 0) {
      const profilesRes = await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", groupPlayerIds);
      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
      (profilesRes.data ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }) => {
        namesById[String(p.id)] = {
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      });
    }

    const attendees = groupPlayerIds
      .map((pid) => ({
        player_id: pid,
        status: statusByPlayerId[pid] ?? "expected",
        first_name: namesById[pid]?.first_name ?? null,
        last_name: namesById[pid]?.last_name ?? null,
        avatar_url: namesById[pid]?.avatar_url ?? null,
      }))
      .sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, "fr"));

    return NextResponse.json({ attendees });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: playerAccessErrorStatus(e) });
  }
}
