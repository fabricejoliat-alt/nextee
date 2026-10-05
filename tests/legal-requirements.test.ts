import assert from "node:assert/strict";
import { test } from "node:test";
import { findMissingLegalActions } from "../lib/legalRequirements.ts";

const terms = { id: "terms", document_key: "terms", kind: "terms", scope: "platform" as const, club_id: null,
  audience_roles: ["parent", "coach"], action_kind: "accept", required: true, active: true };
const clubNotice = { id: "notice", document_key: "notice", kind: "privacy", scope: "club" as const, club_id: "club-a",
  audience_roles: ["coach"], action_kind: "acknowledge", required: true, active: true };
const optionalPhoto = { id: "photo", document_key: "photo", kind: "specific_consent", scope: "club" as const, club_id: "club-a",
  audience_roles: ["parent"], action_kind: "consent", required: false, active: true };

test("one current platform acceptance covers a multi-role adult while a new version requires a fresh decision", () => {
  const base = { memberships: [{ club_id: "club-a", role: "parent" }, { club_id: "club-a", role: "coach" }], isAdmin: false,
    documents: [terms], versions: [{ id: "v2", document_id: "terms", version_number: 2 }, { id: "v1", document_id: "terms", version_number: 1 }],
    states: [{ document_id: "terms", version_id: "v1", club_scope: null, decision: "accepted", conflict: false }] };
  assert.deepEqual(findMissingLegalActions(base).map((x) => x.document_id), ["terms"]);
  assert.equal(findMissingLegalActions({ ...base, states: [{ ...base.states[0], version_id: "v2" }] }).length, 0);
});

test("club scope stays isolated and an optional consent never blocks general access", () => {
  const input = { memberships: [{ club_id: "club-b", role: "coach" }], isAdmin: false,
    documents: [clubNotice, optionalPhoto], versions: [{ id: "n1", document_id: "notice", version_number: 1 }], states: [] };
  assert.deepEqual(findMissingLegalActions(input), []);
  assert.deepEqual(findMissingLegalActions({ ...input, memberships: [{ club_id: "club-a", role: "coach" }] }).map((x) => x.document_id), ["notice"]);
});

test("a refusal or withdrawal cannot satisfy a required document even on the current version", () => {
  const base = { memberships: [{ club_id: "club-a", role: "parent" }], isAdmin: false,
    documents: [terms], versions: [{ id: "v1", document_id: "terms", version_number: 1 }],
    states: [{ document_id: "terms", version_id: "v1", club_scope: null, decision: "refused", conflict: false }] };
  assert.equal(findMissingLegalActions(base).length, 1);
  assert.equal(findMissingLegalActions({ ...base, states: [{ ...base.states[0], decision: "withdrawn" }] }).length, 1);
  assert.equal(findMissingLegalActions({ ...base, states: [{ ...base.states[0], decision: "accepted", conflict: true }] }).length, 1);
});

test("optional refusal, withdrawal and representative conflict never become a global account block", () => {
  for (const decision of ["refused", "withdrawn", "consented"]) {
    const input = { memberships: [{ club_id: "club-a", role: "parent" }], isAdmin: false,
      documents: [optionalPhoto], versions: [{ id: "photo-v1", document_id: "photo", version_number: 1 }],
      states: [{ document_id: "photo", version_id: "photo-v1", club_scope: "club-a", decision, conflict: true }] };
    assert.deepEqual(findMissingLegalActions(input), []);
  }
});
