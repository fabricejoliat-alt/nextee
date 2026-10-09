import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest } from "./helpers/managerRouteHarness.ts";

const route = "app/api/manager/clubs/[clubId]/coaches/password/route.ts";
const context = { params: Promise.resolve({ clubId: "A" }) };
const payload = { member_id: "target-A", password: "Fictional-coach-password!" };

test("Manager can change only an active coach password derived from the selected club membership", async () => {
  const h = managerDatabase(managerFixture());
  const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", {
    ...payload, user_id: "outside", role: "manager", callerId: "attacker",
  }), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(h.authWrites, [{ id: "target", patch: { password: payload.password } }]);
  assert.deepEqual(h.writes, []);
});

test("credential protection uses a column present in organization_members", async () => {
  const h = managerDatabase(managerFixture(), {
    schemaColumns: { organization_members: ["organization_id", "user_id", "role", "is_active"] },
  });
  const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context);
  assert.equal(response.status, 200);
  assert.deepEqual(h.authWrites, [{ id: "target", patch: { password: payload.password } }]);
});

test("missing authentication, foreign Managers and non-coach targets cannot reset a password", async () => {
  for (const mode of ["no-token", "invalid-token", "foreign-manager", "inactive-manager", "foreign-coach", "parent-target", "inactive-coach"]) {
    const tables = managerFixture();
    if (mode === "foreign-manager") tables.club_members[0].club_id = "B";
    if (mode === "inactive-manager") tables.club_members[0].is_active = false;
    if (mode === "foreign-coach") tables.club_members[3].club_id = "B";
    if (mode === "inactive-coach") tables.club_members[3].is_active = false;
    const h = managerDatabase(tables, { caller: mode === "invalid-token" ? null : "manager" });
    const request = managerRequest("POST", { ...payload, member_id: mode === "parent-target" ? "parent-A" : payload.member_id });
    if (mode === "no-token") request.headers.delete("authorization");
    const response = await loadManagerModule(route, h.mocks).POST(request, context);
    assert.ok([401, 403, 404].includes(response.status), mode);
    assert.deepEqual(h.authWrites, [], mode);
  }
});

test("platform and Manager accounts remain protected even if they also coach the selected club", async () => {
  for (const role of ["platform", "club-manager", "org-owner", "org-admin", "org-manager"]) {
    const tables = managerFixture();
    if (role === "platform") tables.app_admins = [{ user_id: "target" }];
    else if (role === "club-manager") tables.club_members.push({ id: "manager-B", user_id: "target", club_id: "B", role: "manager", is_active: false });
    else tables.organization_members = [{ id: "org-role", user_id: "target", organization_id: "B", role: role.slice(4), is_active: false }];
    const h = managerDatabase(tables);
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context);
    assert.equal(response.status, 403, role);
    assert.deepEqual(h.authWrites, [], role);
  }
});

test("invalid inputs and authorization lookup failures cause no Auth writes", async () => {
  for (const password of [undefined, null, 123456789012, "short", "x".repeat(129)]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", { ...payload, password }), context);
    assert.equal(response.status, 400);
    assert.deepEqual(h.authWrites, []);
  }
  for (const failureTable of ["club_members", "app_admins", "organization_members"]) {
    const h = managerDatabase(managerFixture(), { failureTable });
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context);
    assert.equal(response.status, 503);
    assert.deepEqual(h.authWrites, []);
    assert.doesNotMatch(await response.text(), /Database failure/);
  }
});

test("Auth rejection does not disclose password or internal errors", async () => {
  for (const code of ["weak_password", "same_password", "unexpected_failure"]) {
    const h = managerDatabase(managerFixture());
    h.db.auth.admin.updateUserById = async () => ({ error: { code, message: `Private detail ${payload.password}` } }) as never;
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context);
    assert.equal(response.status, code === "unexpected_failure" ? 503 : 400);
    assert.deepEqual(await response.json(), { error: code === "unexpected_failure" ? "coach_password_failed" : code });
  }
});
