import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCaller, isOrgStaffMember } from "@/app/api/messages/_lib";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

async function canCoachAccessEvent(supabaseAdmin: any, callerId: string, eventId: string, groupId: string, clubId: string) {
  if (clubId) {
    const staffAllowed = await isOrgStaffMember(supabaseAdmin, clubId, callerId);
    if (staffAllowed) return true;
  }

  const [headRes, assistantRes, assignedRes] = await Promise.all([
    supabaseAdmin.from("coach_groups").select("id").eq("id", groupId).eq("head_coach_user_id", callerId).maybeSingle(),
    supabaseAdmin.from("coach_group_coaches").select("id").eq("group_id", groupId).eq("coach_user_id", callerId).maybeSingle(),
    supabaseAdmin.from("club_event_coaches").select("event_id").eq("event_id", eventId).eq("coach_id", callerId).maybeSingle(),
  ]);

  if (headRes.error) throw new Error(headRes.error.message);
  if (assistantRes.error) throw new Error(assistantRes.error.message);
  if (assignedRes.error) throw new Error(assignedRes.error.message);

  return Boolean(headRes.data?.id || assistantRes.data?.id || assignedRes.data?.event_id);
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
    const allowed = await canCoachAccessEvent(supabaseAdmin, callerId, eventId, groupId, clubId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

    const attendeeIds = uniq((attendeeRes.data ?? []).map((row: any) => String(row.player_id ?? "").trim()));
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
      .select("id,file_name,coach_only,created_at,storage_path,uploaded_by")
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

    const linkedDocuments = (docsRes.data ?? []).map((doc: any) => ({
      id: String(doc.id ?? ""),
      file_name: String(doc.file_name ?? "document"),
      coach_only: Boolean(doc.coach_only),
      created_at: String(doc.created_at ?? ""),
      public_url: supabaseAdmin.storage.from("marketplace").getPublicUrl(String(doc.storage_path ?? "")).data.publicUrl,
      uploaded_by_name: uploaderNameById.get(String(doc.uploaded_by ?? "")) ?? null,
    }));

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
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
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

    const body = await req.json().catch(() => ({}));
    const attendanceStatus = String(body?.attendance_status ?? "").trim();
    const engagement = body?.engagement == null ? null : Number(body.engagement);
    const attitude = body?.attitude == null ? null : Number(body.attitude);
    const performance = body?.performance == null ? null : Number(body.performance);
    const privateNote = String(body?.private_note ?? "").trim() || null;
    const playerNote = String(body?.player_note ?? "").trim() || null;
    const visibleToPlayer = Boolean(body?.visible_to_player);

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { callerId } = await requireCaller(accessToken);

    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,group_id,club_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data?.id) return NextResponse.json({ error: "Training not found." }, { status: 404 });

    const event = eventRes.data as any;
    const allowed = await canCoachAccessEvent(
      supabaseAdmin,
      callerId,
      eventId,
      String(event.group_id ?? "").trim(),
      String(event.club_id ?? "").trim()
    );
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (attendanceStatus) {
      if (!["expected", "present", "absent", "excused"].includes(attendanceStatus)) {
        return NextResponse.json({ error: "Invalid attendance_status" }, { status: 400 });
      }
      const attRes = await supabaseAdmin
        .from("club_event_attendees")
        .update({ status: attendanceStatus })
        .eq("event_id", eventId)
        .eq("player_id", playerId);
      if (attRes.error) return NextResponse.json({ error: attRes.error.message }, { status: 400 });
    }

    const feedbackPayload = {
      event_id: eventId,
      player_id: playerId,
      coach_id: callerId,
      engagement: attendanceStatus === "absent" ? null : engagement,
      attitude: attendanceStatus === "absent" ? null : attitude,
      performance: attendanceStatus === "absent" ? null : performance,
      visible_to_player: attendanceStatus === "absent" ? false : visibleToPlayer,
      private_note: privateNote,
      player_note: attendanceStatus === "absent" ? null : playerNote,
    };

    const deleteRes = await supabaseAdmin
      .from("club_event_coach_feedback")
      .delete()
      .eq("event_id", eventId)
      .eq("player_id", playerId);
    if (deleteRes.error) return NextResponse.json({ error: deleteRes.error.message }, { status: 400 });

    const insertRes = await supabaseAdmin
      .from("club_event_coach_feedback")
      .insert(feedbackPayload)
      .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
      .single();
    if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 400 });

    return NextResponse.json({
      feedback: insertRes.data,
      attendanceStatus: attendanceStatus || null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
