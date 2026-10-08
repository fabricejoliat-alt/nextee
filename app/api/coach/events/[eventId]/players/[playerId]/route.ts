import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCaller } from "@/app/api/messages/_lib";
import { authorizedCoachPlayers, canCoachAccessEvent, requireCoachEventPlayer } from "@/lib/coachAccess";
import { signPlayerDocumentRows } from "@/lib/playerDocumentStorage";
import { requestedOrganizationId } from "@/lib/organizationPolicy";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ eventId: string; playerId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { eventId: rawEventId, playerId: rawPlayerId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    const playerId = String(rawPlayerId ?? "").trim();
    if (!eventId || !playerId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { callerId } = await requireCaller(accessToken);

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,club_id,event_type,starts_at,duration_minutes,location_text,series_id,status")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data?.id) return NextResponse.json({ error: "Training not found." }, { status: 404 });

    const event = eventRes.data as any;
    const groupId = String(event.group_id ?? "").trim();
    const clubId = String(event.club_id ?? "").trim();
    const selectedOrganization = requestedOrganizationId(req.url);
    if (selectedOrganization && selectedOrganization !== clubId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const allowed = await canCoachAccessEvent(supabaseAdmin, callerId, eventId, groupId, clubId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await requireCoachEventPlayer(supabaseAdmin, eventId, playerId, callerId, clubId);

    const [playerRes, eventStructureRes, playerStructureRes, sessionRes, attendeeRes, feedbackRowsRes, attendanceRes, playerFeedbackRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,handicap,avatar_url")
        .eq("id", playerId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_event_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("club_event_player_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("training_sessions")
        .select("id")
        .eq("user_id", playerId)
        .eq("club_event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseAdmin.from("club_event_attendees").select("player_id").eq("event_id", eventId),
      supabaseAdmin
        .from("club_event_coach_feedback")
        .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .limit(10),
      supabaseAdmin
        .from("club_event_attendees")
        .select("status")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_event_player_feedback")
        .select("event_id,player_id,motivation,difficulty,satisfaction,player_note,submitted_at")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(1),
    ]);

    if (playerRes.error) return NextResponse.json({ error: playerRes.error.message }, { status: 400 });
    if (!playerRes.data?.id) return NextResponse.json({ error: "Joueur introuvable." }, { status: 404 });
    if (eventStructureRes.error) return NextResponse.json({ error: eventStructureRes.error.message }, { status: 400 });
    if (playerStructureRes.error) return NextResponse.json({ error: playerStructureRes.error.message }, { status: 400 });
    if (sessionRes.error) return NextResponse.json({ error: sessionRes.error.message }, { status: 400 });
    if (attendeeRes.error) return NextResponse.json({ error: attendeeRes.error.message }, { status: 400 });
    if (feedbackRowsRes.error) return NextResponse.json({ error: feedbackRowsRes.error.message }, { status: 400 });
    if (attendanceRes.error) return NextResponse.json({ error: attendanceRes.error.message }, { status: 400 });
    if (playerFeedbackRes.error) return NextResponse.json({ error: playerFeedbackRes.error.message }, { status: 400 });

    const customCriteriaRes = await supabaseAdmin.from("club_event_evaluation_criteria").select("*").eq("event_id", eventId).eq("is_enabled", true).in("snapshot_respondent", ["coach", "both"]).order("position");
    if (customCriteriaRes.error) return NextResponse.json({ error: customCriteriaRes.error.message }, { status: 400 });
    const customIds = (customCriteriaRes.data ?? []).map((row: any) => String(row.id));
    const customResponsesRes = customIds.length
      ? await supabaseAdmin.from("club_event_evaluation_responses").select("event_criterion_id,value_json").eq("event_id", eventId).eq("player_id", playerId).eq("respondent_role", "coach").in("event_criterion_id", customIds)
      : ({ data: [], error: null } as const);
    if (customResponsesRes.error) return NextResponse.json({ error: customResponsesRes.error.message }, { status: 400 });

    const feedbackRows = (feedbackRowsRes.data ?? []) as Array<{
      event_id: string;
      player_id: string;
      coach_id: string | null;
      engagement: number | null;
      attitude: number | null;
      performance: number | null;
      visible_to_player: boolean;
      private_note: string | null;
      player_note: string | null;
    }>;
    const sharedFeedback =
      feedbackRows.find((row) => String(row.coach_id ?? "").trim() === callerId) ??
      feedbackRows[0] ??
      null;

    let feedbackCoach: { id: string; first_name: string | null; last_name: string | null } | null = null;
    if (sharedFeedback?.coach_id) {
      const feedbackCoachRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name")
        .eq("id", String(sharedFeedback.coach_id))
        .maybeSingle();
      if (feedbackCoachRes.error) return NextResponse.json({ error: feedbackCoachRes.error.message }, { status: 400 });
      feedbackCoach = (feedbackCoachRes.data as any) ?? null;
    }

    const session = ((sessionRes.data?.[0] as any) ?? null);
    const sessionId = String(session?.id ?? "").trim();
    let sessionItems: any[] = [];
    if (sessionId) {
      const sessionItemsRes = await supabaseAdmin
        .from("training_session_items")
        .select("id,session_id,category,minutes,note,other_detail,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (sessionItemsRes.error) return NextResponse.json({ error: sessionItemsRes.error.message }, { status: 400 });
      sessionItems = sessionItemsRes.data ?? [];
    }

    const candidateAttendeeIds = uniq((attendeeRes.data ?? []).map((row: any) => String(row.player_id ?? "").trim()));
    const authorized = await authorizedCoachPlayers(supabaseAdmin, callerId, clubId, candidateAttendeeIds, eventId);
    const attendeeIds = candidateAttendeeIds.filter(id => authorized.has(id));
    let orderedPlayerIds = [playerId];
    if (attendeeIds.length > 0) {
      const attendeeProfilesRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name")
        .in("id", attendeeIds);
      if (attendeeProfilesRes.error) return NextResponse.json({ error: attendeeProfilesRes.error.message }, { status: 400 });

      const byId = new Map(
        ((attendeeProfilesRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map((p) => [p.id, p])
      );
      const sorted = [...attendeeIds].sort((a, b) => {
        const pa = byId.get(a);
        const pb = byId.get(b);
        const la = (pa?.last_name ?? "").toLocaleLowerCase("fr-CH");
        const lb = (pb?.last_name ?? "").toLocaleLowerCase("fr-CH");
        if (la !== lb) return la.localeCompare(lb, "fr-CH");
        const fa = (pa?.first_name ?? "").toLocaleLowerCase("fr-CH");
        const fb = (pb?.first_name ?? "").toLocaleLowerCase("fr-CH");
        if (fa !== fb) return fa.localeCompare(fb, "fr-CH");
        return a.localeCompare(b);
      });
      orderedPlayerIds = sorted.includes(playerId) ? sorted : [...sorted, playerId];
    }

    const docsRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,file_name,coach_only,created_at,storage_bucket,storage_path,uploaded_by")
      .eq("organization_id", clubId)
      .eq("player_id", playerId)
      .eq("club_event_id", eventId)
      .order("created_at", { ascending: false });
    if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 400 });

    const uploaderIds = uniq((docsRes.data ?? []).map((row: any) => String(row.uploaded_by ?? "").trim()));
    const uploaderNameById = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const uploaderRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", uploaderIds);
      if (uploaderRes.error) return NextResponse.json({ error: uploaderRes.error.message }, { status: 400 });
      (uploaderRes.data ?? []).forEach((profile: any) => {
        const id = String(profile.id ?? "").trim();
        if (!id) return;
        const full = `${String(profile.first_name ?? "").trim()} ${String(profile.last_name ?? "").trim()}`.trim();
        uploaderNameById.set(id, full || String(profile.username ?? "").trim() || id.slice(0, 8));
      });
    }

    const linkedDocumentRows = (docsRes.data ?? []).map((doc: any) => ({
      id: String(doc.id ?? ""),
      file_name: String(doc.file_name ?? "document"),
      coach_only: Boolean(doc.coach_only),
      created_at: String(doc.created_at ?? ""),
      storage_bucket: String(doc.storage_bucket ?? "marketplace"),
      storage_path: String(doc.storage_path ?? ""),
      uploaded_by_name: uploaderNameById.get(String(doc.uploaded_by ?? "")) ?? null,
    }));
    const linkedDocuments = await signPlayerDocumentRows(supabaseAdmin, linkedDocumentRows);

    return NextResponse.json({
      meId: callerId,
      event,
      player: playerRes.data,
      eventStructureItems: eventStructureRes.data ?? [],
      playerPlannedStructureItems: playerStructureRes.data ?? [],
      playerFeedback: (playerFeedbackRes.data?.[0] as any) ?? null,
      session,
      sessionItems,
      orderedPlayerIds,
      feedback: sharedFeedback,
      feedbackLocked: false,
      lockedByCoach: feedbackCoach && String(feedbackCoach.id ?? "").trim() !== callerId ? feedbackCoach : null,
      feedbackCoach,
      attendanceStatus: String((attendanceRes.data as any)?.status ?? "present"),
      linkedDocuments,
      customEvaluationCriteria: customCriteriaRes.data ?? [],
      customEvaluationResponses: customResponsesRes.data ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: message === "forbidden" ? 403 : message === "unknown_attendee" ? 404 : 500 });
  }
}

/** Retired: all Coach evaluations must use the validated, transactional guided flow. */
export async function POST() {
  return NextResponse.json(
    { error: "This evaluation endpoint has been retired. Use the guided debrief.", code: "guided_evaluation_required" },
    { status: 410 }
  );
}
