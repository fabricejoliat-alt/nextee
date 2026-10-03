import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest, type Row } from "./helpers/managerRouteHarness.ts";

const membersPath = "app/api/manager/clubs/[clubId]/members/route.ts";
const createPath = "app/api/admin/clubs/[clubId]/create-member/route.ts";
const guardiansPath = "app/api/manager/clubs/[clubId]/guardians/route.ts";
const consentPath = "app/api/manager/clubs/[clubId]/players/[playerId]/consent/route.ts";
const groupsPath = "app/api/admin/organizations/[organizationId]/group-assignments/route.ts";
const clubContext = { params: Promise.resolve({ clubId: "A" }) };

test("a multi-role Manager retains access, while inactive and foreign Managers cannot mutate", async () => {
  for (const mode of ["multi", "inactive", "foreign"] as const) {
    const tables = managerFixture();
    if (mode === "multi") tables.club_members.push({ id: "extra", user_id: "manager", club_id: "A", role: "parent", is_active: true });
    if (mode === "inactive") tables.club_members[0].is_active = false;
    if (mode === "foreign") tables.club_members[0].club_id = "B";
    const h = managerDatabase(tables);
    const route = loadManagerModule(membersPath, h.mocks);
    const response = await route.PATCH(managerRequest("PATCH", { memberId: "target-A", first_name: "Updated" }), clubContext);
    assert.equal(response.status, mode === "multi" ? 200 : 403);
    if (mode !== "multi") assert.deepEqual(h.writes, []);
  }
});

test("credential, role and protected-account refusals happen before any profile or membership write", async () => {
  for (const payload of [{ auth_password: "arbitrary-password" }, { auth_email: "other@example.invalid" }, { role: "player" }, { first_name: "Changed", protected: true }]) {
    const tables = managerFixture();
    if ("protected" in payload) tables.app_admins = [{ user_id: "target" }];
    const h = managerDatabase(tables);
    const response = await loadManagerModule(membersPath, h.mocks).PATCH(managerRequest("PATCH", {
      memberId: "target-A", is_active: false, first_name: "Should not persist", ...payload,
    }), clubContext);
    assert.equal(response.status, 403);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.authWrites, []);
  }
});

test("legacy forms sending unchanged credentials can still save, without Auth writes", async () => {
  const h = managerDatabase(managerFixture());
  const response = await loadManagerModule(membersPath, h.mocks).PATCH(managerRequest("PATCH", {
    memberId: "target-A", auth_email: "TARGET@example.invalid", auth_password: "", phone: "updated",
  }), clubContext);
  assert.equal(response.status, 200);
  assert.deepEqual(h.authWrites, []);
  assert.equal(h.writes.find((entry) => entry.table === "profiles")?.values.phone, "updated");
});

test("platform administrator can still manage credentials through the shared endpoint", async () => {
  const tables = managerFixture(); tables.app_admins = [{ user_id: "manager" }];
  const h = managerDatabase(tables);
  const response = await loadManagerModule(membersPath, h.mocks).PATCH(managerRequest("PATCH", {
    memberId: "target-A", auth_password: "new-test-password",
  }), clubContext);
  assert.equal(response.status, 200);
  assert.deepEqual(h.authWrites, [{ id: "target", patch: { password: "new-test-password" } }]);
});

test("an existing foreign account cannot be attached, including beyond the first Auth page", async () => {
  for (const offset of [0, 200]) {
    const users = Array.from({ length: offset }, (_, index) => ({ id: `user-${index}`, email: `user-${index}@example.invalid` }));
    users.push({ id: "foreign", email: "existing@example.invalid" });
    const h = managerDatabase(managerFixture(), { users });
    const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
      role: "parent", email: "existing@example.invalid", first_name: "Parent", last_name: "Test",
    }), clubContext);
    assert.equal(response.status, 409);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.authWrites, []);
    assert.deepEqual(h.authPages, offset ? [1, 2] : [1]);
  }
});

