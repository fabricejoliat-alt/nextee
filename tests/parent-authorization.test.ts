import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";
import { parentAuthorizationItems, type LegalChild } from "../lib/parentAuthorization.ts";

const child = (id: string, club = "A"): LegalChild => ({ child_id: id, club_id: club,
  child_name: `Junior ${id}`, club_name: `Club ${club}`, can_authorize: true,
  representation_verified: false, consent_status: "pending", states: [] });
const document = (club = "A") => ({ id: `doc-${club}`, kind: "parent_authorization", purpose_key: "service.parent_authorization",
  club_id: club, version: { id: `v1-${club}`, version_number: 1,
    snapshot: { translations: { fr: { title: "Utilisation par {{child_name}} auprès de {{club_name}}" } } } } });

test("two children receive separately named documents and independent completion states", () => {
  const first = { ...child("one"), consent_status: "granted", states: [
    { document_id: "doc-A", version_id: "v1-A", decision: "authorized", conflict: false }] };
  const items = parentAuthorizationItems([document()], [first, child("two")], "fr");
  assert.deepEqual(items.map((item) => ({ name: item.title, complete: item.complete, key: item.key })), [
    { name: "Utilisation par Junior one auprès de Club A", complete: true, key: "one:A" },
    { name: "Utilisation par Junior two auprès de Club A", complete: false, key: "two:A" },
  ]);
});

test("another club, a new version, a refusal or conflict never inherits an authorization", () => {
  const signed = { ...child("one"), consent_status: "granted", states: [
    { document_id: "doc-A", version_id: "v1-A", decision: "authorized", conflict: false }] };
  const next = document(); next.version.id = "v2-A";
  assert.equal(parentAuthorizationItems([next], [signed], "fr")[0].complete, false);
  assert.equal(parentAuthorizationItems([document("B")], [{ ...signed, club_id: "B" }], "fr")[0].complete, false);
  for (const state of [{ decision: "refused", conflict: false }, { decision: "authorized", conflict: true }]) {
    assert.equal(parentAuthorizationItems([document()], [{ ...signed, states: [{ ...signed.states[0], ...state }] }], "fr")[0].complete, false);
  }
});

test("linked father is listed for both children without granting verified authority for optional AI", async () => {
  const { db } = managerDatabase({
    player_guardians: ["one", "two", "hidden"].map((id) => ({ player_id: id, guardian_user_id: "parent",
      can_view: id !== "hidden", can_edit: true, relation: "father" })),
    club_members: [{ user_id: "parent", role: "parent", club_id: "A", is_active: true },
      ...["one", "two", "hidden"].map((id) => ({ user_id: id, role: "player", club_id: "A", is_active: true, player_consent_status: "pending" })),
      { user_id: "one", role: "player", club_id: "B", is_active: true, player_consent_status: "pending" }],
    profiles: [{ id: "one", first_name: "Junior", last_name: "One" }, { id: "two", first_name: "Junior", last_name: "Two" }],
    clubs: [{ id: "A", name: "Club A" }], legal_representative_assertions: [], legal_current_state: [],
  });
  const { legalChildren } = loadManagerModule("lib/server/legalChildren.ts", {});
  const result = await legalChildren(db, "parent");
  assert.deepEqual(result.map((row: LegalChild) => [row.child_name, row.club_id, row.can_authorize, row.representation_verified]), [
    ["Junior One", "A", true, false], ["Junior Two", "A", true, false],
  ]);
});

test("read-only, other contacts and revoked legal authority cannot authorize", async () => {
  const { db } = managerDatabase({
    player_guardians: [
      { player_id: "readonly", guardian_user_id: "parent", can_view: true, can_edit: false, relation: "father" },
      { player_id: "other", guardian_user_id: "parent", can_view: true, can_edit: true, relation: "other" },
      { player_id: "revoked", guardian_user_id: "parent", can_view: true, can_edit: true, relation: "father" },
    ],
    club_members: [{ user_id: "parent", role: "parent", club_id: "A", is_active: true },
      ...["readonly", "other", "revoked"].map((id) => ({ user_id: id, role: "player", club_id: "A", is_active: true }))],
    legal_representative_assertions: [{ guardian_id: "parent", child_id: "revoked", club_id: "A", status: "revoked" }],
  });
  const { legalChildren } = loadManagerModule("lib/server/legalChildren.ts", {});
  const result = await legalChildren(db, "parent");
  assert.equal(result.length, 3);
  assert.ok(result.every((row: LegalChild) => row.can_authorize === false));
});
