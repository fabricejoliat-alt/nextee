import assert from "node:assert/strict";
import test from "node:test";
import { managerDatabase, loadManagerModule, managerRequest, type Row } from "./helpers/managerRouteHarness.ts";
import { isCoachAiAdult, coachAiSourceFingerprint } from "../lib/server/coachAiAuthorization.ts";

const player = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const path = "app/api/coach/events/[eventId]/";
const ctx = { params: Promise.resolve({ eventId: "event" }) };
const sourceHash = "a".repeat(64);
const decisionAt = "2026-09-01T12:00:00Z";

function fixture(): Record<string, Row[]> {
  return {
    profiles: [{ id: player, birth_date: "2000-02-01" }],
    club_members: [
      { user_id: "coach", club_id: "A", role: "coach", is_active: true },
      { user_id: player, club_id: "A", role: "player", is_active: true },
    ],
    club_events: [{ id: "event", club_id: "A", group_id: "group", event_type: "training", status: "scheduled", starts_at: "2099-10-01T10:00:00Z" }],
    coach_groups: [{ id: "group", club_id: "A", head_coach_user_id: "coach" }],
    club_event_attendees: [{ event_id: "event", player_id: player }],
    legal_documents: [{ id: "doc", purpose_key: "coaching.ai", kind: "specific_consent", scope: "club", club_id: "A", active: true,
      action_kind: "consent", required: false, audience_roles: ["player"], applicability: { status: "approved", rule: "all_members" } }],
    legal_versions: [{ id: "version", document_id: "doc", version_number: 1 }],
    legal_current_state: [{ document_id: "doc", beneficiary_id: player, club_scope: "A", version_id: "version", decision_id: "decision", decision: "consented", conflict: false }],
    legal_decisions: [{ id: "decision", document_id: "doc", actor_id: player, beneficiary_id: player, club_id: "A", version_id: "version",
      decision: "consented", source: "user_flow", decided_at: decisionAt, authority_snapshot: { authority: "self", role: "player" } }],
  };
}

function setup(tables = fixture(), options: { duringTransport?: () => void; failTable?: string; rpcValue?: boolean } = {}) {
  const harness = managerDatabase(tables, { caller: "coach", failureTable: options.failTable });
  const db = { ...harness.db, rpc: async () => ({ data: options.rpcValue ?? true, error: null }) };
  const payloads: Row[] = [];
  const mocks = {
    ...harness.mocks,
    "@/app/api/messages/_lib": { requireCaller: async () => ({ callerId: "coach", supabaseAdmin: db }) },
    fetch: async (_url: string, options: RequestInit) => {
      payloads.push(JSON.parse(String(options.body)));
      optionsForCall();
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({
        player_id: "subject", text: "Routine régulière.", rationale: "Reformulation", confidence: "high", points: ["Routine régulière."],
      }) }] }] });
    },
  };
  function optionsForCall() { options.duringTransport?.(); }
  const route = (suffix: string, extra: Record<string, unknown> = {}) => loadManagerModule<{
    POST: (req: Request, context: typeof ctx) => Promise<Response>;
    PUT: (req: Request, context: typeof ctx) => Promise<Response>;
  }>(path + suffix + "/route.ts", { ...mocks, ...extra }, { OPENAI_API_KEY: "fixture-only", LEGAL_ENFORCEMENT_ENABLED: "false" });
  const helper = loadManagerModule<{ loadCoachAiPlayerGrant: (db: unknown, clubId: string, playerId: string) => Promise<string | null> }>(
    "lib/server/coachAiAuthorization.ts", mocks);
  return { tables, db, helper, payloads, writes: harness.writes, route };
}

const request = () => managerRequest("POST", { player_id: player, source_text: "Routine régulière.", locale: "fr" });
const preparationSources = {
  coachPreparationProviderInput: (source: Row) => ({ sessions: source.private_notes_by_session.map((session: Row) => ({ notes: session.private_notes.map((n: Row) => n.text) })) }),
  loadCoachPreparationSources: async (_db: unknown, _event: unknown, ids: string[]) => ({
    historyEventIds: ["history"], sourceByPlayerId: new Map(ids.map((id) => [id, { sourceHash, sourceCount: 1,
      source: { player_reference: id, private_notes_by_session: [{ event_id: "history", private_notes: [{ id: "note", text: "Routine régulière." }] }] } }])) }),
};

