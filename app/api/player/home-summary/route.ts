import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenFromRequest, playerAccessErrorStatus, resolveAuthenticatedPlayerAccess } from "@/app/api/player/access";
import { requestedOrganizationId } from "@/lib/organizationPolicy";
import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { canReadPlayerHistory } from "@/lib/server/personalHistoryAccess";
import { legalNoStore } from "@/lib/server/legalAccess";
import { createRequestTiming } from "@/lib/server/requestTiming";
import { summarizePlayerHome, type HomeHistoryAttendance, type HomeHistoryEvent, type HomeHistoryItem, type HomeHistorySession } from "@/lib/playerHomeSummary";

// The full history stays on the server. Pagination avoids silently dropping old
// unevaluated sessions when a player's history exceeds PostgREST's row limit.
async function readRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await query(start, start + 499);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

async function readRelated<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    rows.push(...await readRows<T>((from, to) => query(ids.slice(offset, offset + 100), from, to)));
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const timing = createRequestTiming();
  try {
    const url = new URL(req.url);
    const monthStart = url.searchParams.get("from") ?? "", monthEnd = url.searchParams.get("to") ?? "";
    const previousMonthStart = url.searchParams.get("previous_from") ?? "";
    const from = Date.parse(monthStart), to = Date.parse(monthEnd), previous = Date.parse(previousMonthStart);
    if (![from, to, previous].every(Number.isFinite) || to <= from || to - from > 32 * 86_400_000
      || previous >= from || from - previous > 32 * 86_400_000) {
      return NextResponse.json({ error: "Invalid month range" }, { status: 400, headers: legalNoStore });
    }
    const access = await timing.measure("access", () => resolveAuthenticatedPlayerAccess({ accessToken: bearerTokenFromRequest(req),
      requestedPlayerId: url.searchParams.get("child_id"), requestedOrganizationId: requestedOrganizationId(req.url), mode: "view" }));
    const db = access.supabaseAdmin, playerId = access.subjectPlayerId, orgIds = access.organizationIds;
    // An authorized affiliation alone is not sufficient for personal history:
    // retain the explicit player/roster/guardian/legal checks used elsewhere.
    const personalChecks = await timing.measure("personal_access", () => Promise.all(orgIds.map(id => canReadPlayerHistory(db, access.actorUserId, playerId, id))));
    const canReadPersonal = personalChecks.some(Boolean);
    const sessionScope = canReadPersonal ? personalOrOrganizationFilter("club_id", orgIds) : `club_id.in.(${orgIds.join(",")})`;
    const [sessions, attendees, targets, settings, performance] = await timing.measure("history", () => Promise.all([
      readRows<HomeHistorySession>((from, to) => db.from("training_sessions")
        .select("id,start_at,total_minutes,motivation,difficulty,satisfaction,session_type,club_event_id")
        .eq("user_id", playerId).or(sessionScope).order("id").range(from, to)),
      readRows<HomeHistoryAttendance>((from, to) => db.from("club_event_attendees").select("event_id,status")
        .eq("player_id", playerId).order("event_id").range(from, to)),
      db.from("training_volume_targets").select("id,organization_id,ftem_code,level_label,handicap_label,handicap_min,handicap_max,motivation_text,minutes_offseason,minutes_inseason,sort_order")
        .in("organization_id", orgIds).order("sort_order").order("ftem_code"),
      db.from("training_volume_settings").select("organization_id,season_months,offseason_months").in("organization_id", orgIds),
      db.from("club_members").select("id").eq("user_id", playerId).eq("role", "player")
        .eq("is_active", true).eq("is_performance", true).in("club_id", orgIds).limit(1),
    ]));
    for (const result of [targets, settings, performance]) if (result.error) throw result.error;
    const sessionIds = sessions.map(session => session.id);
    const eventIds = [...new Set([...attendees.map(row => row.event_id), ...sessions.map(session => session.club_event_id)].filter((id): id is string => Boolean(id)))];
    const [items, events] = await timing.measure("details", () => Promise.all([
      readRelated<HomeHistoryItem>(sessionIds, (ids, from, to) => db.from("training_session_items")
        .select("id,session_id,category,minutes").in("session_id", ids).order("id").range(from, to)),
      readRelated<HomeHistoryEvent>(eventIds, (ids, from, to) => db.from("club_events")
        .select("id,event_type,title,starts_at,ends_at,duration_minutes,status,requires_evaluation")
        .in("id", ids).in("club_id", orgIds).order("id").range(from, to)),
    ]));
    const summary = summarizePlayerHome({ sessions, attendees, items, events,
      performanceEnabled: Boolean(performance.data?.length), monthStart, monthEnd, previousMonthStart, now: new Date().toISOString() });
    const volumeConfigs = orgIds.map(organizationId => ({ organizationId,
      rows: (targets.data ?? []).filter(row => row.organization_id === organizationId),
      settings: (settings.data ?? []).find(row => row.organization_id === organizationId) ?? null }));
    return NextResponse.json({ ...summary, volumeConfigs }, { headers: { ...legalNoStore, ...timing.headers() } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" },
      { status: playerAccessErrorStatus(error), headers: { ...legalNoStore, ...timing.headers() } });
  }
}
