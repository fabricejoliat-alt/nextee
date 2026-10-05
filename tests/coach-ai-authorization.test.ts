import assert from "node:assert/strict";
import test from "node:test";
import { managerDatabase, loadManagerModule, managerRequest, type Row } from "./helpers/managerRouteHarness.ts";
import { isCoachAiAdult, isCoachAiAtLeast13, coachAiSourceFingerprint } from "../lib/server/coachAiAuthorization.ts";

const player = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const path = "app/api/coach/events/[eventId]/";
const ctx = { params: Promise.resolve({ eventId: "event" }) };
const sourceHash = "a".repeat(64);
const decisionAt = "2026-09-01T12:00:00Z";

function fixture(): Record<string, Row[]> {
  return {
    profiles: [{ id: player, birth_date: "2000-02-01", first_name: "Léon", last_name: "Exemple" }],
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

function setup(tables = fixture(), options: { duringTransport?: () => void; failTable?: string; rpcValue?: boolean; apiKey?: string; env?: Record<string, string>; parentAuthority?: boolean } = {}) {
  const harness = managerDatabase(tables, { caller: "coach", failureTable: options.failTable, applyOrder: true });
  const db = { ...harness.db, rpc: async (name: string) => ({ data: name === "legal_actor_allowed" ? options.parentAuthority ?? true : options.rpcValue ?? true, error: null }) };
  const payloads: Row[] = [];
  const headers: Headers[] = [];
  const mocks = {
    ...harness.mocks,
    "@/app/api/messages/_lib": { requireCaller: async () => ({ callerId: "coach", supabaseAdmin: db }) },
    fetch: async (_url: string, options: RequestInit) => {
      headers.push(new Headers(options.headers));
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
  }>(path + suffix + "/route.ts", { ...mocks, ...extra }, { OPENAI_API_KEY: options.apiKey ?? "fixture-only", LEGAL_ENFORCEMENT_ENABLED: "false", ...options.env });
  const helper = loadManagerModule<{ loadCoachAiPlayerGrant: (db: unknown, clubId: string, playerId: string) => Promise<string | null> }>(
    "lib/server/coachAiAuthorization.ts", mocks, options.env);
  async function rewrite(body: Row = {}) {
    const post = route("debrief/analyze-player").POST;
    const values = { player_id: player, source_text: "Routine régulière.", locale: "fr", ...body };
    const preview = await post(managerRequest("POST", { ...values, intent: "preview" }), ctx);
    if (!preview.ok) return preview;
    const json = await preview.json();
    return post(managerRequest("POST", { ...values, review: json.preview.review, review_confirmed: true }), ctx);
  }
  return { tables, db, helper, payloads, headers, writes: harness.writes, route, rewrite };
}


test("missing provider key does not hide the authorization refusal", async () => {
  for (const birthDate of ["2012-01-01", "1990-01-01", null]) {
    const tables = fixture();
    tables.profiles[0].birth_date = birthDate;
    tables.legal_documents = [];
    const env = setup(tables, { apiKey: "" });
    const res = await env.rewrite();
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "ai_authorization_required");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(env.payloads.length, 0);
  }
});

test("an authorized adult without provider configuration gets a non-cacheable 503", async () => {
  const env = setup(fixture(), { apiKey: "" });
  const res = await env.rewrite();
  assert.equal(res.status, 503);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(env.payloads.length, 0);
});
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
  const result = await env.rewrite();
  assert.ok([400,403].includes(result.status), `${name}: ${result.status}`);
  assert.equal(env.payloads.length, 0);
  assert.equal(env.writes.length, 0);
});

test("adult self consent allows only its club, without automatic identity fields in provider input", async () => {
  const env = setup();
  assert.equal(await env.helper.loadCoachAiPlayerGrant(env.db, "B", player), null);
  const result = await env.rewrite();
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
  const result = await env.rewrite();
  assert.equal(result.status, 403);
  assert.equal((await result.json()).proposal, undefined);
  assert.equal(env.writes.length, 0);
});

