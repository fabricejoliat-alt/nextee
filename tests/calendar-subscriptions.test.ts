import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCalendar, calendarUrls } from "../lib/calendarSubscription.ts";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const club = id(1), foreign = id(2), player = id(3), parent = id(4), coach = id(5), manager = id(6), group = id(7);
const token = "a".repeat(43);
const subscription = (kind = "player", owner = parent): Row => ({ id: id(10), user_id: owner, kind, scope_key: kind === "player" ? player : "all", player_id: kind === "player" ? player : null, organization_id: null, token, locale: "fr" });
const event = (eventId: string, extra: Row = {}): Row => ({ id: eventId, club_id: club, group_id: group, title: "Entraînement", event_type: "training", starts_at: "2026-10-25T09:00:00Z", ends_at: "2026-10-25T10:00:00Z", status: "scheduled", ...extra });

function fixture(kind = "player", owner = parent, options: { failureTable?: string; maxRows?: number } = {}) {
  const tables: Record<string, Row[]> = {
    calendar_subscriptions: [subscription(kind, owner)], app_admins: [],
    club_members: [
      { user_id: player, club_id: club, role: "player", is_active: true },
      { user_id: parent, club_id: club, role: "parent", is_active: true },
      { user_id: coach, club_id: club, role: "coach", is_active: true },
      { user_id: manager, club_id: club, role: "manager", is_active: true },
    ],
    player_guardians: [{ player_id: player, guardian_user_id: parent, can_view: true, is_primary: true }],
    player_guardian_scopes: [{ player_id: player, guardian_user_id: parent, organization_id: club, status: "active", can_view: true }],
    profiles: [{ id: player, first_name: "Léa" }], organizations: [{ id: club, name: "Club Démo" }],
    coach_groups: [{ id: group, club_id: club, name: "Juniors", head_coach_user_id: coach }],
    coach_group_coaches: [], club_event_coaches: [{ event_id: "assigned", coach_id: coach }],
    club_events: [event("training"), event("cancelled", { status: "cancelled" }), event("camp", { event_type: "camp" }),
      event("foreign", { club_id: foreign }), event("unassigned", { group_id: "another-group" }), event("assigned", { group_id: null })],
    club_event_attendees: ["training", "cancelled", "camp", "foreign"].map(event_id => ({ player_id: player, event_id, status: "expected" })),
    club_camp_days: [{ event_id: "camp", camp_id: "camp-id" }], club_camps: [{ id: "camp-id", status: "scheduled" }], club_camp_players: [],
    player_activity_events: [{ id: "personal", user_id: player, organization_id: null, title: "Tournoi personnel", starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T12:00:00Z", status: "scheduled" }],
    training_sessions: [{ id: "individual", user_id: player, club_id: null, club_event_id: null, start_at: "2026-11-02T08:00:00Z", total_minutes: 90, session_type: "individual" },
      { id: "duplicate", user_id: player, club_id: club, club_event_id: "training", start_at: "2026-10-25T09:00:00Z" }],
    player_camp_days: [], player_camps: [],
  };
  const { db, mocks, writes } = managerDatabase(tables, { caller: owner, ...options });
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const query = from(table);
    return Object.assign(query, { or(filter: string) {
      const column = filter.startsWith("club_id") ? "club_id" : "organization_id";
      return query.in("id", tables[table].filter(row => row[column] == null || row[column] === club).map(row => row.id));
    } });
  }) as typeof db.from;
  const state = { legal: true, accessible: true, banned: false };
  db.rpc = (async (name: string) => ({ error: null, data: name === "organization_access_summary_checked"
    ? [{ organization_id: club, accessible: state.accessible }] : state.legal })) as typeof db.rpc;
  Object.assign(db.auth.admin, { getUserById: async () => ({ error: null, data: { user: { id: owner, banned_until: state.banned ? "2099-01-01" : null } } }) });
  const allMocks = { ...mocks, "@/lib/server/legalRequirements": { loadLegalGateStatus: async () => ({ missing: state.legal ? [] : ["terms"] }) } };
  return { tables, state, writes,
    feed: loadManagerModule<{ GET: (req: Request, context: { params: Promise<{ token: string }> }) => Promise<Response> }>("app/api/calendar/feed/[token]/planning.ics/route.ts", allMocks),
    api: loadManagerModule<Record<"GET" | "POST" | "DELETE", (req: Request) => Promise<Response>>>("app/api/calendar/subscription/route.ts", allMocks),
  };
}
const readFeed = (f: ReturnType<typeof fixture>, secret = token) => f.feed.GET(new Request("https://activitee.test/api/calendar/feed/hidden/planning.ics"), { params: Promise.resolve({ token: secret }) });
const apiRequest = (method: string, kind = "player", playerId = player, authenticated = true) => new Request(`https://activitee.test/api/calendar/subscription?kind=${kind}${kind === "player" ? `&player_id=${playerId}` : ""}`, { method, headers: authenticated ? { Authorization: "Bearer valid" } : {} });

