import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function nameOf(first: string | null | undefined, last: string | null | undefined) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

type CustomCriterionRow = { id: string; snapshot_respondent: string; [key: string]: unknown };
type CustomResponseRow = { event_criterion_id: string; respondent_role: string; value_json: unknown };
type CoachProfileRow = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; staff_function: string | null };
type GroupCoachRow = { coach_user_id: string; is_head: boolean | null };

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const viewerUserId = String(callerData.user.id ?? "").trim();
    const url = new URL(req.url);
    const eventId = String(url.searchParams.get("event_id") ?? "").trim();
    const childId = String(url.searchParams.get("child_id") ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing event_id" }, { status: 400 });

    let effectivePlayerId = viewerUserId;
    if (childId && childId !== viewerUserId) {
      const guardianRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", viewerUserId)
        .eq("player_id", childId)
        .or("can_view.is.null,can_view.eq.true")
        .maybeSingle();
      if (guardianRes.error) return NextResponse.json({ error: guardianRes.error.message }, { status: 400 });
      if (!guardianRes.data?.player_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      effectivePlayerId = String(guardianRes.data.player_id);
    }

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId)
      .eq("player_id", effectivePlayerId)
      .maybeSingle();
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (!attendeeRes.data?.player_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,status,title,requires_evaluation")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const event = eventRes.data as {
      id: string;
      group_id: string | null;
      club_id: string | null;
      event_type: string | null;
      starts_at: string;
      duration_minutes: number | null;
      location_text: string | null;
      status: string | null;
      title: string | null;
      requires_evaluation: boolean | null;
    };

    const campDayRes = event.event_type === "camp"
      ? await supabaseAdmin
          .from("club_camp_days")
          .select("camp_id,day_index")
          .eq("event_id", eventId)
          .maybeSingle()
      : ({ data: null, error: null } as const);
    if (campDayRes.error) return NextResponse.json({ error: campDayRes.error.message }, { status: 400 });

    const campId = String((campDayRes.data as { camp_id?: string | null } | null)?.camp_id ?? "").trim();

    const [groupRes, clubRes, feedbackRes, playerStructureRes, campRes, eventCoachLinksRes] = await Promise.all([
      event.group_id
        ? supabaseAdmin.from("coach_groups").select("name").eq("id", event.group_id).maybeSingle()
        : ({ data: null, error: null } as const),
      event.club_id
        ? supabaseAdmin.from("clubs").select("name").eq("id", event.club_id).maybeSingle()
        : ({ data: null, error: null } as const),
      supabaseAdmin
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,player_note")
        .eq("event_id", eventId)
        .eq("player_id", effectivePlayerId)
        .eq("visible_to_player", true),
      supabaseAdmin
        .from("club_event_player_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .eq("player_id", effectivePlayerId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      campId
        ? supabaseAdmin.from("club_camps").select("id,title,head_coach_user_id").eq("id", campId).maybeSingle()
        : ({ data: null, error: null } as const),
      supabaseAdmin.from("club_event_coaches").select("coach_id").eq("event_id", eventId),
    ]);

    if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 400 });
    if (clubRes.error) return NextResponse.json({ error: clubRes.error.message }, { status: 400 });
    if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 400 });
    if (playerStructureRes.error) return NextResponse.json({ error: playerStructureRes.error.message }, { status: 400 });
    if (campRes.error) return NextResponse.json({ error: campRes.error.message }, { status: 400 });
    if (eventCoachLinksRes.error) return NextResponse.json({ error: eventCoachLinksRes.error.message }, { status: 400 });

    const allCustomCriteriaRes = await supabaseAdmin
      .from("club_event_evaluation_criteria")
      .select("*")
      .eq("event_id", eventId)
      .eq("is_enabled", true)
      .order("position");
    if (allCustomCriteriaRes.error) return NextResponse.json({ error: allCustomCriteriaRes.error.message }, { status: 400 });
    const allCustomCriteria = (allCustomCriteriaRes.data ?? []) as CustomCriterionRow[];
    const playerCustomCriteria = allCustomCriteria.filter((row) => ["player", "both"].includes(String(row.snapshot_respondent)));
    const coachCustomCriteria = allCustomCriteria.filter((row) => ["coach", "both"].includes(String(row.snapshot_respondent)));
    const customCriterionIds = allCustomCriteria.map((row) => String(row.id));
    const allCustomResponsesRes = customCriterionIds.length
      ? await supabaseAdmin.from("club_event_evaluation_responses").select("event_criterion_id,respondent_role,value_json").eq("event_id", eventId).eq("player_id", effectivePlayerId).in("event_criterion_id", customCriterionIds)
      : ({ data: [], error: null } as const);
    if (allCustomResponsesRes.error) return NextResponse.json({ error: allCustomResponsesRes.error.message }, { status: 400 });
    const allCustomResponses = (allCustomResponsesRes.data ?? []) as CustomResponseRow[];
    const playerCustomResponses = allCustomResponses.filter((row) => row.respondent_role === "player");
    const coachCustomResponses = allCustomResponses.filter((row) => row.respondent_role === "coach");

    const feedbackCoachIds = ((feedbackRes.data ?? []) as Array<{ coach_id: string | null }>).map((row) => row.coach_id);
    const linkedCoachIds = ((eventCoachLinksRes.data ?? []) as Array<{ coach_id: string | null }>).map((row) => row.coach_id);
    const campHeadCoachId = String((campRes.data as { head_coach_user_id?: string | null } | null)?.head_coach_user_id ?? "").trim() || null;
    const coachIds = uniq([...linkedCoachIds, ...feedbackCoachIds, campHeadCoachId]);
    const coachProfilesRes = coachIds.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url,staff_function").in("id", coachIds)
      : ({ data: [], error: null } as const);
    if (coachProfilesRes.error) return NextResponse.json({ error: coachProfilesRes.error.message }, { status: 400 });

    const groupRoleRowsRes =
      event.group_id && coachIds.length > 0
        ? await supabaseAdmin
            .from("coach_group_coaches")
            .select("coach_user_id,is_head")
            .eq("group_id", event.group_id)
            .in("coach_user_id", coachIds)
        : ({ data: [], error: null } as const);
    if (groupRoleRowsRes.error) return NextResponse.json({ error: groupRoleRowsRes.error.message }, { status: 400 });

    const commonStructureRes =
      (playerStructureRes.data ?? []).length > 0
        ? ({ data: [], error: null } as const)
        : await supabaseAdmin
            .from("club_event_structure_items")
            .select("category,minutes,note,position")
            .eq("event_id", eventId)
            .order("position", { ascending: true })
            .order("created_at", { ascending: true });
    if (commonStructureRes.error) return NextResponse.json({ error: commonStructureRes.error.message }, { status: 400 });

    const coachProfileById = new Map<string, { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; staff_function: string | null }>();
    ((coachProfilesRes.data ?? []) as CoachProfileRow[]).forEach((profile) => {
      coachProfileById.set(String(profile.id ?? "").trim(), {
        id: String(profile.id ?? "").trim(),
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        avatar_url: profile.avatar_url ?? null,
        staff_function: profile.staff_function ?? null,
      });
    });

    const isHeadById: Record<string, boolean> = {};
    if (campHeadCoachId) isHeadById[campHeadCoachId] = true;
    ((groupRoleRowsRes.data ?? []) as GroupCoachRow[]).forEach((row) => {
      const coachUserId = String(row.coach_user_id ?? "").trim();
      if (!coachUserId) return;
      if (Boolean(row.is_head)) isHeadById[coachUserId] = true;
      else if (isHeadById[coachUserId] === undefined) isHeadById[coachUserId] = false;
    });
    const anyHead = coachIds.some((id) => Boolean(isHeadById[id]));
    if (!anyHead && coachIds[0]) isHeadById[coachIds[0]] = true;

    const assignedCoaches = coachIds
      .map((coachId) => {
        const profile = coachProfileById.get(coachId);
        return {
          id: coachId,
          first_name: profile?.first_name ?? null,
          last_name: profile?.last_name ?? null,
          avatar_url: profile?.avatar_url ?? null,
          label: nameOf(profile?.first_name ?? null, profile?.last_name ?? null),
          isHead: Boolean(isHeadById[coachId]),
          staffFunction: String(profile?.staff_function ?? "").trim() || null,
        };
      })
      .sort((a, b) => {
        const headDiff = Number(b.isHead) - Number(a.isHead);
        if (headDiff !== 0) return headDiff;
        return a.label.localeCompare(b.label, "fr");
      });

    return NextResponse.json({
      event,
      groupName: String((groupRes.data as { name?: string | null } | null)?.name ?? ""),
      clubName: String((clubRes.data as { name?: string | null } | null)?.name ?? ""),
      campId: campId || null,
      campTitle: String((campRes.data as { title?: string | null } | null)?.title ?? event.title ?? "").trim() || null,
      campDayIndex: typeof (campDayRes.data as { day_index?: number | null } | null)?.day_index === "number"
        ? Number((campDayRes.data as { day_index?: number | null }).day_index)
        : null,
      assignedCoaches,
      coachFeedback: feedbackRes.data ?? [],
      coachProfiles: coachProfilesRes.data ?? [],
      plannedStructureItems:
        (playerStructureRes.data ?? []).length > 0 ? playerStructureRes.data ?? [] : commonStructureRes.data ?? [],
      customEvaluationCriteria: playerCustomCriteria,
      customEvaluationResponses: playerCustomResponses,
      customCoachEvaluationCriteria: coachCustomCriteria,
      customCoachEvaluationResponses: coachCustomResponses,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
