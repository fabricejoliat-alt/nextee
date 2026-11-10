import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, flush, textContent } from "./helpers/coachComponentHarness.ts";
import { managerDatabase } from "./helpers/managerRouteHarness.ts";

for (const mode of ["evaluation", "view"]) {
test(`opening individual training after ${mode} clears the previous activity and unlocks editing`, async () => {
  let query = `club_event_id=event${mode === "view" ? "&mode=view" : ""}`;
  const { db, writes } = managerDatabase({ training_sessions: [] });
  const harness = coachComponentHarness("app/player/golf/trainings/new/PlayerTrainingNewClient.tsx", {
    database: { from: db.from },
    fetch: async () => Response.json({ event: {
      id: "event", event_type: "training", starts_at: "2020-01-01T13:30:00Z",
      location_text: "Previous activity", duration_minutes: 60,
    } }),
    modules: {
      "next/navigation": { useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ replace() {} }) },
      "@/lib/effectivePlayer": { resolveEffectivePlayerContext: async () => ({ effectiveUserId: "milo" }) },
      "@/lib/performanceMode": { isEffectivePlayerPerformanceEnabled: async () => true },
      "@/components/evaluations/EvaluationResponseField": { default: "evaluation-field" },
      "@/components/evaluations/StandardEvaluationIcons": {},
      "@/components/player/PlayerBreadcrumb": { default: "breadcrumb" },
    },
  });
  try {
    harness.render(); await flush();
    assert.ok(textContent(harness.render()).includes(mode === "view" ? "Détail de l’activité" : "Évaluer l’activité"));
    query = "session_type=individual";
    harness.render(); await flush();
    let tree = harness.render();
    const date = elements(tree).find(el => el.type === "input" && el.props.type === "date");
    assert.ok(date, "The new training displays an editable date instead of the previous activity summary");
    assert.equal(date.props.disabled, false);
    date.props.onChange({ target: { value: "2020-02-03" } });
    tree = harness.render();
    assert.equal(elements(tree).find(el => el.type === "input" && el.props.type === "date")?.props.value, "2020-02-03");
    const add = elements(tree).find(el => el.type === "button" && textContent(el).includes("Ajouter un poste"));
    assert.ok(add);
    assert.equal(add.props.disabled, false);
    add.props.onClick();
    tree = harness.render();
    const category = elements(tree).find(el => el.type === "select" && elements(el).some(child => child.props.value === "putting"));
    assert.ok(category, "The individual training structure can be added");
    category.props.onChange({ target: { value: "putting" } });
    assert.equal(elements(harness.render()).find(el => el.type === "select" && elements(el).some(child => child.props.value === "putting"))?.props.value, "putting");
    assert.equal(writes.length, 0, "Opening and editing the new draft does not modify the evaluated activity");
  } finally { harness.cleanup(); }
});
}
