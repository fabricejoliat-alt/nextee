import assert from "node:assert/strict";
import test from "node:test";
import { buildLegalChecklist } from "../lib/legalChecklist.ts";
import { checklistDoc, checklistChild } from "./helpers/legalChecklistFixtures.ts";


test("one list covers the parent's decisions and every child separately in each organization", () => {
  const docs = [checklistDoc("terms", null, "terms"), ...["A", "B"].flatMap(club => [
    checklistDoc(`authorization-${club}`, club, "parent_authorization"), checklistDoc(`consent-${club}`, club)])];
  const children = [checklistChild("one", "A"), checklistChild("two", "A"), checklistChild("one", "B")];
  const items = buildLegalChecklist(docs, children, "fr");
  assert.equal(items.length, 9);
  assert.equal(new Set(items.map(item => item.key)).size, 9);
  assert.ok(items.every(item => item.complete));
  children[1].states = children[1].states.filter(state => state.document_id !== "consent-A");
  assert.deepEqual(buildLegalChecklist(docs, children, "fr").filter(item => !item.complete).map(item => item.key), ["consent-A:two"]);
});

test("a platform consent appears once per child even when the child belongs to two organizations", () => {
  const docs = [checklistDoc("global", null)];
  const items = buildLegalChecklist(docs, [checklistChild("one", "A"), checklistChild("one", "B")], "fr")
    .filter(item => item.doc?.id === "global");
  assert.deepEqual(items.map(item => item.key), ["global:self", "global:one"]);
});

test("a new consent version needs a response; refusal and withdrawal still count as responses", () => {
  const doc = checklistDoc("consent", "A");
  for (const decision of ["consented", "refused", "withdrawn"]) {
    doc.state = { version_id: "v-consent", decision, conflict: true };
    assert.equal(buildLegalChecklist([doc], [], "fr")[0].complete, true);
  }
  doc.version!.id = "new-version";
  assert.equal(buildLegalChecklist([doc], [], "fr")[0].complete, false);
  const terms = checklistDoc("terms", null, "terms"); terms.state!.decision = "refused";
  assert.equal(buildLegalChecklist([terms], [], "fr")[0].complete, false);
});

test("child-only templates have no impossible personal action, and authority remains necessary", () => {
  const doc = checklistDoc("consent-A", "A");
  doc.version!.snapshot.translations!.fr.title = "Accord pour {{child_name}} auprès de {{club_name}}";
  const child = { ...checklistChild("one", "A"), representation_verified: false };
  const items = buildLegalChecklist([doc], [child], "fr").filter(item => item.doc?.id === doc.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Accord pour Enfant one auprès de Organisation A");
  assert.equal(items[0].actionable, false);
});

test("the junior's own rewrite response is never replaced by a parent's decision", () => {
  const doc = { ...checklistDoc("rewrite", "A"), purpose_key: "coaching.rewrite", eligible_role: "player" };
  assert.equal(buildLegalChecklist([doc], [], "fr")[0].complete, false);
  doc.own_choice = { version_id: "v-rewrite", decision: "refused" };
  assert.equal(buildLegalChecklist([doc], [], "fr")[0].complete, true);
});