test("AVS matching does not bypass the existing-account attachment boundary", async () => {
  const tables = managerFixture(); tables.profiles.push({ id: "foreign", avs_no: "test-identity" });
  const h = managerDatabase(tables);
  const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
    role: "player", avs_no: "test-identity", first_name: "Test", last_name: "Junior",
  }), clubContext);
  assert.equal(response.status, 409);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.authWrites, []);
});

test("reusing an existing club member preserves the global profile and returns no password", async () => {
  const h = managerDatabase(managerFixture());
  const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
    role: "coach", email: "target@example.invalid", first_name: "Replacement", last_name: "Test",
  }), clubContext);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tempPassword, null);
  assert.equal(h.writes.some((entry) => entry.table === "profiles"), false);
  assert.deepEqual(h.authWrites, []);
});

test("an active club member can also become a parent without changing their profile, credentials or existing roles", async () => {
  for (const roles of [["coach"], ["manager"], ["player"], ["coach", "manager"], ["parent"]]) {
    const tables = managerFixture();
    tables.club_members = tables.club_members.filter(row => row.user_id !== "target");
    for (const role of roles) tables.club_members.push({ id: `target-${role}`, user_id: "target", club_id: "A", role, is_active: true });
    const h = managerDatabase(tables);
    const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
      role: "parent", email: "TARGET@example.invalid", first_name: "Must not replace", last_name: "Existing profile", phone: "Must not replace",
    }), clubContext);
    assert.equal(response.status, 200, roles.join(","));
    const body = await response.json();
    assert.equal(body.user.id, "target");
    assert.equal(body.username, "coach");
    assert.equal(body.tempPassword, null);
    assert.deepEqual(h.authWrites, []);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].table, "club_members");
    assert.equal(h.writes[0].method, "upsert");
    assert.equal(h.writes[0].values.role, "parent");
    assert.equal(h.writes[0].values.club_id, "A");
    assert.equal(h.writes[0].values.user_id, "target");
  }
});

test("adding parental access does not bypass inactive, foreign or platform-account boundaries", async () => {
  for (const scope of ["inactive", "foreign", "platform"] as const) {
    const tables = managerFixture();
    const target = tables.club_members.find(row => row.id === "target-A")!;
    if (scope === "inactive") target.is_active = false;
    if (scope === "foreign") target.club_id = "B";
    if (scope === "platform") tables.app_admins = [{ user_id: "target" }];
    const h = managerDatabase(tables);
    const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
      role: "parent", email: "target@example.invalid", first_name: "Test", last_name: "Parent",
    }), clubContext);
    assert.equal(response.status, 409, scope);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.authWrites, []);
  }
});

test("parent role reuse does not authorize promotion to coach or manager", async () => {
  for (const role of ["coach", "manager"]) {
    const tables = managerFixture();
    tables.club_members.find(row => row.id === "target-A")!.role = "parent";
    const h = managerDatabase(tables);
    const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
      role, email: "target@example.invalid", first_name: "Test", last_name: "Parent",
    }), clubContext);
    assert.equal(response.status, 409);
    assert.deepEqual(h.writes, []);
  }
});

test("parent account creation validates the target junior before changing any membership", async () => {
  for (const playerId of ["outside", "target"]) {
    const tables = managerFixture();
    if (playerId === "target") tables.club_members.find(row => row.id === "target-A")!.role = "player";
    const h = managerDatabase(tables);
    const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
      role: "parent", player_id: playerId, email: "target@example.invalid", first_name: "Test", last_name: "Parent",
    }), clubContext);
    assert.equal(response.status, playerId === "outside" ? 404 : 400);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.authWrites, []);
  }
});

