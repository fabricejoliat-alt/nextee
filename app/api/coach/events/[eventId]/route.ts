import { authorizedCoachPlayers } from "@/lib/coachAccess";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deleteCoachPlanning } from "@/lib/server/coachPlanningDeletion";
import { requireCaller } from "@/app/api/messages/_lib";
import { canCoachAccessEvent } from "@/lib/coachAccess";
import { hasCoachClubPermission } from "@/lib/coachAuthorization";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";
import { coachClubCount } from "@/lib/server/coachClubCount";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { callerId } = await requireCaller(accessToken);

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data?.id) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const event = eventRes.data as any;
    const groupId = String(event.group_id ?? "").trim();
    const clubId = String(event.club_id ?? "").trim();
    if(requestedOrganizationId(req.url)&&requestedOrganizationId(req.url)!==clubId)return NextResponse.json({error:"Forbidden"},{status:403});
    const allowed = await canCoachAccessEvent(supabaseAdmin, callerId, eventId, groupId, clubId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const canManageActivity = clubId
      ? await hasCoachClubPermission(supabaseAdmin, callerId, clubId, "planning", groupId)
      : false;
    const coachTrainingAssistanceEnabled = await isCoachTrainingAssistanceEnabled(supabaseAdmin, clubId, callerId);

    const [clubRes, groupRes, attendeesRes, eventCoachesRes, structureRes, feedbackRes, campDayRes] = await Promise.all([
      clubId ? supabaseAdmin.from("organizations").select("id,name").eq("id", clubId).maybeSingle() : Promise.resolve({ data: null, error: null } as const),
      groupId ? supabaseAdmin.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle() : Promise.resolve({ data: null, error: null } as const),
      supabaseAdmin
        .from("club_event_attendees")
        .select("player_id,status,coach_recorded_status,coach_recorded_by,coach_recorded_at")
        .eq("event_id", eventId),
      supabaseAdmin.from("club_event_coaches").select("coach_id").eq("event_id", eventId),
      supabaseAdmin
        .from("club_event_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("club_event_coach_feedback").select("player_id,coach_id").eq("event_id", eventId),
      event.event_type === "camp"
        ? supabaseAdmin
            .from("club_camp_days")
            .select("camp_id,day_index,starts_at,ends_at,location_text")
            .eq("event_id", eventId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
    ]);

    if (clubRes.error) return NextResponse.json({ error: clubRes.error.message }, { status: 400 });
    if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 400 });
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
    if (eventCoachesRes.error) return NextResponse.json({ error: eventCoachesRes.error.message }, { status: 400 });
    if (structureRes.error) return NextResponse.json({ error: structureRes.error.message }, { status: 400 });
    if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 400 });
    if (campDayRes.error) return NextResponse.json({ error: campDayRes.error.message }, { status: 400 });

    let attendeeRows = (attendeesRes.data ?? []) as Array<{
      player_id: string;
      status: "expected" | "present" | "absent" | "excused";
      coach_recorded_status: "present" | "absent" | null;
      coach_recorded_by: string | null;
      coach_recorded_at: string | null;
    }>;
    if (event.event_type === "camp") {
      const campId = String((campDayRes.data as { camp_id?: string | null } | null)?.camp_id ?? "").trim();
      if (campId) {
        const registeredPlayersRes = await supabaseAdmin
          .from("club_camp_players")
          .select("player_id")
          .eq("camp_id", campId)
          .eq("registration_status", "registered");
        if (registeredPlayersRes.error) {
          return NextResponse.json({ error: registeredPlayersRes.error.message }, { status: 400 });
        }
        const registeredPlayerIds = new Set(
          ((registeredPlayersRes.data ?? []) as Array<{ player_id: string | null }>)
            .map((row) => String(row.player_id ?? "").trim())
            .filter(Boolean)
        );
        attendeeRows = attendeeRows.filter((row) => registeredPlayerIds.has(String(row.player_id ?? "").trim()));
      }
    }
    const permitted=await authorizedCoachPlayers(supabaseAdmin,callerId,clubId,attendeeRows.map(row=>row.player_id));
    attendeeRows=attendeeRows.filter(row=>permitted.has(row.player_id));
    const playerIds = uniq(attendeeRows.map((row) => row.player_id));
    const feedbackRows = ((feedbackRes.data ?? []) as Array<{ player_id: string | null; coach_id: string | null }>)
      .map((row) => ({
        player_id: String(row.player_id ?? "").trim(),
        coach_id: String(row.coach_id ?? "").trim() || null,
      }))
      .filter((row) => row.player_id && permitted.has(row.player_id));
    const selectedCoachIds = uniq((eventCoachesRes.data ?? []).map((row: any) => String(row.coach_id ?? "").trim()));

    const [profilesRes, clubCoachesRes] = await Promise.all([
      playerIds.length > 0
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name,handicap,avatar_url").in("id", playerIds)
        : Promise.resolve({ data: [], error: null } as const),
      clubId
        ? supabaseAdmin
            .from("club_members")
            .select("user_id")
            .eq("club_id", clubId)
            .eq("role", "coach")
            .eq("is_active", true)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (clubCoachesRes.error) return NextResponse.json({ error: clubCoachesRes.error.message }, { status: 400 });

    const profilesById: Record<string, any> = {};
    (profilesRes.data ?? []).forEach((profile: any) => {
      profilesById[String(profile.id)] = profile;
    });

    const attendees = attendeeRows
      .map((row) => ({
        ...row,
        profile: profilesById[String(row.player_id)] ?? null,
      }))
      .sort((a, b) => {
        const aName = `${a.profile?.first_name ?? ""} ${a.profile?.last_name ?? ""}`.trim();
        const bName = `${b.profile?.first_name ?? ""} ${b.profile?.last_name ?? ""}`.trim();
        return aName.localeCompare(bName, "fr");
      });

    const coachIds = uniq([
      ...((clubCoachesRes.data ?? []).map((row: any) => String(row.user_id ?? "").trim())),
      ...selectedCoachIds,
      ...feedbackRows.map((row) => String(row.coach_id ?? "").trim()),
    ]);
    const coachesById: Record<string, { id: string; first_name: string | null; last_name: string | null }> = {};
    if (coachIds.length > 0) {
      const coachProfilesRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name")
        .in("id", coachIds);
      if (coachProfilesRes.error) return NextResponse.json({ error: coachProfilesRes.error.message }, { status: 400 });
      (coachProfilesRes.data ?? []).forEach((profile: any) => {
        const id = String(profile.id ?? "").trim();
        if (!id) return;
        coachesById[id] = {
          id,
          first_name: profile.first_name ?? null,
          last_name: profile.last_name ?? null,
        };
      });
    }

    const coaches = Object.values(coachesById).sort((a, b) => {
      const aName = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
      const bName = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
      return aName.localeCompare(bName, "fr");
    });

    const evaluatedByPlayer = new Map<string, { player_id: string; coach_id: string | null }>();
    feedbackRows.forEach((row) => {
      if (!evaluatedByPlayer.has(row.player_id)) {
        evaluatedByPlayer.set(row.player_id, row);
      }
    });

    const evaluatedPlayers = Array.from(evaluatedByPlayer.values()).map((row) => {
      const coach = row.coach_id ? coachesById[row.coach_id] ?? null : null;
      const coachName = coach
        ? `${String(coach.first_name ?? "").trim()} ${String(coach.last_name ?? "").trim()}`.trim() || null
        : null;
      return {
        player_id: row.player_id,
        coach_id: row.coach_id,
        coach_name: coachName,
      };
    });

    return NextResponse.json({
      event,
      campDay: campDayRes.data ?? null,
      clubName: String((clubRes.data as any)?.name ?? "Club"),
      groupName: String((groupRes.data as any)?.name ?? "Groupe"),
      attendees,
      coaches,
      selectedCoachIds,
      structureItems: structureRes.data ?? [],
      evaluatedPlayerIds: Array.from(new Set(feedbackRows.filter((row) => row.coach_id === callerId).map((row) => row.player_id))),
      evaluatedPlayers,
      meId: callerId,
      canManageActivity,
      coachTrainingAssistanceEnabled,
      coachClubCount: await coachClubCount(supabaseAdmin, callerId),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await ctx.params;
  return deleteCoachPlanning(req, { eventId });
}
