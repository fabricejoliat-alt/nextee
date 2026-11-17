import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, type Row } from "./helpers/managerRouteHarness.ts";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

function fixture(options: { staff?: boolean; legal?: boolean } = {}) {
  const data: Record<string, Row[]> = {
    club_members: [{ club_id: "club", user_id: "coach", role: "coach", is_active: options.staff !== false },
      ...["ready", "pending", "suspended", "ended", "inactive", "outside"].map(user_id => ({ club_id: user_id === "outside" ? "other" : "club",
        user_id, role: "player", is_active: user_id !== "inactive", player_consent_status: user_id === "ready" ? "granted" : "pending" }))],
    organizations: [{ id: "club", name: "Sion" }],
    coach_groups: [{ id: "group", club_id: "club", name: "Groupe", head_coach_user_id: "coach", is_active: true }],
    coach_group_coaches: [{ id: "coach-link", group_id: "group", coach_user_id: "coach", is_head: true }],
    coach_group_players: ["ready", "pending", "outside"].map(player_user_id => ({ id: player_user_id, group_id: "group", player_user_id })),
    profiles: ["ready", "pending", "outside", "coach"].map(id => ({ id, first_name: id, last_name: "Junior", avatar_url: null, handicap: 12, private_note: "secret" })),
    academy_roster_entries: [{ academy_id: "club", player_id: "suspended", status: "suspended" }, { academy_id: "club", player_id: "ended", status: "ended" }],
    club_events: [{ id: "event", group_id: "group", club_id: "club", event_type: "session", title: "Activité", status: "scheduled", starts_at: "2099-01-01T10:00:00Z", duration_minutes: 60 }],
    club_event_attendees: ["ready", "pending", "outside"].map(player_id => ({ event_id: "event", player_id, status: "expected", coach_recorded_status: null })),
    club_event_coach_feedback: [{ event_id: "event", player_id: "pending", coach_id: "coach", private_note: "secret" }],
  };
  const state = managerDatabase(data, { caller: "coach" });
  state.db.rpc = async (name, args) => {
    state.rpcs.push({ name, args });
    return { data: name === "organization_actor_legal_ready" ? options.legal !== false : !args.p_player || args.p_player === "ready", error: null } as never;
  };
  return { ...state, data };
}

test("basic roster includes pending juniors but excludes inactive, suspended and other-club affiliations", async () => {
  const f = fixture();
  const { coachRosterPlayerIds } = loadManagerModule("lib/server/coachRoster.ts", {});
  const ids = await coachRosterPlayerIds(f.db, "coach", "club", ["ready", "pending", "inactive", "suspended", "ended", "outside"]);
  assert.deepEqual([...ids], ["ready", "pending"]);
  assert.ok(!f.rpcs.some(row => row.args.p_player), "Basic visibility must not ask for a junior's consent");
  assert.equal(f.writes.length, 0);
});

for (const options of [{ staff: false }, { legal: false }]) {
  test(`basic roster still enforces the coach's membership and own documents: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); const { coachRosterPlayerIds } = loadManagerModule("lib/server/coachRoster.ts", {});
    assert.equal((await coachRosterPlayerIds(f.db, "coach", "club", ["pending"])).size, 0);
  });
}

test("group planning includes pending roster identities without private details or another club's player", async () => {
  const f = fixture(); const { loadCoachGroupPlanning } = loadManagerModule("lib/server/coachGroupPlanning.ts", {});
  const result = await loadCoachGroupPlanning(f.db, "coach", "group");
  assert.deepEqual(result.group_players.map((row: Row) => row.player_user_id), ["ready", "pending"]);
  assert.deepEqual(result.events[0].attendees.map((row: Row) => row.id), ["ready", "pending"]);
  const pending = result.group_players.find((row: Row) => row.player_user_id === "pending");
  assert.equal(pending.can_access_details, false);
  assert.equal(pending.profiles.first_name, "pending");
  assert.equal(pending.profiles.handicap, null);
  assert.equal(result.group_players[0].profiles.handicap, 12);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("activity details expose a pending identity but no feedback or handicap for that junior", async () => {
  const f = fixture();
  const { GET } = loadManagerModule("app/api/coach/events/[eventId]/route.ts", {
    ...f.mocks,
    "@/app/api/messages/_lib": { requireCaller: async () => ({ callerId: "coach" }) },
    "@/lib/coachAuthorization": { hasCoachClubPermission: async () => false },
    "@/lib/server/coachTrainingAssistance": { isCoachTrainingAssistanceEnabled: async () => false },
  });
  const response = await GET(new Request("https://activitee.app/api/coach/events/event", { headers: { Authorization: "Bearer test" } }), { params: Promise.resolve({ eventId: "event" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.attendees.map((row: Row) => row.player_id), ["pending", "ready"]);
  assert.equal(body.attendees[0].profile.first_name, "pending");
  assert.equal(body.attendees[0].profile.handicap, null);
  assert.equal(body.attendees[0].can_access_details, false);
  assert.deepEqual(body.evaluatedPlayers, []);
  assert.deepEqual(body.evaluatedPlayerIds, []);
  assert.ok(!JSON.stringify(body).includes("secret"));
  assert.equal(f.writes.length, 0);
});

test("group page displays a pending junior from the server roster without a profile-detail action", async (context) => {
  const { db } = fixture();
  const harness = coachComponentHarness("app/coach/groups/[id]/page.tsx", {
    params: { id: "group" }, database: { from: db.from },
    fetch: async () => Response.json({ group: { id: "group", club_id: "club" }, events: [], can_plan: false,
      group_players: [{ id: "link", group_id: "group", player_user_id: "pending", can_access_details: false,
        profiles: { id: "pending", first_name: "Pending", last_name: "Junior", avatar_url: null, handicap: null } }] }),
  });
  context.after(() => harness.cleanup());
  harness.render(); await flush(); const tree = harness.render();
  assert.ok(textContent(tree).includes("Pending Junior"));
  assert.ok(!elements(tree).some(node => node.type === "a" && String(node.props.href).startsWith("/coach/players/pending")));
});

test("Coach merit filters use the Junior season and organization controls", () => {
  for (const path of ["app/coach/om/page.tsx", "app/player/om/page.tsx"]) {
    const source = readFileSync(path, "utf8");
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let dates = 0, current = 0;
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(tree);
        if (tag === "input" && node.attributes.properties.some(p => p.getText(tree) === 'type="date"')) dates++;
        if (tag === "option" && node.attributes.properties.some(p => p.getText(tree) === 'value="current"')) current++;
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.equal(dates, 0, path); assert.equal(current, 1, path);
    assert.match(source, /const rankingFrom = yearStartInZurich/);
    assert.match(source, /const rankingTo = todayInZurich/);
    assert.match(source, /orgs.length > 1/);
  }
});