test("parent attachment preview follows the same club boundary as creation", async () => {
  for (const club of ["A", "B"]) {
    const tables = managerFixture();
    tables.club_members.find(row => row.id === "target-A")!.club_id = club;
    const h = managerDatabase(tables);
    const response = await loadManagerModule("app/api/admin/clubs/[clubId]/add-existing-member-preview/route.ts", h.mocks)
      .POST(managerRequest("POST", { user_id: "target", role: "parent" }), clubContext);
    assert.equal(response.status, club === "A" ? 200 : 409);
    assert.deepEqual(h.writes, []);
  }
});

test("the legacy one-role constraint returns an actionable migration error without replacing the existing role", async () => {
  const h = managerDatabase(managerFixture());
  const from = h.db.from.bind(h.db);
  h.db.from = (table: string) => {
    const query = from(table);
    if (table === "club_members") query.upsert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "club_members_unique_club_user"' } }) }) }) as unknown as typeof query;
    return query;
  };
  const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
    role: "parent", player_id: "player", email: "target@example.invalid", first_name: "Test", last_name: "Parent",
  }), clubContext);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "MEMBERSHIP_ROLES_MIGRATION_REQUIRED");
  assert.match(body.error, /mise à jour/);
  assert.doesNotMatch(body.error, /club_members|duplicate key/);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.authWrites, []);
});

test("new-member creation remains available and initializes the new profile", async () => {
  const h = managerDatabase(managerFixture(), { users: [] });
  const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
    role: "coach", email: "new@example.invalid", first_name: "New", last_name: "Coach",
  }), clubContext);
  assert.equal(response.status, 200);
  assert.equal(h.authWrites.length, 1);
  assert.equal(h.writes.find((entry) => entry.table === "profiles")?.values.first_name, "New");
});

test("guardian APIs reject a foreign player or a foreign parent without writes or RPC calls", async () => {
  for (const [method, player, parent] of [["POST", "outside", "parent"], ["DELETE", "outside", "parent"], ["POST", "player", "foreign-parent"]]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(guardiansPath, h.mocks)[method](managerRequest(method, {
      player_id: player, guardian_user_id: parent, is_primary: true,
    }), clubContext);
    assert.equal(response.status, 404);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.rpcs, []);
  }
});

test("authorized guardian changes use one transaction and a server-derived actor", async () => {
  for (const method of ["POST", "DELETE"]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(guardiansPath, h.mocks)[method](managerRequest(method, {
      player_id: "player", guardian_user_id: "parent", is_primary: true, callerId: "attacker", p_actor_id: "attacker",
    }), clubContext);
    assert.equal(response.status, 200);
    assert.equal(h.rpcs.length, 1);
    assert.equal(h.rpcs[0].name, "manage_player_guardian_v1");
    assert.equal(h.rpcs[0].args.p_actor_id, "manager");
    assert.equal(h.rpcs[0].args.p_action, method === "POST" ? "upsert" : "delete");
    assert.deepEqual(h.writes, []);
  }
});

test("missing guardian migration fails closed without a destructive fallback", async () => {
  const h = managerDatabase(managerFixture(), { rpcError: { code: "PGRST202", message: "Private schema details" } });
  const response = await loadManagerModule(guardiansPath, h.mocks).POST(managerRequest("POST", {
    player_id: "player", guardian_user_id: "parent", is_primary: true,
  }), clubContext);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Private schema/);
  assert.deepEqual(h.writes, []);
});

