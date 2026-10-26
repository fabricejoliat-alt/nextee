import assert from "node:assert/strict";
import test from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";
import { parseJuniorImportRows } from "../lib/managerJuniorImport.ts";
import { messages } from "../lib/i18n/messages.ts";

function fixture() {
  const players = ["first", "sibling", "readonly", "revoked", "other", "ended"];
  const memberships = [{ user_id: "guardian", role: "parent", is_active: true, club_id: "A", organization_id: "A" },
    ...players.map(user_id => ({ user_id, role: "player", is_active: true, club_id: "A", organization_id: "A", player_consent_status: "granted" }))];
  return {
    club_members: memberships, organization_members: memberships,
    player_guardian_scopes: players.map(player_id => ({ player_id, guardian_user_id: "guardian", organization_id: "A", status: player_id === "ended" ? "ended" : "active", can_view: true, can_edit: player_id !== "readonly" })),
    player_guardians: players.map(player_id => ({ player_id, guardian_user_id: "guardian", relation: player_id === "other" ? "other" : "parent" })),
    legal_representative_assertions: [{ guardian_id: "guardian", child_id: "revoked", club_id: "A", status: "revoked" }],
    legal_documents: [{ id: "doc", club_id: "A", active: true, kind: "parent_authorization", purpose_key: "service.parent_authorization" }],
    legal_versions: [{ id: "v1", document_id: "doc", version_number: 1 }],
    legal_current_state: [] as Record<string, unknown>[],
  };
}

test("neutral parent can authorize each scoped child without verified representative status", async () => {
  const { db, writes } = managerDatabase(fixture());
  const { legalChildren } = loadManagerModule("lib/server/legalChildren.ts", {});
  const result = await legalChildren(db, "guardian");
  assert.deepEqual(result.filter((row: { can_authorize: boolean }) => row.can_authorize).map((row: { child_id: string }) => row.child_id), ["first", "sibling"]);
  assert.ok(result.every((row: { representation_verified: boolean }) => !row.representation_verified));
  assert.deepEqual(writes, []);
});

test("neutral parent still needs a separate current decision for each child", async () => {
  const tables = fixture(); const { db, writes } = managerDatabase(tables);
  const { pendingEditableParentChildren } = loadManagerModule("lib/server/parentConsentRequirements.ts", {});
  const links = tables.player_guardians.map(row => ({ playerId: row.player_id, canView: true, canEdit: true, isPrimary: false, createdAt: null }));
  assert.deepEqual(await pendingEditableParentChildren(db, links, "guardian"), ["first", "sibling"]);
  tables.legal_current_state.push({ document_id: "doc", beneficiary_id: "first", club_scope: "A", version_id: "v1", decision: "authorized", conflict: false });
  assert.deepEqual(await pendingEditableParentChildren(db, links, "guardian"), ["sibling"]);
  tables.legal_current_state[0].club_scope = "B";
  assert.deepEqual(await pendingEditableParentChildren(db, links, "guardian"), ["first", "sibling"]);
  assert.deepEqual(writes, []);
});

test("inactive parent membership does not gain access from the neutral relationship", async () => {
  const tables = fixture(); tables.organization_members[0].is_active = false;
  const { db } = managerDatabase(tables);
  const { legalChildren } = loadManagerModule("lib/server/legalChildren.ts", {});
  assert.deepEqual(await legalChildren(db, "guardian"), []);
});

test("all four localized Parent labels round-trip through junior imports", () => {
  for (const locale of ["fr", "en", "de", "it"] as const) {
    const rows = parseJuniorImportRows([{ junior_first_name: "Junior", junior_last_name: "Fixture", junior_birth_date: "2014-01-01",
      parent1_first_name: "Alex", parent1_last_name: "Fixture", parent1_email: "parent@fixtures.invalid",
      parent1_relation: messages[locale]["manager.junior.relation.parent"] }], [], []);
    assert.deepEqual(rows[0].errors, []);
    assert.equal(rows[0].parents[0].relation, "parent");
  }
});
