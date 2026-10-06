import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

type Link = { playerId: string; canView: boolean; canEdit: boolean; isPrimary: boolean; createdAt: null };
const link = (playerId: string, canEdit = true): Link => ({ playerId, canView: true, canEdit, isPrimary: false, createdAt: null });
const requirement = loadManagerModule<{ pendingEditableParentChildren: (db: unknown, links: Link[]) => Promise<string[]> }>(
  "lib/server/parentConsentRequirements.ts", {});

test("one pending club keeps an editable child's parent authorization open", async () => {
  const { db } = managerDatabase({ club_members: [
    { user_id: "child-a", club_id: "A", role: "player", is_active: true, player_consent_status: "granted" },
    { user_id: "child-a", club_id: "B", role: "player", is_active: true, player_consent_status: "pending" },
    { user_id: "child-b", club_id: "A", role: "player", is_active: true, player_consent_status: "pending" },
    { user_id: "child-c", club_id: "A", role: "player", is_active: true, player_consent_status: "granted" },
  ] });
  assert.deepEqual(await requirement.pendingEditableParentChildren(db, [link("child-a"), link("child-b", false), link("child-c")]), ["child-a"]);
});

test("an inactive child or a read-only guardian link cannot trap the parent", async () => {
  const { db } = managerDatabase({ club_members: [
    { user_id: "child-a", club_id: "A", role: "player", is_active: false, player_consent_status: "pending" },
  ] });
  assert.deepEqual(await requirement.pendingEditableParentChildren(db, [link("child-a"), link("child-b", false)]), []);
});

test("authorizing one child leaves the sibling pending on the current document", async () => {
  const tables = {
    club_members: ["child-a", "child-b"].map((user_id) => ({ user_id, club_id: "A", role: "player", is_active: true, player_consent_status: "granted" })),
    legal_documents: [{ id: "doc", club_id: "A", active: true, kind: "parent_authorization", purpose_key: "service.parent_authorization" }],
    legal_versions: [{ id: "v2", document_id: "doc", version_number: 2 }],
    legal_current_state: [
      { beneficiary_id: "child-a", club_scope: "A", document_id: "doc", version_id: "v2", decision: "authorized", conflict: false },
      { beneficiary_id: "child-b", club_scope: "A", document_id: "doc", version_id: "v1", decision: "authorized", conflict: false },
    ],
  };
  const { db } = managerDatabase(tables);
  assert.deepEqual(await requirement.pendingEditableParentChildren(db, [link("child-a"), link("child-b")]), ["child-b"]);
  tables.legal_current_state[1].version_id = "v2";
  assert.deepEqual(await requirement.pendingEditableParentChildren(db, [link("child-a"), link("child-b")]), []);
});