test("age is strict and uses the Swiss calendar at the 18th birthday", () => {
  const before = new Date("2026-10-04T21:59:59Z");
  const after = new Date("2026-10-04T22:00:00Z");
  assert.equal(isCoachAiAdult("2008-10-05", before), false);
  assert.equal(isCoachAiAdult("2008-10-05", after), true);
  for (const invalid of [null, "", "future", "2027-01-01", "2000-02-30", "2008-10-06", "2000-1-1"]) {
    assert.equal(isCoachAiAdult(invalid, after), false);
  }
});

const denied: Array<[string, (tables: Record<string, Row[]>) => void]> = [
  ["minor even with a consent", (t) => { t.profiles[0].birth_date = "2018-01-01"; }],
  ["unknown age", (t) => { t.profiles[0].birth_date = null; }],
  ["player left the club", (t) => { t.club_members[1].is_active = false; }],
  ["coach lost event access", (t) => { t.coach_groups[0].head_coach_user_id = "another-coach"; }],
  ["player not attending", (t) => { t.club_event_attendees = []; }],
  ["cancelled event", (t) => { t.club_events[0].status = "cancelled"; }],
  ["no active purpose document", (t) => { t.legal_documents = []; }],
  ["retired document", (t) => { t.legal_documents[0].active = false; }],
  ["wrong purpose", (t) => { t.legal_documents[0].purpose_key = "marketing"; }],
  ["wrong club", (t) => { t.legal_documents[0].club_id = "B"; }],
  ["ambiguous documents", (t) => { t.legal_documents.push({ ...t.legal_documents[0], id: "other-doc" }); }],
  ["mandatory consent", (t) => { t.legal_documents[0].required = true; }],
  ["unsupported rule", (t) => { t.legal_documents[0].applicability.rule = "future_rule"; }],
  ["refusal", (t) => { t.legal_current_state[0].decision = "refused"; }],
  ["withdrawal", (t) => { t.legal_current_state[0].decision = "withdrawn"; }],
  ["conflict", (t) => { t.legal_current_state[0].conflict = true; }],
  ["new document version", (t) => { t.legal_versions[0].id = "version-2"; }],
  ["another beneficiary", (t) => { t.legal_current_state[0].beneficiary_id = other; }],
  ["another scope", (t) => { t.legal_current_state[0].club_scope = "B"; }],
  ["old parental decision after majority", (t) => { t.legal_decisions[0].actor_id = "parent"; }],
  ["decision before majority", (t) => { t.legal_decisions[0].decided_at = "2017-01-01T12:00:00Z"; }],
  ["historical import", (t) => { t.legal_decisions[0].source = "historical_import"; }],
];
for (const [name, change] of denied) test(`${name}: no provider call`, async () => {
  const tables = fixture(); change(tables); const env = setup(tables);
  const result = await env.route("debrief/analyze-player").POST(request(), ctx);
  assert.ok([400,403].includes(result.status), `${name}: ${result.status}`);
  assert.equal(env.payloads.length, 0);
  assert.equal(env.writes.length, 0);
});

test("adult self consent allows only its club, without automatic identity fields in provider input", async () => {
  const env = setup();
  assert.equal(await env.helper.loadCoachAiPlayerGrant(env.db, "B", player), null);
  const result = await env.route("debrief/analyze-player").POST(request(), ctx);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).proposal.player_id, player);
  assert.equal(env.payloads.length, 1);
  assert.equal(env.payloads[0].store, false);
  assert.ok(!JSON.stringify(env.payloads).includes(player));
  assert.match(result.headers.get("cache-control")!, /no-store/);
});

for (const change of ["withdrawn", "new-version", "coach-revoked", "event-moved"]) test(`${change} during provider call discards the answer`, async () => {
  const tables = fixture();
  const env = setup(tables, { duringTransport: () => {
    if (change === "withdrawn") tables.legal_current_state[0].decision = "withdrawn";
    if (change === "new-version") tables.legal_versions[0].id = "new";
    if (change === "coach-revoked") tables.club_members[0].is_active = false;
    if (change === "event-moved") tables.club_events[0].group_id = "another-group";
  } });
  const result = await env.route("debrief/analyze-player").POST(request(), ctx);
  assert.equal(result.status, 403);
  assert.equal((await result.json()).proposal, undefined);
  assert.equal(env.writes.length, 0);
});

