import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

type AuthRoute = { POST: (request: Request) => Promise<Response> };

test("coach login resolves the role without guardian or consent reads", async () => {
  const { db } = managerDatabase({
    app_admins: [],
    club_members: [{ user_id: "coach", club_id: "club", role: "coach", is_active: true }],
  }, { caller: "coach" });
  const readTables: string[] = [];
  const client = { ...db, from: (table: string) => { readTables.push(table); return db.from(table); } };
  const route = loadManagerModule<AuthRoute>("app/api/auth/route.ts", {
    "next/server": { NextResponse: { json: Response.json, next: () => ({ cookies: { set: () => {} } }) } },
    "@supabase/supabase-js": { createClient: () => client },
    "@supabase/ssr": { createServerClient: () => client },
    "@/lib/adminSecurity": { initialPasswordRequired: () => false },
    "@/lib/playerAccessPolicy": { selectPrimaryApplicationRole: (roles: string[]) => roles.includes("coach") ? "coach" : null },
  }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon" });
  const response = await route.POST(new Request("https://test.invalid/api/auth", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  }));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload, { redirectTo: "/coach" });
  assert.deepEqual(readTables.sort(), ["app_admins", "club_members"]);
});

test("username login reads the email directly from Auth", async () => {
  const { db } = managerDatabase({ profiles: [{ id: "coach", username: "coachname" }] }, {
    users: [{ id: "coach", email: "COACH@example.invalid" }],
  });
  const client = { ...db, schema: () => { throw new Error("Auth schema is unavailable through REST"); } };
  const route = loadManagerModule<AuthRoute>("app/api/auth/resolve-login/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@supabase/supabase-js": { createClient: () => client },
  });
  const response = await route.POST(new Request("https://test.invalid/api/auth/resolve-login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "coachname" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { email: "coach@example.invalid" });
});

test("junior consent and parent access keep their login checks", async () => {
  for (const role of ["player", "parent"] as const) {
    const { db } = managerDatabase({
      app_admins: [],
      club_members: [{ user_id: role, role, is_active: true, player_consent_status: "pending" }],
    }, { caller: role });
    const client = { ...db, auth: { ...db.auth, getUser: async () => ({ data: { user: { id: role } }, error: null }) } };
    const route = loadManagerModule<AuthRoute>("app/api/auth/route.ts", {
      "next/server": { NextResponse: { json: Response.json, next: () => ({ cookies: { set: () => {} } }) } },
      "@supabase/supabase-js": { createClient: () => client },
      "@supabase/ssr": { createServerClient: () => client },
      "@/lib/adminSecurity": { initialPasswordRequired: () => false },
      "@/lib/playerConsent": { playerConsentAllowsAccess: () => false },
      "@/lib/playerAccessPolicy": { selectPrimaryApplicationRole: () => role },
      "@/app/api/player/access": { loadPlayerActorAuthorization: async () => ({ guardianLinks: [{ playerId: "child", canView: true }] }), visibleGuardianLinks: (links: unknown[]) => links },
      "@/lib/server/parentConsentRequirements": { pendingEditableParentChildren: async () => ["child"] },
    }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon" });
    const response = await route.POST(new Request("https://test.invalid/api/auth", {
      method: "POST", headers: { Authorization: "Bearer fixture-token" },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), role === "player"
      ? { redirectTo: "/legal/my", consentRequired: true }
      : { redirectTo: "/legal/my", parentConsentRequired: true, pendingChildIds: ["child"] });
  }
});
