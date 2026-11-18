import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, elements, textContent, flush, deferred } from "./helpers/coachComponentHarness.ts";

test("generic validation previews render while rules are still loading", async () => {
  const rules = deferred<Response>();
  const requests: string[] = [];
  const sections = [
    { id: "putting", name: "Putting", imageUrl: "/first-putting.jpg", exerciseCount: 12 },
    { id: "approaches", name: "Approches", imageUrl: null, exerciseCount: 1 },
    { id: "irons", name: "Fers", imageUrl: "/first-irons.jpg", exerciseCount: 8 },
    { id: "driving", name: "Driving", imageUrl: null, exerciseCount: 0 },
  ];
  const harness = coachComponentHarness("app/coach/CoachLearningCards.tsx", {
    fetch: async input => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/rules/overview") return rules.promise;
      assert.equal(url, "/api/coach/validations/preview");
      return Response.json({ sections });
    },
    modules: {
      "next/image": { __esModule: true, default: "img" },
      "@/components/etiquette/EtiquetteVisual": { __esModule: true, default: "etiquette-visual" },
      "@/components/rules/RulesVisual": { __esModule: true, default: "rules-visual" },
    },
  });
  try {
    harness.render();
    await flush();
    const tree = harness.render();
    assert.ok(textContent(tree).includes("Putting"));
    assert.ok(textContent(tree).includes("12 exercices"));
    assert.ok(textContent(tree).includes("1 exercice"));
    assert.ok(textContent(tree).includes("0 exercices"));
    const previews = elements(tree).filter(node => node.type === "a" && sections.some(section => textContent(node).includes(section.name)));
    assert.equal(previews.length, 4);
    assert.equal(elements(previews[0]).find(node => node.type === "img")?.props.src, "/first-putting.jpg");
    assert.deepEqual(requests.sort(), ["/api/coach/validations/preview", "/api/rules/overview"].sort());
  } finally {
    harness.cleanup();
    rules.resolve(Response.json({ series: [] }));
    await flush();
  }
});
