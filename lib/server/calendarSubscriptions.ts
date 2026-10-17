import { randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { loadPlayerActorAuthorization, resolvePlayerAccessContext } from "@/app/api/player/access";
import { resolveCoachAssignments } from "@/lib/coachAccess";
import { initialPasswordRequired } from "@/lib/adminSecurity";
import { personalOrOrganizationFilter } from "@/lib/personalHistoryScope";
import { calendarLocale, calendarUrls, type CalendarEntry, type CalendarLocale, type CalendarScope } from "@/lib/calendarSubscription";
import { loadLegalGateStatus } from "@/lib/server/legalRequirements";
import { readAllRows, readRelatedRows } from "@/lib/server/paginatedRead";

export class CalendarAccessError extends Error {
  constructor(public status: number) { super("Calendar unavailable"); }
}
export const calendarHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
export const calendarTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Subscription = { id: string; user_id: string; kind: CalendarScope["kind"]; scope_key: string; player_id: string | null; organization_id: string | null; token: string; locale: CalendarLocale };

export function parseCalendarScope(params: URLSearchParams): CalendarScope {
  const kind = params.get("kind");
  const playerId = params.get("player_id") || undefined, organizationId = params.get("organization_id") || undefined;
  if (!["player", "coach", "manager"].includes(kind ?? "") || (playerId && !uuid.test(playerId)) || (organizationId && !uuid.test(organizationId))
    || (kind === "player" && (!playerId || organizationId)) || (kind !== "player" && playerId) || (kind === "manager" && organizationId)) throw new CalendarAccessError(400);
  return { kind: kind as CalendarScope["kind"], playerId, organizationId };
}
export function subscriptionScope(row: Subscription): CalendarScope {
  return { kind: row.kind, playerId: row.player_id ?? undefined, organizationId: row.organization_id ?? undefined };
}
export function assertCalendarAccount(user: User | null) {
  const bannedUntil = (user as (User & { banned_until?: string }) | null)?.banned_until;
  if (!user || initialPasswordRequired(user) || (bannedUntil && Date.parse(bannedUntil) > Date.now())) throw new CalendarAccessError(403);
}

/** Re-run live membership, guardian, assignment and legal gates on every feed poll. */
export async function authorizeCalendar(db: SupabaseClient, actorId: string, scope: CalendarScope) {
  const legal = await loadLegalGateStatus(db, actorId, scope.organizationId);
  if (legal.missing.length) throw new CalendarAccessError(403);
  if (scope.kind === "player") {
    const actor = await loadPlayerActorAuthorization(db, actorId);
    const access = await resolvePlayerAccessContext({ ...actor, requestedPlayerId: scope.playerId, mode: "view" });
    return { clubIds: access.organizationIds, groupIds: [] as string[], eventIds: [] as string[] };
  }
  if (scope.kind === "coach") {
    const access = await resolveCoachAssignments(db, actorId, scope.organizationId);
    if (!access.clubIds.length) throw new CalendarAccessError(403);
    return { clubIds: access.clubIds, groupIds: access.groups.map(group => group.id), eventIds: access.eventIds };
  }
  const memberships = await readAllRows<{ club_id: string }>((from, to) => db.from("club_members").select("club_id")
    .eq("user_id", actorId).eq("role", "manager").eq("is_active", true).order("club_id").range(from, to));
  const checked = await Promise.all([...new Set(memberships.map(row => row.club_id))].map(async id => {
    const result = await db.rpc("organization_actor_legal_ready", { p_org: id, p_actor: actorId });
    if (result.error) throw result.error;
    return result.data === true ? id : null;
  }));
  const clubIds = checked.filter((id): id is string => Boolean(id));
  if (!clubIds.length) throw new CalendarAccessError(403);
  return { clubIds, groupIds: [] as string[], eventIds: [] as string[] };
}

export function scopeKey(scope: CalendarScope) { return scope.playerId || scope.organizationId || "all"; }
export async function findSubscription(db: SupabaseClient, actorId: string, scope: CalendarScope) {
  const result = await db.from("calendar_subscriptions").select("*")
    .eq("user_id", actorId).eq("kind", scope.kind).eq("scope_key", scopeKey(scope)).maybeSingle();
  if (result.error) throw result.error;
  return result.data as Subscription | null;
}
export async function createSubscription(db: SupabaseClient, actorId: string, scope: CalendarScope, locale: unknown) {
  const existing = await findSubscription(db, actorId, scope);
  if (existing) return existing;
  const result = await db.from("calendar_subscriptions").insert({ user_id: actorId, kind: scope.kind, scope_key: scopeKey(scope),
    player_id: scope.playerId ?? null, organization_id: scope.organizationId ?? null, locale: calendarLocale(locale), token: randomBytes(32).toString("base64url") }).select("*").single();
  if (result.error?.code === "23505") {
    // Concurrent clicks reuse the existing subscription; never break another device's URL.
    const concurrent = await findSubscription(db, actorId, scope);
    if (concurrent) return concurrent;
  }
  if (result.error || !result.data) throw result.error ?? new Error("Calendar creation failed");
  return result.data as Subscription;
}
export function publicSubscription(row: Subscription | null, origin: string) {
  return row ? { ...calendarUrls(origin, row.token) } : null;
}

type ClubEvent = { id: string; club_id: string; group_id: string | null; title: string | null; event_type: string;
  starts_at: string; ends_at: string | null; duration_minutes: number | null; location_text: string | null; status: string };
type PersonalEvent = { id: string; title: string; event_type: string; starts_at: string; ends_at: string; location_text: string | null; status: string };
type Session = { id: string; start_at: string; total_minutes: number | null; session_type: string; location_text: string | null };
type CampDay = { session_id: string; camp_id: string; starts_at: string | null; ends_at: string | null; location_text: string | null };
const eventColumns = "id,club_id,group_id,title,event_type,starts_at,ends_at,duration_minutes,location_text,status";
const labels: Record<string, [string, string, string, string]> = {
  training: ["Entraînement", "Training", "Training", "Allenamento"], competition: ["Compétition", "Competition", "Wettkampf", "Competizione"],
  camp: ["Stage", "Camp", "Camp", "Stage"], session: ["Réunion", "Meeting", "Besprechung", "Riunione"],
  event: ["Activité", "Activity", "Aktivität", "Attività"], interclub: ["Interclub", "Interclub", "Interclub", "Interclub"],
  private: ["Cours privé", "Private lesson", "Privatlektion", "Lezione privata"], individual: ["Entraînement individuel", "Individual training", "Individuelles Training", "Allenamento individuale"],
  camp_present: ["Participe", "Participating", "Nimmt teil", "Partecipa"],
  camp_absent: ["Ne participe pas", "Not participating", "Nimmt nicht teil", "Non partecipa"],
  camp_pending: ["Participation à confirmer", "Participation to be confirmed", "Teilnahme noch zu bestätigen", "Partecipazione da confermare"],
  camp_not_registered: ["Non inscrit à cette journée", "Not registered for this day", "Für diesen Tag nicht angemeldet", "Non iscritto a questa giornata"],
};
function label(type: string, locale: CalendarLocale) { return (labels[type] ?? labels.event)[["fr", "en", "de", "it"].indexOf(locale)]; }

export async function loadCalendarEntries(db: SupabaseClient, row: Subscription, origin: string) {
  const scope = subscriptionScope(row);
  const access = await authorizeCalendar(db, row.user_id, scope);
  const locale = calendarLocale(row.locale);
  const entries: CalendarEntry[] = [];
  let events: ClubEvent[] = [];
  let playerName = "";
  const campParticipation = new Map<string, { title: string; participating: boolean }>();
  const appUrl = (path: string) => new URL(path, origin).href;
  if (scope.kind === "player") {
    const playerId = scope.playerId!;
    const [attendees, personal, sessions, profile] = await Promise.all([
      readAllRows<{ event_id: string; status: string }>((from, to) => db.from("club_event_attendees").select("event_id,status")
        .eq("player_id", playerId).order("event_id").range(from, to)),
      readAllRows<PersonalEvent>((from, to) => db.from("player_activity_events").select("id,title,event_type,starts_at,ends_at,location_text,status")
        .eq("user_id", playerId).or(personalOrOrganizationFilter("organization_id", access.clubIds)).order("id").range(from, to)),
      readAllRows<Session>((from, to) => db.from("training_sessions").select("id,start_at,total_minutes,session_type,location_text")
        .eq("user_id", playerId).is("club_event_id", null).or(personalOrOrganizationFilter("club_id", access.clubIds)).order("id").range(from, to)),
      db.from("profiles").select("first_name").eq("id", playerId).maybeSingle(),
    ]);
    if (profile.error) throw profile.error;
    playerName = profile.data?.first_name?.trim() ?? "";
    const playerUrl = appUrl(`/player/golf/trainings?child_id=${playerId}`);
    const playerTitle = (title: string) => ["Golf", playerName, title].filter(Boolean).join(" · ");
    events = await readRelatedRows<ClubEvent>(attendees.map(item => item.event_id), (ids, from, to) => db.from("club_events").select(eventColumns)
      .in("id", ids).in("club_id", access.clubIds).order("id").range(from, to));
    // Export every camp day already visible to this player. Participation is
    // determined per day; registering for the camp is not attendance at every day.
    const campLinks = await readRelatedRows<{ event_id: string; camp_id: string }>(events.filter(e => e.event_type === "camp").map(e => e.id), (ids, from, to) =>
      db.from("club_camp_days").select("event_id,camp_id").in("event_id", ids).order("event_id").range(from, to));
    const campIds = [...new Set(campLinks.map(day => day.camp_id))];
    const [camps, registrations, personalCampDays] = await Promise.all([
      readRelatedRows<{ id: string; status: string }>(campIds, (ids, from, to) => db.from("club_camps").select("id,status").in("id", ids).order("id").range(from, to)),
      readRelatedRows<{ camp_id: string; registration_status: string }>(campIds, (ids, from, to) => db.from("club_camp_players").select("camp_id,registration_status")
        .eq("player_id", playerId).in("camp_id", ids).order("camp_id").range(from, to)),
      readRelatedRows<CampDay>(sessions.map(s => s.id), (ids, from, to) => db.from("player_camp_days").select("session_id,camp_id,starts_at,ends_at,location_text")
        .in("session_id", ids).order("session_id").range(from, to)),
    ]);
    const personalCamps = await readRelatedRows<{ id: string; title: string; status: string }>(personalCampDays.map(d => d.camp_id), (ids, from, to) =>
      db.from("player_camps").select("id,title,status").in("id", ids).eq("user_id", playerId)
        .or(personalOrOrganizationFilter("organization_id", access.clubIds)).order("id").range(from, to));
    const attendance = new Map(attendees.map(a => [a.event_id, a.status]));
    events = events.filter(event => {
      if (event.event_type === "camp") {
        const campId = campLinks.find(day => day.event_id === event.id)?.camp_id;
        const registered = !campId || registrations.some(r => r.camp_id === campId && r.registration_status === "registered");
        const dayStatus = registered ? attendance.get(event.id) : "not_registered";
        const key = dayStatus === "present" ? "camp_present" : ["absent", "excused"].includes(dayStatus ?? "") ? "camp_absent"
          : dayStatus === "expected" ? "camp_pending" : "camp_not_registered";
        campParticipation.set(event.id, { title: label(key, locale), participating: dayStatus === "present" });
        if (campId && camps.find(camp => camp.id === campId)?.status !== "scheduled") event.status = "cancelled";
        return true;
      }
      if (attendance.get(event.id) === "not_registered") return false;
      if (["absent", "excused"].includes(attendance.get(event.id) ?? "")) event.status = "cancelled";
      return true;
    });
    for (const event of personal) entries.push({ id: `personal-${playerId}-${event.id}`, startsAt: event.starts_at, endsAt: event.ends_at,
      title: playerTitle(event.title || label(event.event_type, locale)), location: event.location_text, url: playerUrl, cancelled: event.status === "cancelled" });
    for (const session of sessions) {
      const day = personalCampDays.find(d => d.session_id === session.id), camp = personalCamps.find(c => c.id === day?.camp_id);
      if (day && !camp) continue;
      entries.push({ id: `session-${playerId}-${session.id}`, startsAt: day?.starts_at || session.start_at, endsAt: day?.ends_at,
        durationMinutes: session.total_minutes, title: playerTitle(camp?.title || label(session.session_type === "club" ? "training" : session.session_type, locale)),
        location: day?.location_text || session.location_text, url: playerUrl, cancelled: camp?.status === "cancelled" });
    }
  } else if (scope.kind === "coach") {
    const [byGroup, assigned] = await Promise.all([
      readRelatedRows<ClubEvent>(access.groupIds, (ids, from, to) => db.from("club_events").select(eventColumns)
        .in("group_id", ids).in("club_id", access.clubIds).order("id").range(from, to)),
      readRelatedRows<ClubEvent>(access.eventIds, (ids, from, to) => db.from("club_events").select(eventColumns)
        .in("id", ids).in("club_id", access.clubIds).order("id").range(from, to)),
    ]);
    events = [...new Map([...byGroup, ...assigned].map(e => [e.id, e])).values()];
  } else {
    events = await readRelatedRows<ClubEvent>(access.clubIds, (ids, from, to) => db.from("club_events").select(eventColumns)
      .in("club_id", ids).order("id").range(from, to));
  }
  const [groups, clubs] = await Promise.all([
    readRelatedRows<{ id: string; name: string }>(events.flatMap(e => e.group_id ? [e.group_id] : []), (ids, from, to) => db.from("coach_groups")
      .select("id,name").in("id", ids).in("club_id", access.clubIds).order("id").range(from, to)),
    readRelatedRows<{ id: string; name: string }>(access.clubIds, (ids, from, to) => db.from("organizations").select("id,name").in("id", ids).order("id").range(from, to)),
  ]);
  for (const event of events) {
    const group = groups.find(g => g.id === event.group_id)?.name;
    const club = clubs.find(c => c.id === event.club_id)?.name;
    const title = event.title?.trim() || [label(event.event_type, locale), group].filter(Boolean).join(" · ");
    const participation = campParticipation.get(event.id);
    const path = scope.kind === "player" ? `/player/golf/trainings?child_id=${scope.playerId}`
      : scope.kind === "coach" && event.group_id ? `/coach/groups/${event.group_id}/planning/${event.id}` : `/${scope.kind}/calendar`;
    entries.push({ id: `club-${scope.kind === "player" ? scope.playerId + "-" : ""}${event.id}`, startsAt: event.starts_at, endsAt: event.ends_at,
      durationMinutes: event.duration_minutes, title: ["Golf", playerName, title, participation?.title].filter(Boolean).join(" · "),
      location: event.location_text, description: [club, group].filter(Boolean).join(" · "), url: appUrl(path), cancelled: event.status === "cancelled",
      transparent: participation ? !participation.participating : false });
  }
  return { name: ["ActiviTee", playerName || (scope.kind === "manager" ? clubs.map(c => c.name).join(", ") : "Planning")].filter(Boolean).join(" · "), entries };
}
