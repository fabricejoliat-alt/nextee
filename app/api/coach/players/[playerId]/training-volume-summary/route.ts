import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { resolveCoachPlayerAccess } from "@/app/api/coach/players/_access";

type TrainingScope = "all" | "mine_club";

type TrainingSessionRow = {
  id: string;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  coach_user_id: string | null;
};

type TrainingItemRow = {
  minutes: number | null;
};

type ClubEventRow = {
  duration_minutes: number | null;
  starts_at: string | null;
  ends_at: string | null;
};

type PerformanceSummaryArgs = {
  supabaseAdmin: any;
  playerId: string;
  coachId: string;
  sharedClubIds: string[];
  scope: TrainingScope;
  from: string | null;
  to: string | null;
};

type NonPerformanceSummaryArgs = {
  supabaseAdmin: any;
  playerId: string;
  sharedClubIds: string[];
  scope: TrainingScope;
  from: string | null;
  to: string | null;
};

function startOfDayISO(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function nextDayStartISO(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function parseScope(value: string): TrainingScope {
  return value === "mine_club" ? "mine_club" : "all";
}

function sumClubEventMinutes(rows: ClubEventRow[]) {
  return rows.reduce((sum, row) => {
    const mins = Number(row.duration_minutes ?? 0);
    if (Number.isFinite(mins) && mins > 0) return sum + mins;
    if (row.starts_at && row.ends_at) {
      const diff = Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
      return sum + (Number.isFinite(diff) && diff > 0 ? diff : 0);
    }
    return sum;
  }, 0);
}

async function loadPerformanceSummary(args: PerformanceSummaryArgs) {
  const { supabaseAdmin, playerId, coachId, sharedClubIds, scope, from, to } = args;

  let query = supabaseAdmin
    .from("training_sessions")
    .select("id,session_type,club_id,coach_user_id")
    .eq("user_id", playerId)
    .order("start_at", { ascending: true })
    .limit(2000);

  if (from) query = query.gte("start_at", startOfDayISO(from));
  if (to) query = query.lt("start_at", nextDayStartISO(to));

  const sessionsRes = await query;
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);

  let sessions = (sessionsRes.data ?? []) as TrainingSessionRow[];
  if (scope === "mine_club") {
    sessions = sessions.filter(
      (session) =>
        session.session_type === "club" &&
        !!session.club_id &&
        session.coach_user_id === coachId &&
        sharedClubIds.includes(session.club_id)
    );
  }

  const ids = sessions.map((session) => session.id);
  if (ids.length === 0) return { minutes: 0, count: 0 };

  const itemsRes = await supabaseAdmin
    .from("training_session_items")
    .select("minutes")
    .in("session_id", ids)
    .limit(10000);
  if (itemsRes.error) throw new Error(itemsRes.error.message);

  const minutes = ((itemsRes.data ?? []) as TrainingItemRow[]).reduce(
    (sum, item) => sum + (Number(item.minutes ?? 0) || 0),
    0
  );

  return { minutes, count: sessions.length };
}

async function loadNonPerformanceSummary(args: NonPerformanceSummaryArgs) {
  const { supabaseAdmin, playerId, sharedClubIds, scope, from, to } = args;

  const attendeeRes = await supabaseAdmin
    .from("club_event_attendees")
    .select("event_id")
    .eq("player_id", playerId)
    .eq("status", "present")
    .limit(5000);
  if (attendeeRes.error) throw new Error(attendeeRes.error.message);

  const attendeeEventIds = Array.from(
    new Set(
      ((attendeeRes.data ?? []) as Array<{ event_id: string | null }>)
        .map((row) => String(row.event_id ?? ""))
        .filter(Boolean)
    )
  );
  if (attendeeEventIds.length === 0) return { minutes: 0, count: 0 };

  let query = supabaseAdmin
    .from("club_events")
    .select("duration_minutes,starts_at,ends_at,club_id,status")
    .in("id", attendeeEventIds)
    .neq("status", "cancelled")
    .lt("starts_at", new Date().toISOString())
    .limit(5000);

  if (from) query = query.gte("starts_at", startOfDayISO(from));
  if (to) query = query.lt("starts_at", nextDayStartISO(to));
  if (scope === "mine_club" && sharedClubIds.length > 0) query = query.in("club_id", sharedClubIds);

  const eventsRes = await query;
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const rows = (eventsRes.data ?? []) as Array<ClubEventRow & { club_id: string | null; status: string | null }>;
  return { minutes: sumClubEventMinutes(rows), count: rows.length };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const scope = parseScope(String(req.nextUrl.searchParams.get("scope") ?? ""));
    const from = String(req.nextUrl.searchParams.get("from") ?? "").trim() || null;
    const to = String(req.nextUrl.searchParams.get("to") ?? "").trim() || null;
    const prevFrom = String(req.nextUrl.searchParams.get("prev_from") ?? "").trim() || null;
    const prevTo = String(req.nextUrl.searchParams.get("prev_to") ?? "").trim() || null;

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const access = await resolveCoachPlayerAccess(supabaseAdmin, callerId, playerId);
    if (access.sharedClubIds.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const perfRes = await supabaseAdmin
      .from("club_members")
      .select("id")
      .eq("user_id", playerId)
      .eq("role", "player")
      .eq("is_active", true)
      .eq("is_performance", true)
      .limit(1);
    if (perfRes.error) return NextResponse.json({ error: perfRes.error.message }, { status: 400 });

    const isPerformanceEnabled = (perfRes.data ?? []).length > 0;

    const baseArgs = {
      supabaseAdmin,
      playerId,
      sharedClubIds: access.sharedClubIds,
      scope,
    };

    const [current, previous] = isPerformanceEnabled
      ? await Promise.all([
          loadPerformanceSummary({
            ...baseArgs,
            coachId: callerId,
            from,
            to,
          }),
          prevFrom && prevTo
            ? loadPerformanceSummary({
                ...baseArgs,
                coachId: callerId,
                from: prevFrom,
                to: prevTo,
              })
            : Promise.resolve({ minutes: 0, count: 0 }),
        ])
      : await Promise.all([
          loadNonPerformanceSummary({
            ...baseArgs,
            from,
            to,
          }),
          prevFrom && prevTo
            ? loadNonPerformanceSummary({
                ...baseArgs,
                from: prevFrom,
                to: prevTo,
              })
            : Promise.resolve({ minutes: 0, count: 0 }),
        ]);

    return NextResponse.json({
      is_performance_enabled: isPerformanceEnabled,
      current,
      previous,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