test("registry unavailable or changed published metadata never permits transport", async () => {
  for (const options of [{ failTable: "legal_current_state" }, { rpcValue: false }]) {
    const env = setup(fixture(), options);
    assert.notEqual((await env.route("debrief/analyze-player").POST(request(), ctx)).status, 200);
    assert.equal(env.payloads.length, 0);
  }
});

test("preparation excludes a minor before loading private notes and ignores the old cache", async () => {
  const tables = fixture(); tables.profiles[0].birth_date = "2018-01-01";
  tables.coach_training_preparation_insights = [{ target_event_id: "event", player_id: player, attention_points: [{ text: "OLD" }] }];
  const env = setup(tables); let sourceReads = 0;
  const result = await env.route("preparation-insights", { "@/lib/server/coachPreparationSources": {
    loadCoachPreparationSources: () => { sourceReads++; throw new Error("Must not read private notes"); },
  } }).POST(managerRequest("POST"), ctx);
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(body.insights, []);
  assert.deepEqual(body.unavailable_player_ids, [player]);
  assert.equal(sourceReads, 0); assert.equal(env.payloads.length, 0);
});

test("withdrawal during preparation prevents cache writes and discards generated points", async () => {
  const tables = fixture();
  const env = setup(tables, { duringTransport: () => { tables.legal_current_state[0].decision = "withdrawn"; } });
  const result = await env.route("preparation-insights", { "@/lib/server/coachPreparationSources": preparationSources }).POST(managerRequest("POST"), ctx);
  assert.equal(result.status, 200);
  const body = await result.json(); assert.deepEqual(body.insights, []);
  assert.deepEqual(body.unavailable_player_ids, [player]);
  assert.equal(env.writes.length, 0);
});

test("re-consent never reuses a previous decision's cached points", async () => {
  const tables = fixture();
  tables.coach_training_preparation_insights = [{ target_event_id: "event", player_id: player,
    source_fingerprint: coachAiSourceFingerprint(sourceHash, "version:old-decision"), attention_points: [{ text: "OLD" }], source_event_count: 1 }];
  const env = setup(tables);
  const result = await env.route("preparation-insights", { "@/lib/server/coachPreparationSources": preparationSources }).POST(managerRequest("POST"), ctx);
  assert.equal(result.status, 200);
  assert.equal(env.payloads.length, 1);
  assert.deepEqual((await result.json()).insights[0].points, [{ text: "Routine régulière." }]);
  assert.equal(env.writes[0].values.source_fingerprint, coachAiSourceFingerprint(sourceHash, "version:decision"));
});

test("cached preparation with current authorization needs no provider call", async () => {
  const tables = fixture(); tables.coach_training_preparation_insights = [{ target_event_id: "event", player_id: player,
    source_fingerprint: coachAiSourceFingerprint(sourceHash, "version:decision"), attention_points: [{ text: "Current" }], source_event_count: 1 }];
  const env = setup(tables);
  const result = await env.route("preparation-insights", { "@/lib/server/coachPreparationSources": preparationSources }).POST(managerRequest("POST"), ctx);
  assert.equal(result.status, 200); assert.equal(env.payloads.length, 0);
  assert.equal((await result.json()).insights[0].points[0].text, "Current");
});

test("seen acknowledgement after withdrawal is denied without mutation", async () => {
  const tables = fixture(); tables.legal_current_state[0].decision = "withdrawn";
  const env = setup(tables);
  const result = await env.route("preparation-seen").PUT(managerRequest("PUT", { player_id: player, source_fingerprint: sourceHash }), ctx);
  assert.equal(result.status, 403); assert.equal(env.writes.length, 0);
});

test("provider preparation payload removes identities and timestamps but preserves the chosen notes", async () => {
  const source = loadManagerModule<{ coachPreparationProviderInput: (input: unknown) => unknown }>("lib/server/coachPreparationSources.ts", {});
  const payload = source.coachPreparationProviderInput({ player_reference: player, private_notes_by_session: [{
    event_id: "event", date: "2026-10-01", private_notes: [{ id: "note", saved_at: "2026-10-01T12:00:00Z", text: "Routine régulière." }],
  }] });
  assert.deepEqual(payload, { sessions: [{ recency_order: 1, notes: ["Routine régulière."] }] });
});