test("iCalendar escapes injection, folds UTF-8 at 75 octets and preserves UTC across DST", () => {
  const value = renderCalendar("Léa, Golf", [{ id: "stable", title: "é".repeat(100) + "\nBEGIN:VEVENT", location: "Sion; A,B", startsAt: "2026-10-25T10:00:00+01:00", endsAt: "2026-10-25T11:00:00+01:00", url: "https://activitee.test/player/golf/trainings", cancelled: true }]);
  assert.equal(value.match(/^BEGIN:VEVENT$/gm)?.length, 1);
  for (const line of value.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = value.replace(/\r\n /g, "");
  assert.match(unfolded, /\\nBEGIN:VEVENT/);
  assert.match(unfolded, /DTSTART:20261025T090000Z/);
  assert.match(unfolded, /DTEND:20261025T100000Z/);
  assert.match(unfolded, /LOCATION:Sion\\; A\\,B/);
  assert.match(unfolded, /STATUS:CANCELLED/);
  assert.match(unfolded, /UID:stable@calendar.activitee.app/);
});

test("calendar URLs use a scoped opaque credential, and invalid dates are skipped", () => {
  assert.equal(calendarUrls("https://activitee.test", token).subscriptionUrl, `webcal://activitee.test/api/calendar/feed/${token}/planning.ics`);
  assert.throws(() => calendarUrls("https://activitee.test", "jwt-or-user-id"));
  const value = renderCalendar("Test", [{ id: "bad", title: "Bad", startsAt: "invalid", url: "https://activitee.test" }]);
  assert.ok(!value.includes("BEGIN:VEVENT"));
});

test("parent feed includes authorized planning, cancellations, personal training and unregistered camp days", async () => {
  const response = await readFeed(fixture());
  assert.equal(response.status, 200);
  const body = (await response.text()).replace(/\r\n /g, "");
  assert.match(body, /Golf · Léa · Entraînement/);
  assert.match(body, /STATUS:CANCELLED/);
  assert.match(body, /Tournoi personnel/);
  assert.match(body, /DTEND:20261102T093000Z/);
  for (const hidden of ["foreign", "duplicate", "unassigned", token, "motivation"]) assert.ok(!body.includes(hidden), hidden);
  const camp = body.split("BEGIN:VEVENT").find(part => part.includes(`UID:club-${player}-camp@`))!;
  assert.match(camp, /Non inscrit à cette journée/);
  assert.match(camp, /STATUS:CONFIRMED/);
  assert.match(camp, /TRANSP:TRANSPARENT/);
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
  assert.equal(response.headers.get("Content-Type"), "text/calendar; charset=utf-8");
});

test("camp days retain a stable UID through registration, participation and rescheduling", async () => {
  const f = fixture();
  const uid = `UID:club-${player}-camp@calendar.activitee.app`;
  const before = (await (await readFeed(f)).text()).replace(/\r\n /g, "");
  assert.ok(before.includes(uid)); assert.match(before, /Non inscrit à cette journée/);
  f.tables.club_camp_players.push({ camp_id: "camp-id", player_id: player, registration_status: "registered" });
  f.tables.club_event_attendees.find(a => a.event_id === "camp")!.status = "present";
  const first = await (await readFeed(f)).text();
  assert.ok(first.replace(/\r\n /g, "").includes(uid));
  assert.match(first.replace(/\r\n /g, ""), /SUMMARY:Golf · Léa · Entraînement · Participe/);
  f.tables.club_events.find(e => e.id === "camp")!.starts_at = "2026-11-15T09:00:00Z";
  const second = (await (await readFeed(f)).text()).replace(/\r\n /g, "");
  assert.ok(second.includes(uid)); assert.match(second, /DTSTART:20261115T090000Z/);
});

test("participation is stated per camp day and nonparticipation does not cancel the camp", async () => {
  const f = fixture();
  f.tables.club_camp_players.push({ camp_id: "camp-id", player_id: player, registration_status: "registered" });
  f.tables.club_events = [];
  f.tables.club_event_attendees = [];
  f.tables.club_camp_days = [];
  const cases = [
    ["present", "Participe", "OPAQUE"], ["absent", "Ne participe pas", "TRANSPARENT"],
    ["excused", "Ne participe pas", "TRANSPARENT"], ["expected", "Participation à confirmer", "TRANSPARENT"],
    ["not_registered", "Non inscrit à cette journée", "TRANSPARENT"],
  ];
  for (const [status] of cases) {
    f.tables.club_events.push(event(status, { event_type: "camp", title: "Stage d’automne" }));
    f.tables.club_event_attendees.push({ event_id: status, player_id: player, status });
    f.tables.club_camp_days.push({ event_id: status, camp_id: "camp-id" });
  }
  let body = (await (await readFeed(f)).text()).replace(/\r\n /g, "");
  for (const [status, title, transparency] of cases) {
    const entry = body.split("BEGIN:VEVENT").find(part => part.includes(`UID:club-${player}-${status}@`))!;
    assert.ok(entry.includes(`SUMMARY:Golf · Léa · Stage d’automne · ${title}`));
    assert.match(entry, /STATUS:CONFIRMED/);
    assert.ok(entry.includes(`TRANSP:${transparency}`));
  }
  f.tables.club_camps[0].status = "cancelled";
  body = (await (await readFeed(f)).text()).replace(/\r\n /g, "");
  for (const [status] of cases) {
    const entry = body.split("BEGIN:VEVENT").find(part => part.includes(`UID:club-${player}-${status}@`))!;
    assert.match(entry, /STATUS:CANCELLED/);
  }
});

test("camp participation labels are localized and never added to staff calendars", async () => {
  for (const [locale, expected] of [["fr", "Participe"], ["en", "Participating"], ["de", "Nimmt teil"], ["it", "Partecipa"]]) {
    const f = fixture(); f.tables.calendar_subscriptions[0].locale = locale;
    f.tables.club_camp_players.push({ camp_id: "camp-id", player_id: player, registration_status: "registered" });
    f.tables.club_event_attendees.find(a => a.event_id === "camp")!.status = "present";
    assert.ok((await (await readFeed(f)).text()).replace(/\r\n /g, "").includes(` · ${expected}`));
  }
  for (const [kind, owner] of [["coach", coach], ["manager", manager]]) {
    const body = (await (await readFeed(fixture(kind, owner))).text()).replace(/\r\n /g, "");
    const entry = body.split("BEGIN:VEVENT").find(part => part.includes("UID:club-camp@"))!;
    assert.match(entry, /SUMMARY:Golf · Entraînement\r\n/);
    assert.match(entry, /TRANSP:OPAQUE/);
  }
});

test("removed guardian link, withdrawn scope, legal gate and banned account clear the feed", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.tables.player_guardians.length = 0; },
    (f: ReturnType<typeof fixture>) => { f.tables.player_guardian_scopes[0].can_view = false; },
    (f: ReturnType<typeof fixture>) => { f.state.accessible = false; },
    (f: ReturnType<typeof fixture>) => { f.state.legal = false; },
    (f: ReturnType<typeof fixture>) => { f.state.banned = true; }]) {
    const f = fixture(); change(f);
    const response = await readFeed(f); assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes("BEGIN:VEVENT"));
  }
});

