import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

type RedirectRoute = { POST: (request: Request) => Promise<Response> };

function routeFor(consentStatus: string, role: "player" | "parent" | "manager" = "player", secondClubStatus?: string, env: Record<string, string> = {}) {
  const { db } = managerDatabase({
    club_members: role === "manager" ? [{ user_id: "junior", club_id: "club-a", role: "manager", is_active: true }] : role === "player" ? [{ user_id: "junior", club_id: "club-a", role: "player", is_active: true,
      player_consent_status: consentStatus },
      ...(secondClubStatus ? [{ user_id: "junior", club_id: "club-b", role: "player", is_active: true,
        player_consent_status: secondClubStatus }] : [])] : [
      { user_id: "junior", club_id: "club-a", role: "parent", is_active: true },
      { user_id: "child", club_id: "club-a", role: "player", is_active: true, player_consent_status: consentStatus },
    ],
    app_admins: [],
    clubs: [{ id: "club-a", name: "Golf Club de Sion" }, { id: "club-b", name: "Centre de Performance Valais" }],
    player_guardians: [{ player_id: "child", guardian_user_id: "junior", relation: "father", can_view: true, can_edit: true }],
  });
  const client = { ...db, auth: { getUser: async () => ({ data: { user: { id: "junior" } }, error: null }) } };
  const links = role === "parent" ? [{ playerId: "child", canView: true, canEdit: true, isPrimary: true, createdAt: null }] : [];
  return loadManagerModule<RedirectRoute>("app/api/auth/redirect/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@supabase/supabase-js": { createClient: () => client },
    "@/app/api/player/access": { loadPlayerActorAuthorization: async () => ({ actorRoles: [role], guardianLinks: links }),
      visibleGuardianLinks: () => links },
    "@/lib/playerAccessPolicy": { selectPrimaryApplicationRole: () => role,
      guardianCanEdit: (link: { canView: boolean; canEdit: boolean }) => link.canView && link.canEdit },
    "@/lib/playerConsent": { playerConsentAllowsAccess: (values: string[]) => values.length > 0 && values.every((value) => value === "granted" || value === "adult") },
  }, env);
}

test("a manager reaches Manager when the legacy SUPABASE_URL variable is absent", async () => {
  const route = routeFor("", "manager", undefined, { SUPABASE_URL: "" });
  const response = await route.POST(new Request("https://test.invalid/api/auth/redirect", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/manager" });
});

test("a junior waiting for a parent enters /legal/my with a distinct blocker", async () => {
  const route = routeFor("pending");
  const response = await route.POST(new Request("https://test.invalid/api/auth/redirect", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/legal/my", consentRequired: true,
    pendingClubNames: ["Golf Club de Sion"] });
});

test("a consent at Sion still names the pending CPV authorization", async () => {
  const route = routeFor("granted", "player", "pending");
  const response = await route.POST(new Request("https://test.invalid/api/auth/redirect", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  }));
  assert.deepEqual(await response.json(), { redirectTo: "/legal/my", consentRequired: true,
    pendingClubNames: ["Centre de Performance Valais"] });
});

test("parental authorization already granted routes the junior to Player", async () => {
  const route = routeFor("granted");
  const response = await route.POST(new Request("https://test.invalid/api/auth/redirect", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/player" });
});

test("a parent with a child awaiting authorization enters /legal/my with the child identified", async () => {
  const route = routeFor("pending", "parent");
  const response = await route.POST(new Request("https://test.invalid/api/auth/redirect", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirectTo: "/legal/my", parentConsentRequired: true,
    pendingChildIds: ["child"] });
});
