import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, flush, textContent } from "./helpers/coachComponentHarness.ts";
import { checklistDoc, checklistChild } from "./helpers/legalChecklistFixtures.ts";

test("profile links distinguish own and child responses and use each document's status", async () => {
  const doc = checklistDoc("consent-A", "A");
  const child = checklistChild("two", "A"); child.states = [];
  const h = coachComponentHarness("components/legal/ProfileLegalDocuments.tsx", {
    fetch: async (input, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only");
      return Response.json(String(input).endsWith("documents") ? { documents: [doc] } : { children: [child] });
    },
  });
  try {
    h.render(); await flush(); await flush(); const tree = h.render();
    const links = elements(tree).filter(node => node.type === "a");
    const own = links.find(node => node.props.href === "/legal/my?document=consent-A")!;
    const junior = links.find(node => node.props.href === "/legal/my?document=consent-A&beneficiary=two")!;
    assert.match(textContent(own), /Refusé/);
    assert.match(textContent(junior), /Pour Enfant two.*À répondre/);
    assert.ok(elements(tree).some(node => node.type === "TriangleAlert"));
  } finally { h.cleanup(); }
});