test("consent rejects foreign and inactive juniors before any mutation", async () => {
  for (const inactive of [false, true]) {
    const tables = managerFixture(); if (inactive) tables.club_members[1].is_active = false;
    const h = managerDatabase(tables);
    const response = await loadManagerModule(consentPath, h.mocks).PUT(managerRequest("PUT", { status: "granted" }), {
      params: Promise.resolve({ clubId: "A", playerId: inactive ? "player" : "outside" }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.rpcs, []);
  }
});

test("Manager consent cannot impersonate the parent portal and saves through one transaction", async () => {
  for (const source of ["parent_portal", "manager"]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(consentPath, h.mocks).PUT(managerRequest("PUT", { status: "granted", source, updated_by: "attacker" }), {
      params: Promise.resolve({ clubId: "A", playerId: "player" }),
    });
    assert.equal(response.status, source === "manager" ? 200 : 400);
    assert.equal(h.rpcs.length, source === "manager" ? 1 : 0);
    if (h.rpcs.length) assert.equal(h.rpcs[0].args.p_actor_id, "manager");
    assert.deepEqual(h.writes, []);
  }
});

test("group transfers reject both an unauthorized source and an unauthorized target member before mutation", async () => {
  for (const [actorType, userId, fromGroupId] of [["coach", "target", "group-B"], ["player", "player", "group-B"], ["coach", "foreign", ""]]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(groupsPath, h.mocks).POST(managerRequest("POST", {
      actorType, userId, toGroupId: "group-A", fromGroupId, removeFromSource: true,
    }), { params: Promise.resolve({ organizationId: "A" }) });
    assert.equal(response.status, 404);
    assert.deepEqual(h.writes, []);
  }
});

test("authorized coach assignment within the club remains possible", async () => {
  const h = managerDatabase(managerFixture());
  const response = await loadManagerModule(groupsPath, h.mocks).POST(managerRequest("POST", {
    actorType: "coach", userId: "target", toGroupId: "group-A", removeFromSource: false,
  }), { params: Promise.resolve({ organizationId: "A" }) });
  assert.equal(response.status, 200);
  assert.equal(h.writes.some((entry) => entry.table === "coach_group_coaches"), true);
});

test("report recipients are checked against current links, active roles and consent", async () => {
  for (const state of ["allowed", "revoked", "deleted", "parent-inactive", "player-inactive", "consent-refused", "consent-pending", "database-failure"]) {
    const tables = managerFixture();
    if (state === "revoked") tables.player_guardians[0].can_view = false;
    if (state === "deleted") tables.player_guardians = [];
    if (state === "parent-inactive") tables.club_members[2].is_active = false;
    if (state === "player-inactive") tables.club_members[1].is_active = false;
    if (state.startsWith("consent-")) tables.club_members[1].player_consent_status = state.slice(8);
    const h = managerDatabase(tables, { failureTable: state === "database-failure" ? "player_guardians" : undefined });
    const { authorizedReportRecipients } = loadManagerModule("lib/server/periodicReportAccess.ts", h.mocks);
    if (state === "database-failure") await assert.rejects(() => authorizedReportRecipients(h.db, "A", "player", ["parent"]));
    else assert.deepEqual(await authorizedReportRecipients(h.db, "A", "player", ["parent"]), state === "allowed" ? ["parent"] : []);
    assert.deepEqual(h.writes, []);
  }
});

function reportFixture() {
  const tables = managerFixture();
  tables.club_events = [1, 2, 3].map((n) => ({ id: `event-${n}`, club_id: "A", starts_at: "2026-09-15T10:00:00Z", status: "completed", event_type: "training" }));
  tables.club_event_attendees = tables.club_events.map((row) => ({ event_id: row.id, player_id: "player", status: "present" }));
  tables.club_event_coach_feedback = tables.club_events.map((row) => ({ event_id: row.id, player_id: "player", visible_to_player: false, engagement: 6, attitude: 5, performance: 4 }));
  return tables;
}

test("family reports omit hidden and incomplete evaluations, but retain published complete scores", async () => {
  for (const state of ["hidden", "incomplete", "published"]) {
    const tables = reportFixture();
    for (const feedback of tables.club_event_coach_feedback) {
      feedback.visible_to_player = state !== "hidden";
      if (state === "incomplete") feedback.performance = null;
    }
    const h = managerDatabase(tables);
    const { buildPeriodicReportContent } = loadManagerModule("lib/periodicReportContent.ts", h.mocks);
    const result = await buildPeriodicReportContent(h.db, { club_id: "A", player_user_id: "player", frequency: "monthly", locale: "fr" }, { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(result.sections.evaluations, state === "published" ? { sample: 3, engagement: 6, attitude: 5, application: 4 } : null);
  }
});

test("cron sends only to currently authorized parents and stops on a rights lookup failure", async () => {
  for (const state of ["allowed", "revoked", "failure"]) {
    const tables = reportFixture();
    tables.player_periodic_report_configs = [{ club_id: "A", player_user_id: "player", recipient_user_ids: ["parent"], is_enabled: true, next_send_at: "2020-01-01", frequency: "monthly", locale: "fr", send_day: 5 }];
    if (state === "revoked") tables.player_guardians[0].can_view = false;
    const h = managerDatabase(tables, { users: [{ id: "parent", email: "parent@example.invalid" }], failureTable: state === "failure" ? "player_guardians" : undefined });
    const mails: Row[] = [];
    const route = loadManagerModule("app/api/cron/periodic-reports/route.ts", {
      ...h.mocks, fetch: async (_url: string, options: { body: string }) => { mails.push(JSON.parse(options.body)); return Response.json({ messageId: "sent" }); },
    });
    const response = await route.GET(managerRequest("GET"));
    assert.equal(response.status, state === "failure" ? 503 : 200);
    assert.equal(mails.length, state === "allowed" ? 1 : 0);
    if (state !== "allowed") assert.deepEqual(h.writes, []);
  }
});

test("a revocation during report generation blocks the actual mail dispatch", async () => {
  const tables = reportFixture();
  tables.player_periodic_report_configs = [{ club_id: "A", player_user_id: "player", recipient_user_ids: ["parent"], is_enabled: true, next_send_at: "2020-01-01", frequency: "monthly", locale: "fr", send_day: 5 }];
  const h = managerDatabase(tables, { users: [{ id: "parent", email: "parent@example.invalid" }] });
  let sent = 0;
  const response = await loadManagerModule("app/api/cron/periodic-reports/route.ts", {
    ...h.mocks,
    "@/lib/periodicReportContent": { buildPeriodicReportContent: async () => {
      tables.player_guardians[0].can_view = false;
      return { playerName: "Junior", clubName: "Club A", summary: "Private report", periodLabel: "September" };
    } },
    fetch: async () => { sent++; return Response.json({ messageId: "unexpected" }); },
  }).GET(managerRequest("GET"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).failed, 1);
  assert.equal(sent, 0);
});

test("consent transaction failures never fall back to the former sequence of separate writes", async () => {
  for (const [code, status] of [["42501", 403], ["P0002", 404], ["PGRST202", 503]]) {
    const h = managerDatabase(managerFixture(), { rpcError: { code, message: "Private SQL details" } });
    const response = await loadManagerModule(consentPath, h.mocks).PUT(managerRequest("PUT", { status: "granted", source: "manager" }), {
      params: Promise.resolve({ clubId: "A", playerId: "player" }),
    });
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /Private SQL/);
    assert.deepEqual(h.writes, []);
  }
});

test("platform accounts cannot be reused by Managers even when already present in their club", async () => {
  const tables = managerFixture(); tables.app_admins = [{ user_id: "target" }];
  const h = managerDatabase(tables);
  const response = await loadManagerModule(createPath, h.mocks).POST(managerRequest("POST", {
    role: "coach", email: "target@example.invalid", first_name: "Test", last_name: "Coach",
  }), clubContext);
  assert.equal(response.status, 409);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.authWrites, []);
});

test("legacy attachment and preview endpoints cannot bypass the account boundary", async () => {
  for (const endpoint of ["add-existing-member", "add-existing-member-preview"]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(`app/api/admin/clubs/[clubId]/${endpoint}/route.ts`, h.mocks).POST(
      managerRequest("POST", { user_id: "outside", role: "manager" }), clubContext,
    );
    assert.equal(response.status, 409);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.authWrites, []);
  }
});
