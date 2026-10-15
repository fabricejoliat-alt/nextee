import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

type RedirectRoute = { POST: (request: Request) => Promise<Response> };
async function entry(status: string, authorized: boolean, documentsReady = false, rpcFailure = false) {
  const { db, writes } = managerDatabase({
    app_admins: [],
    club_members: [{ user_id: "player", club_id: "club", role: "player", is_active: true, player_consent_status: status }],
    organizations: [{ id: "club", name: "Mon club", is_active: true }],
  }, { caller: "player" });
  db.rpc = (async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "organization_player_authorized");
    assert.deepEqual(args, { p_org: "club", p_player: "player" });
    return { data: authorized, error: rpcFailure ? { message: "Unavailable" } : null };
  }) as unknown as typeof db.rpc;
  const route = loadManagerModule<RedirectRoute>("app/api/auth/redirect/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/server/organizationSummary": { loadOrganizationAccessSummary: async () => [{ organization_id: "club", accessible: authorized && documentsReady }] },
    "@/app/api/player/access": { loadPlayerActorAuthorization: async () => ({ actorRoles: ["player"], guardianLinks: [] }) },
  });
  const response = await route.POST(new Request("https://test.invalid/api/auth/redirect", { method: "POST", headers: { Authorization: "Bearer fixture" } }));
  assert.equal(writes.length, 0, "checking entry must not grant access or record consent");
  return { status: response.status, body: await response.json() };
}

test("adult with conflicting birth date receives a profile warning, not a parental consent request", async () => {
  assert.deepEqual(await entry("adult", false), { status: 200, body: { redirectTo: "/legal/my", consentRequired: false, playerProfileRequired: true, pendingClubNames: [] } });
});
test("personal documents alone never trigger a parental request for an authorized adult or minor", async () => {
  for (const status of ["adult", "granted"]) assert.deepEqual((await entry(status, true)).body,
    { redirectTo: "/legal/my", consentRequired: false, pendingClubNames: [] });
});
test("missing or obsolete parental authorization stays required and names the club", async () => {
  for (const status of ["pending", "granted"]) assert.deepEqual((await entry(status, false)).body,
    { redirectTo: "/legal/my", consentRequired: true, pendingClubNames: ["Mon club"] });
});
test("only complete authorization and personal documents allow Player entry", async () => {
  assert.deepEqual((await entry("adult", true, true)).body, { redirectTo: "/player" });
  assert.equal((await entry("adult", false, false, true)).status, 500);
});