test("invalid/revoked tokens expose no schedule; temporary failures do not publish an empty calendar", async () => {
  assert.equal((await readFeed(fixture(), "invalid")).status, 404);
  assert.equal((await readFeed(fixture(), "b".repeat(43))).status, 404);
  assert.equal((await readFeed(fixture("player", parent, { failureTable: "club_events" }))).status, 503);
});

test("coach gets only current group/direct assignments; manager gets only active clubs", async () => {
  const f = fixture("coach", coach);
  let body = await (await readFeed(f)).text();
  assert.match(body, /UID:club-training/); assert.match(body, /UID:club-assigned/);
  assert.ok(!body.includes("unassigned")); assert.ok(!body.includes("foreign"));
  f.tables.club_members.find(row => row.user_id === coach)!.is_active = false;
  body = await (await readFeed(f)).text(); assert.ok(!body.includes("BEGIN:VEVENT"));
  body = await (await readFeed(fixture("manager", manager))).text();
  assert.match(body, /UID:club-unassigned/); assert.ok(!body.includes("foreign"));
});

test("subscription management requires auth, prevents another child and reuses an existing URL", async () => {
  const f = fixture();
  assert.equal((await f.api.GET(apiRequest("GET", "player", player, false))).status, 401);
  assert.equal((await f.api.POST(apiRequest("POST", "player", id(99)))).status, 403);
  const first = await f.api.GET(apiRequest("GET"));
  const second = await f.api.POST(apiRequest("POST"));
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(f.writes.length, 0);
});

test("revocation is owner-scoped and remains available after losing guardian access", async () => {
  const f = fixture();
  f.tables.calendar_subscriptions.push({ ...subscription(), id: id(99), user_id: coach });
  f.tables.player_guardians.length = 0;
  const response = await f.api.DELETE(apiRequest("DELETE"));
  assert.equal(response.status, 200);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].rows.map(r => r.user_id), [parent]);
});

test("creating a subscription issues a random calendar-only credential for the authorized owner", async () => {
  const f = fixture(); f.tables.calendar_subscriptions.length = 0;
  const response = await f.api.POST(apiRequest("POST"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.subscription.httpsUrl, /^https:\/\/activitee\.test\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}\/planning\.ics$/);
  assert.equal(f.writes[0].values.user_id, parent);
  assert.equal(f.writes[0].values.player_id, player);
  assert.notEqual(f.writes[0].values.token, token);
  assert.ok(!payload.subscription.httpsUrl.includes("valid"));
});

test("large club schedules are paginated beyond the database row limit", async () => {
  const f = fixture("manager", manager, { maxRows: 500 });
  f.tables.club_events = Array.from({ length: 1105 }, (_, n) => event(`event-${String(n).padStart(4, "0")}`));
  const response = await readFeed(f);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).match(/^BEGIN:VEVENT$/gm)?.length, 1105);
});
