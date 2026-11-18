import assert from "node:assert/strict";
import test from "node:test";
import { elements, flush, textContent } from "./helpers/coachComponentHarness.ts";
import { legalPageFixture } from "./helpers/legalPageFixture.ts";

test("the parent sees a single list with every organization and child, without duplicate document cards", async () => {
  const fixture = await legalPageFixture();
  try {
    const tree = fixture.h.render();
    assert.equal(elements(tree).filter(node => node.type === "li").length, 9);
    assert.equal(elements(tree).filter(node => node.type === "select").length, 1);
    assert.equal(elements(tree).filter(node => node.props.className === "docCard").length, 0);
    assert.doesNotMatch(textContent(tree), /Documents facultatifs|Consentements facultatifs|Documents requis/);
    assert.equal(elements(tree).find(node => node.type === "button" && textContent(node).includes("Accéder à ActiviTee"))?.props.disabled, true);
    assert.match(textContent(tree), /1 réponse à enregistrer/);
    assert.ok(elements(tree).some(node => node.type === "details" && node.props.className === "historyArchive" && !node.props.open));
  } finally { fixture.cleanup(); }
});

test("answering the last child's consent with a refusal unlocks entry after the saved response is refreshed", async () => {
  const fixture = await legalPageFixture();
  try {
    const pending = elements(fixture.h.render()).find(node => node.type === "button" && textContent(node).includes("Lire et répondre"))!;
    await pending.props.onClick(); await flush();
    let tree = fixture.h.render();
    assert.match(textContent(tree), /Cette décision concerne\s+Enfant two/);
    const refuse = elements(tree).find(node => node.type === "button" && textContent(node) === "Refuser")!;
    await refuse.props.onClick(); await flush(); tree = fixture.h.render();
    assert.deepEqual(fixture.decisions, [{ presentation_id: "presentation", decision: "refused", idempotency_key: fixture.decisions[0]["idempotency_key"], parent_code: "", beneficiary: "two", documentId: "consent-A" }]);
    assert.ok(elements(tree).some(node => node.type === "a" && node.props.href === "/player" && textContent(node).includes("Accéder à ActiviTee")));
    assert.match(textContent(tree), /Toutes les réponses ont été enregistrées/);
    assert.equal(elements(tree).filter(node => node.type === "li").length, 9);
  } finally { fixture.cleanup(); }
});

test("a profile document link opens the selected child's document without deciding for them", async () => {
  const fixture = await legalPageFixture("?document=consent-A&beneficiary=two");
  try {
    await flush();
    const tree = fixture.h.render();
    assert.match(textContent(tree), /Cette décision concerne\s+Enfant two/);
    assert.ok(elements(tree).some(node => node.props.role === "dialog"));
    assert.deepEqual(fixture.decisions, []);
  } finally { fixture.cleanup(); }
});

test("a profile link cannot open a document for another beneficiary", async () => {
  const fixture = await legalPageFixture("?document=consent-A&beneficiary=not-my-child");
  try {
    const tree = fixture.h.render();
    assert.ok(!elements(tree).some(node => node.props.role === "dialog"));
    assert.match(textContent(tree), /Ce document n’est pas disponible pour ce compte/);
    assert.deepEqual(fixture.decisions, []);
  } finally { fixture.cleanup(); }
});
