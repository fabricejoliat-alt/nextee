import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase, managerFixture, managerRequest } from "./helpers/managerRouteHarness.ts";

const route = "app/api/manager/clubs/[clubId]/parents/password/route.ts";
const context = { params: Promise.resolve({ clubId: "A" }) };
const payload = { member_id: "parent-A", password: "Fictional-test-password!" };

test("Manager can change an active parent's password using only the club-derived Auth target", async () => {
  const h = managerDatabase(managerFixture());
  const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", {
    ...payload, user_id: "outside", email: "attacker@example.invalid", role: "manager", callerId: "attacker",
  }), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(h.authWrites, [{ id: "parent", patch: { password: payload.password } }]);
  assert.deepEqual(h.writes, []);
});

test("missing authentication, foreign/inactive Managers and non-parent or foreign targets cannot change passwords", async () => {
  for (const mode of ["no-token", "invalid-token", "foreign-manager", "inactive-manager", "foreign-parent", "coach-target", "inactive-parent"]) {
    const tables = managerFixture();
    if (mode === "foreign-manager") tables.club_members[0].club_id = "B";
    if (mode === "inactive-manager") tables.club_members[0].is_active = false;
    if (mode === "foreign-parent") tables.club_members[2].club_id = "B";
    if (mode === "inactive-parent") tables.club_members[2].is_active = false;
    const h = managerDatabase(tables, { caller: mode === "invalid-token" ? null : "manager" });
    const request = managerRequest("POST", {
      ...payload, member_id: mode === "coach-target" ? "target-A" : payload.member_id,
    });
    if (mode === "no-token") request.headers.delete("authorization");
    const response = await loadManagerModule(route, h.mocks).POST(request, context);
    assert.ok([401,403,404].includes(response.status), mode);
    assert.deepEqual(h.authWrites, [], mode); assert.deepEqual(h.writes, [], mode);
  }
});

test("staff roles in any club/organization and platform accounts are protected even when inactive", async () => {
  for (const role of ["platform", "coach", "manager", "org-owner", "org-admin", "org-staff"]) {
    const tables = managerFixture();
    if (role === "platform") tables.app_admins = [{ user_id: "parent" }];
    else if (role.startsWith("org-")) tables.organization_members = [{ user_id: "parent", organization_id: "B", role: role.slice(4), is_active: false }];
    else tables.club_members.push({ id:"staff-B",user_id:"parent",club_id:"B",role,is_active:false });
    const h = managerDatabase(tables);
    assert.equal((await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context)).status, 403, role);
    assert.deepEqual(h.authWrites, [], role);
  }
});

test("platform administrator can manage a multi-role parent but still needs a parent membership in the requested club", async () => {
  const tables = managerFixture(); tables.app_admins = [{ user_id: "manager" }];
  tables.club_members.push({ id:"staff-B",user_id:"parent",club_id:"B",role:"coach",is_active:true });
  const h = managerDatabase(tables);
  const api = loadManagerModule(route, h.mocks);
  assert.equal((await api.POST(managerRequest("POST", payload), context)).status, 200);
  assert.equal((await api.POST(managerRequest("POST", { ...payload, member_id: "outside-B" }), context)).status, 404);
  assert.equal(h.authWrites.length, 1);
});

test("password validation and permission lookup failures make no Auth or profile writes", async () => {
  for (const password of [undefined, null, 12345678, "short", "x".repeat(129)]) {
    const h = managerDatabase(managerFixture());
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", { ...payload, password }), context);
    assert.equal(response.status, 400); assert.deepEqual(h.authWrites, []); assert.deepEqual(h.writes, []);
  }
  for (const failureTable of ["club_members", "app_admins", "organization_members"]) {
    const h = managerDatabase(managerFixture(), { failureTable });
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context);
    assert.equal(response.status, 503); assert.deepEqual(h.authWrites, []);
    assert.doesNotMatch(await response.text(), /Database failure/);
  }
});

test("Auth rejects weak/reused passwords and server errors without returning credentials or internal details", async () => {
  for (const code of ["weak_password", "same_password", "unexpected_failure"]) {
    const h = managerDatabase(managerFixture());
    h.db.auth.admin.updateUserById = async () => ({ error: { code, message: `Private detail ${payload.password}` } }) as never;
    const response = await loadManagerModule(route, h.mocks).POST(managerRequest("POST", payload), context);
    assert.equal(response.status, code === "unexpected_failure" ? 503 : 400);
    assert.deepEqual(await response.json(), { error: code === "unexpected_failure" ? "parent_password_failed" : code });
    assert.deepEqual(h.writes, []);
  }
});