test("registry unavailable or changed published metadata never permits transport", async () => {
  for (const options of [{ failTable: "legal_current_state" }, { rpcValue: false }]) {
    const env = setup(fixture(), options);
    assert.notEqual((await env.rewrite()).status, 200);
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

const minorEnv = {
  COACH_AI_MINOR_REWRITE_ENABLED: "true", OPENAI_COACH_ZDR_CONFIRMED: "true",
  OPENAI_COACH_PROJECT_ID: "proj_fixture", OPENAI_COACH_API_KEY: "minor-fixture-only",
};
function minorFixture(birthDate = "2012-01-01") {
  const tables = fixture();
  tables.profiles[0].birth_date = birthDate;
  tables.legal_documents[0].purpose_key = "coaching.rewrite";
  tables.legal_documents[0].audience_roles = ["parent", "player"];
  tables.legal_decisions.push({ ...tables.legal_decisions[0], id: "parent-decision", actor_id: "parent",
    decided_at: "2026-09-02T12:00:00Z", authority_snapshot: { authority: "verified_representative", role: "parent", parent_email_confirmed: true } });
  tables.legal_current_state[0].decision_id = "parent-decision";
  return tables;
}
const rewriteValues = { player_id: player, source_text: "Léon Exemple progresse dans sa routine.", locale: "fr", audience: "junior" };

for (const key of Object.keys(minorEnv)) test(`under-13 rewrite stays closed without ${key}`, async () => {
  const env = setup(minorFixture("2018-01-01"), { env: { ...minorEnv, [key]: "" } });
  assert.equal((await env.rewrite()).status, 403);
  assert.equal(env.payloads.length, 0);
});

const minorDenied: Array<[string, (t: Record<string, Row[]>) => void]> = [
  ["parent only", t => { t.legal_decisions = t.legal_decisions.filter(d => d.actor_id !== player); }],
  ["child only", t => { t.legal_decisions = t.legal_decisions.filter(d => d.actor_id === player); }],
  ["unconfirmed parent email", t => { t.legal_decisions[1].authority_snapshot.parent_email_confirmed = false; }],
  ["unverified parent", t => { t.legal_decisions[1].authority_snapshot.authority = "self"; }],
  ["parent from other club", t => { t.legal_decisions[1].club_id = "B"; }],
  ["old parent version", t => { t.legal_decisions[1].version_id = "old"; }],
  ["old child version", t => { t.legal_decisions[0].version_id = "old"; }],
  ["child refusal followed by parent consent", t => { t.legal_decisions[0].decision = "refused"; }],
  ["parent refusal followed by child consent", t => { t.legal_decisions[1].decision = "refused"; t.legal_current_state[0].decision_id = "decision"; }],
  ["latest child choice negative", t => { t.legal_decisions.push({ ...t.legal_decisions[0], id: "new-child", decided_at: "2026-09-03T12:00:00Z", decision: "refused" }); }],
  ["latest parent choice negative", t => { t.legal_decisions.push({ ...t.legal_decisions[1], id: "new-parent", decided_at: "2026-09-03T12:00:00Z", decision: "withdrawn" }); }],
  ["birth unknown", t => { t.profiles[0].birth_date = null; }],
  ["now adult", t => { t.profiles[0].birth_date = "2000-01-01"; }],
  ["conflict", t => { t.legal_current_state[0].conflict = true; }],
  ["published new version", t => { t.legal_versions.push({ ...t.legal_versions[0], id: "version2", version_number: 2 }); }],
  ["wrong broad purpose", t => { t.legal_documents[0].purpose_key = "coaching.ai"; }],
  ["parent role not applicable", t => { t.legal_documents[0].audience_roles = ["player"]; }],
];
for (const [name, change] of minorDenied) test(`minor: ${name} prevents transport`, async () => {
  const tables = minorFixture(); change(tables);
  const env = setup(tables, { env: minorEnv });
  assert.equal((await env.rewrite()).status, 403);
  assert.equal(env.payloads.length, 0);
});

test("current parent authority is required even with an earlier verified decision", async () => {
  const env = setup(minorFixture(), { env: minorEnv, parentAuthority: false });
  assert.equal((await env.rewrite()).status, 403);
  assert.equal(env.payloads.length, 0);
});

test("minor with two choices can preview without transport, then send only masked source to dedicated project", async () => {
  const env = setup(minorFixture(), { env: minorEnv });
  const post = env.route("debrief/analyze-player").POST;
  const res = await post(managerRequest("POST", { ...rewriteValues, intent: "preview" }), ctx);
  assert.equal(res.status, 200);
  const { preview } = await res.json();
  assert.equal(preview.text, "[joueur] [joueur] progresse dans sa routine.");
  assert.equal(env.payloads.length, 0);
  const sent = await post(managerRequest("POST", { ...rewriteValues, review: preview.review, review_confirmed: true }), ctx);
  assert.equal(sent.status, 200);
  assert.equal(env.headers[0].get("OpenAI-Project"), "proj_fixture");
  assert.equal(env.headers[0].get("Authorization"), "Bearer minor-fixture-only");
  const payload = env.payloads[0];
  assert.equal(payload.store, false);
  assert.deepEqual(JSON.parse(payload.input[1].content), {
    player: { player_id: "subject" }, audience: "junior", output_language: "French", individual_source: preview.text,
  });
  for (const value of [player, "Léon", "Exemple", "2012", "parent-decision"]) assert.ok(!JSON.stringify(payload).includes(value));
  assert.equal(env.writes.length, 0);
});

test("old client and forged review cannot skip preview", async () => {
  const env = setup(); const post = env.route("debrief/analyze-player").POST;
  for (const extra of [{}, { review_confirmed: true }, { review_confirmed: true, review: { expires: Date.now() + 1000, signature: "0".repeat(64) } }]) {
    const result = await post(managerRequest("POST", { ...rewriteValues, ...extra }), ctx);
    assert.equal(result.status, 409);
    assert.equal((await result.json()).code, "ai_review_required");
  }
  assert.equal(env.payloads.length, 0);
});

test("changing text, audience or language after preview requires a new review", async () => {
  const env = setup(); const post = env.route("debrief/analyze-player").POST;
  const { preview } = await (await post(managerRequest("POST", { ...rewriteValues, intent: "preview" }), ctx)).json();
  for (const change of [{ source_text: "Changed" }, { audience: "private" }, { locale: "de" }]) {
    assert.equal((await post(managerRequest("POST", { ...rewriteValues, ...change, review: preview.review, review_confirmed: true }), ctx)).status, 409);
  }
  assert.equal(env.payloads.length, 0);
});

for (const target of ["parent", "child"]) test(`${target} withdrawal after preview or during transport blocks the response`, async () => {
  for (const duringTransport of [false, true]) {
    const tables = minorFixture();
    const withdraw = () => { tables.legal_decisions[target === "parent" ? 1 : 0].decision = "withdrawn"; };
    const env = setup(tables, { env: minorEnv, duringTransport: duringTransport ? withdraw : undefined });
    const post = env.route("debrief/analyze-player").POST;
    const { preview } = await (await post(managerRequest("POST", { ...rewriteValues, intent: "preview" }), ctx)).json();
    if (!duringTransport) withdraw();
    const result = await post(managerRequest("POST", { ...rewriteValues, review: preview.review, review_confirmed: true }), ctx);
    assert.equal(result.status, 403);
    assert.equal(env.payloads.length, duringTransport ? 1 : 0);
    assert.equal((await result.json()).proposal, undefined);
    assert.equal(env.writes.length, 0);
  }
});

test("minor rewrite choices never permit automatic preparation or reading private note history", async () => {
  const env = setup(minorFixture(), { env: minorEnv }); let reads = 0;
  const result = await env.route("preparation-insights", { "@/lib/server/coachPreparationSources": {
    loadCoachPreparationSources: () => { reads++; throw new Error("No history access"); },
  } }).POST(managerRequest("POST"), ctx);
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).unavailable_player_ids, [player]);
  assert.equal(reads, 0); assert.equal(env.payloads.length, 0);
});

test("another representative's consent does not erase a refusal", async () => {
  const tables = minorFixture();
  tables.legal_decisions.push({ ...tables.legal_decisions[1], id: "earlier-other-parent", actor_id: "other-parent", decision: "refused", decided_at: "2026-09-01T13:00:00Z" });
  const env = setup(tables, { env: minorEnv });
  assert.equal((await env.rewrite()).status, 403);
  assert.equal(env.payloads.length, 0);
});

test("latest choice per representative is evaluated across history pages", async () => {
  const tables = minorFixture();
  for (let i = 0; i < 505; i++) tables.legal_decisions.push({ ...tables.legal_decisions[1], id: `past-${i}`, decided_at: "2026-08-01T12:00:00Z" });
  tables.legal_decisions.push({ ...tables.legal_decisions[1], id: "earlier-other-parent", actor_id: "other-parent", decision: "refused", decided_at: "2026-07-01T12:00:00Z" });
  const env = setup(tables, { env: minorEnv });
  assert.equal((await env.rewrite()).status, 403);
  assert.equal(env.payloads.length, 0);
});

test("ZDR age boundary is exactly the 13th birthday at Swiss midnight; majority stays 18", () => {
  const before = new Date("2026-10-04T21:59:59Z"), after = new Date("2026-10-04T22:00:00Z");
  assert.equal(isCoachAiAtLeast13("2013-10-05", before), false);
  assert.equal(isCoachAiAtLeast13("2013-10-05", after), true);
  assert.equal(isCoachAiAdult("2013-10-05", after), false);
  assert.equal(isCoachAiAtLeast13("2008-10-05", after), true);
  assert.equal(isCoachAiAdult("2008-10-05", after), true);
  for (const invalid of [null, "", "2013-02-30", "2027-01-01", "2013-1-1"]) assert.equal(isCoachAiAtLeast13(invalid, after), false);
  assert.equal(isCoachAiAtLeast13("2013-10-05", new Date("invalid")), false);
});

for (const zdr of ["", "false"]) test(`13–17 rewrite does not require ZDR=${JSON.stringify(zdr)}`, async () => {
  const env = setup(minorFixture(), { env: { ...minorEnv, OPENAI_COACH_ZDR_CONFIRMED: zdr } });
  const result = await env.rewrite(rewriteValues);
  assert.equal(result.status, 200);
  assert.equal(env.payloads.length, 1);
  assert.equal(env.headers[0].get("OpenAI-Project"), "proj_fixture");
  assert.ok(!JSON.stringify(env.payloads).includes("Léon"));
  assert.ok(!JSON.stringify(env.payloads).includes(player));
});

test("under-13 rewrite remains available only through the verified ZDR configuration", async () => {
  const env = setup(minorFixture("2018-01-01"), { env: minorEnv });
  assert.equal((await env.rewrite()).status, 200);
  assert.equal(env.payloads.length, 1);
});

for (const change of ["no-parent", "no-child", "withdrawn", "other-club", "unknown-age"]) test(`13–17 without ZDR still denies ${change}`, async () => {
  const tables = minorFixture();
  if (change === "no-parent") tables.legal_decisions = tables.legal_decisions.filter(d => d.actor_id === player);
  if (change === "no-child") tables.legal_decisions = tables.legal_decisions.filter(d => d.actor_id !== player);
  if (change === "withdrawn") tables.legal_current_state[0].decision = "withdrawn";
  if (change === "other-club") tables.legal_documents[0].club_id = "B";
  if (change === "unknown-age") tables.profiles[0].birth_date = null;
  const env = setup(tables, { env: { ...minorEnv, OPENAI_COACH_ZDR_CONFIRMED: "false" } });
  assert.equal((await env.rewrite()).status, 403);
  assert.equal(env.payloads.length, 0);
});

test("age correction after preview requires a new preview even when ZDR is available", async () => {
  const tables = minorFixture();
  const env = setup(tables, { env: minorEnv });
  const post = env.route("debrief/analyze-player").POST;
  const { preview } = await (await post(managerRequest("POST", { ...rewriteValues, intent: "preview" }), ctx)).json();
  tables.profiles[0].birth_date = "2018-01-01";
  const result = await post(managerRequest("POST", { ...rewriteValues, review: preview.review, review_confirmed: true }), ctx);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "ai_review_required");
  assert.equal(env.payloads.length, 0);
});

test("age correction below 13 during non-ZDR transport discards the answer", async () => {
  const tables = minorFixture();
  const env = setup(tables, { env: { ...minorEnv, OPENAI_COACH_ZDR_CONFIRMED: "false" },
    duringTransport: () => { tables.profiles[0].birth_date = "2018-01-01"; } });
  const result = await env.rewrite();
  assert.equal(result.status, 403);
  assert.equal((await result.json()).proposal, undefined);
  assert.equal(env.payloads.length, 1);
  assert.equal(env.writes.length, 0);
});
