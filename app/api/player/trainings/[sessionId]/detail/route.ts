import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { createRequestTiming } from "@/lib/server/requestTiming";

export async function GET(req: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const timing = createRequestTiming();
  try {
    const { sessionId } = await context.params;
    const access = await timing.measure("access", () => resolveAuthenticatedPlayerAccess({
      accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: new URL(req.url).searchParams.get("child_id"),
      mode: "view",
    }));
    const db = access.supabaseAdmin;
    // Authorize ownership and organization before reading dependent records.
    const session = await timing.measure("session", () => db.from("training_sessions")
      .select("id,user_id,start_at,location_text,session_type,club_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,club_event_id")
      .eq("id", sessionId).eq("user_id", access.subjectPlayerId)
      .or(personalOrOrganizationFilter("club_id", access.organizationIds)).maybeSingle());
    if (session.error) throw session.error;
    if (!session.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [items, performance, camp, club, attendance] = await timing.measure("details", () => Promise.all([
      db.from("training_session_items").select("category,minutes,note").eq("session_id", sessionId).order("created_at"),
      db.from("club_members").select("id").eq("user_id", access.subjectPlayerId).eq("role", "player")
        .eq("is_active", true).eq("is_performance", true).in("club_id", access.organizationIds).limit(1),
      db.from("player_camp_days").select("session_id").eq("session_id", sessionId).limit(1),
      session.data.club_id ? db.from("organizations").select("name").eq("id", session.data.club_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      session.data.club_event_id ? db.from("club_event_attendees").select("status").eq("event_id", session.data.club_event_id)
        .eq("player_id", access.subjectPlayerId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]));
    for (const result of [items, performance, camp, club, attendance]) if (result.error) throw result.error;
    return NextResponse.json({ session: session.data, items: items.data ?? [], playerId: access.subjectPlayerId,
      canEdit: access.permissions.edit, performanceEnabled: Boolean(performance.data?.length), isCampDay: Boolean(camp.data?.length),
      clubName: club.data?.name ?? "", attendance: attendance.data?.status ?? null,
    }, { headers: { "Cache-Control": "private, no-store", ...timing.headers() } });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load training" }, { status: playerAccessErrorStatus(error),
      headers: { "Cache-Control": "private, no-store", ...timing.headers() } });
  }
}
