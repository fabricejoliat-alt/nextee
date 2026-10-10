import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest } from "./helpers/managerRouteHarness.ts";

const route = "app/api/manager/clubs/[clubId]/accounts/password/route.ts";
const context = { params: Promise.resolve({ clubId: "A" }) };
const password = "Fictional-member-password!";

test("Manager can set the password of an active junior or same-club manager", async () => {
  for (const role of ["player", "manager"] as const) {
    const tables = managerFixture();
    if (role === "manager") {
      tables.club_members.push({ id: "peer-A", user_id: "peer", club_id: "A", role: "manager", is_active: true });
      tables.organization_members = [{ user_id: "peer", organization_id: "A", role: "manager" }];
    }
    const h = managerDatabase(tables);
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", {
      member_id: role === "player" ? "player-A" : "peer-A", role, password, user_id: "outside",
    }), context);
    assert.equal(response.status, 200, role);
    assert.deepEqual(h.authWrites, [{ id: role === "player" ? "player" : "peer", patch: { password } }]);
    assert.deepEqual(h.writes, []);
  }
});

test("foreign, inactive and wrong-role memberships never resolve to an Auth write", async () => {
  for (const mode of ["foreign", "inactive", "wrong-role", "unauthorized"]) {
    const tables = managerFixture();
    if (mode === "foreign") tables.club_members[1].club_id = "B";
    if (mode === "inactive") tables.club_members[1].is_active = false;
    const h = managerDatabase(tables, { caller: mode === "unauthorized" ? null : "manager" });
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", {
      member_id: "player-A", role: mode === "wrong-role" ? "manager" : "player", password,
    }), context);
    assert.ok([401, 403, 404].includes(response.status), mode);
    assert.deepEqual(h.authWrites, [], mode);
  }
});

test("platform, staff and cross-organization rights protect the global password", async () => {
  for (const mode of ["platform", "coach", "org-admin", "other-manager"]) {
    const tables = managerFixture();
    if (mode === "platform") tables.app_admins = [{ user_id: "player" }];
    if (mode === "coach") tables.club_members.push({ id: "coach-B", user_id: "player", club_id: "B", role: "coach", is_active: true });
    if (mode === "org-admin") tables.organization_members = [{ user_id: "player", organization_id: "A", role: "admin" }];
    if (mode === "other-manager") tables.organization_members = [{ user_id: "player", organization_id: "B", role: "manager" }];
    const h = managerDatabase(tables);
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", { member_id: "player-A", role: "player", password }), context);
    assert.equal(response.status, 403, mode);
    assert.deepEqual(h.authWrites, [], mode);
  }
});

test("a Manager cannot take over a Manager with another club or elevated organization role", async () => {
  for (const mode of ["other-club", "owner", "admin", "platform"]) {
    const tables = managerFixture();
    tables.club_members.push({ id: "peer-A", user_id: "peer", club_id: "A", role: "manager", is_active: true });
    if (mode === "other-club") tables.club_members.push({ id: "peer-B", user_id: "peer", club_id: "B", role: "manager", is_active: true });
    if (mode === "owner" || mode === "admin") tables.organization_members = [{ user_id: "peer", organization_id: "A", role: mode }];
    if (mode === "platform") tables.app_admins = [{ user_id: "peer" }];
    const h = managerDatabase(tables);
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", { member_id: "peer-A", role: "manager", password }), context);
    assert.equal(response.status, 403, mode);
    assert.deepEqual(h.authWrites, [], mode);
  }
});

test("invalid passwords and database or Auth failures do not expose secrets", async () => {
  for (const invalid of ["short", "x".repeat(129)]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", { member_id: "player-A", role: "player", password: invalid }), context);
    assert.equal(response.status, 400);
    assert.deepEqual(h.authWrites, []);
  }
  const h = managerDatabase(managerFixture(), { failureTable: "organization_members" });
  const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", { member_id: "player-A", role: "player", password }), context);
  assert.equal(response.status, 503);
  assert.deepEqual(h.authWrites, []);
  assert.doesNotMatch(await response.text(), /Fictional-member|Database failure/);
  const rejected = managerDatabase(managerFixture());
  rejected.db.auth.admin.updateUserById = async () => ({ error: { code: "unexpected_failure", message: password } }) as never;
  const authResponse = await loadManagerModule(route, rejected.mocks).POST(managerRequest("POST", { member_id: "player-A", role: "player", password }), context);
  assert.equal(authResponse.status, 503);
  assert.deepEqual(await authResponse.json(), { error: "password_failed" });
});
