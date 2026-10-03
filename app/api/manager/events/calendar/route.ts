import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { coachRows } from "@/lib/server/coachRows";

function mustEnv(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
const unique = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
type CalendarEvent = { id: string; group_id: string | null; club_id: string; starts_at: string; ends_at: string | null };
type Group = { id: string; name: string | null; is_active: boolean | null; head_coach_user_id: string | null };
type Attendee = { event_id: string; player_id: string };
type Assignment = { event_id: string; coach_id: string };
type Profile = { id: string; first_name: string | null; last_name: string | null };
async function byIds<T>(db: SupabaseClient, table: string, columns: string, key: string, ids: string[], ordering: string[]) {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 150) rows.push(...await coachRows<T>((from, to) => {
    let query = db.from(table).select(columns).in(key, ids.slice(offset, offset + 150));
    for (const column of ordering) query = query.order(column);
    return query.range(from, to);
  }));
  return rows;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const db = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: caller, error: authError } = await db.auth.getUser(accessToken);
    if (authError || !caller.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const params = new URL(req.url).searchParams;
    const now = new Date();
    const from = params.get("from") ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const to = params.get("to") ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1).toISOString();
    if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) > Date.parse(to) || Date.parse(to) - Date.parse(from) > 45 * 86400000) {
      return NextResponse.json({ error: "Invalid calendar period (maximum 45 days)" }, { status: 400 });
    }
    const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
    const memberships = await coachRows<{ club_id: string }>((start, end) => db.from("club_members").select("club_id").eq("user_id", caller.user!.id).eq("role", "manager").eq("is_active", true).order("club_id").range(start, end));
    const clubIds = unique(memberships.map((row) => row.club_id));
    if (!clubIds.length) return NextResponse.json({ events: [], groups: [], clubs: [], attendees: [], event_coaches: [], players: [], stats: { completed: 0, planned: 0, total: 0 } });
    const columns = "id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,competition_level,competition_category,external_registration_url,competition_note";
    const [starting, overlapping, groups, clubs, activePlayers, pastCount, futureCount] = await Promise.all([
      coachRows<CalendarEvent>((start, end) => db.from("club_events").select(columns).in("club_id", clubIds).gte("starts_at", fromIso).lte("starts_at", toIso).order("starts_at").order("id").range(start, end)),
      coachRows<CalendarEvent>((start, end) => db.from("club_events").select(columns).in("club_id", clubIds).lt("starts_at", fromIso).gte("ends_at", fromIso).order("starts_at").order("id").range(start, end)),
      byIds<Group>(db, "coach_groups", "id,name,is_active,head_coach_user_id", "club_id", clubIds, ["id"]),
      byIds<{ id: string; name: string | null }>(db, "clubs", "id,name", "id", clubIds, ["id"]),
      coachRows<{ user_id: string }>((start, end) => db.from("club_members").select("user_id").in("club_id", clubIds).eq("role", "player").eq("is_active", true).order("club_id").order("user_id").range(start, end)),
      db.from("club_events").select("id", { head: true, count: "exact" }).in("club_id", clubIds).eq("status", "scheduled").lte("starts_at", now.toISOString()),
      db.from("club_events").select("id", { head: true, count: "exact" }).in("club_id", clubIds).eq("status", "scheduled").gt("starts_at", now.toISOString()),
    ]);
    if (pastCount.error || futureCount.error) throw new Error(pastCount.error?.message ?? futureCount.error!.message);
    const events = [...new Map([...starting, ...overlapping].map((event) => [event.id, event])).values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
    const eventIds = events.map((event) => event.id);
    const [attendees, assignments] = await Promise.all([
      byIds<Attendee>(db, "club_event_attendees", "event_id,player_id", "event_id", eventIds, ["event_id", "player_id"]),
      byIds<Assignment>(db, "club_event_coaches", "event_id,coach_id", "event_id", eventIds, ["event_id", "coach_id"]),
    ]);
    const playerIds = unique([...activePlayers.map((row) => row.user_id), ...attendees.map((row) => row.player_id)]);
    const profileIds = unique([...playerIds, ...groups.map((group) => group.head_coach_user_id), ...assignments.map((row) => row.coach_id)]);
    const profiles = await byIds<Profile>(db, "profiles", "id,first_name,last_name", "id", profileIds, ["id"]);
    const names = new Map(profiles.map((row) => [row.id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
    return NextResponse.json({ events, clubs, attendees,
      groups: groups.map((group) => ({ ...group, is_archived: group.name?.startsWith("__ARCHIVE_") ?? false, head_coach_name: names.get(group.head_coach_user_id ?? "") ?? null })),
      event_coaches: assignments.map((row) => ({ ...row, coach_name: names.get(row.coach_id) ?? null })),
      players: playerIds.map((id) => ({ id, name: names.get(id) || id })),
      stats: { completed: pastCount.count ?? 0, planned: futureCount.count ?? 0, total: (pastCount.count ?? 0) + (futureCount.count ?? 0) },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Server error" }, { status: 500 }); }
}
