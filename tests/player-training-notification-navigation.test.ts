import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, flush } from "./helpers/coachComponentHarness.ts";
import { managerDatabase } from "./helpers/managerRouteHarness.ts";

for (const scenario of [
  { name: "existing notification", view: true, saved: true, player: "lea", redirect: true },
  { name: "parent notification", view: true, saved: true, player: "child", redirect: true },
  { name: "activity before player evaluation", view: true, saved: false, player: "lea", redirect: false },
  { name: "dedicated read-only detail", detail: true, view: false, saved: false, player: "lea", redirect: false },
  { name: "dedicated saved detail", detail: true, view: false, saved: true, player: "child", redirect: true },
  { name: "evaluation form", view: false, saved: true, player: "lea", redirect: false },
]) {
  test(`${scenario.name} opens the calendar detail without redirecting evaluation forms`, async () => {
    const navigations: string[] = [];
    const { db, writes } = managerDatabase({
      training_sessions: scenario.saved ? [{ id: "saved-session", user_id: scenario.player, club_event_id: "event", start_at: "2026-10-20T13:30:00Z" }] : [],
    });
    const harness = coachComponentHarness("app/player/golf/trainings/new/PlayerTrainingNewClient.tsx", {
      searchParams: `club_event_id=event&child_id=${scenario.player}${scenario.view ? "&mode=view" : ""}`,
      props: { viewEventId: "detail" in scenario ? "event" : undefined },
      database: { from: db.from },
      fetch: async () => Response.json({ event: { id: "event", event_type: "training", starts_at: "2026-10-20T13:30:00Z" } }),
      modules: {
        "next/navigation": { useSearchParams: () => new URLSearchParams(`club_event_id=event${scenario.view ? "&mode=view" : ""}`), useRouter: () => ({ replace: (href: string) => navigations.push(href) }) },
        "@/lib/effectivePlayer": { resolveEffectivePlayerContext: async () => ({ effectiveUserId: scenario.player }) },
        "@/lib/performanceMode": { isEffectivePlayerPerformanceEnabled: async () => true },
        "@/components/evaluations/EvaluationResponseField": { default: "evaluation-field" },
        "@/components/evaluations/StandardEvaluationIcons": {},
        "@/components/player/PlayerBreadcrumb": { default: "breadcrumb" },
      },
    });
    try {
      harness.render(); await flush();
      const tree = harness.render();
      if (!scenario.redirect) {
        const form = elements(tree).find(element => element.type === "form");
        assert.ok(form, "The activity content is rendered");
        const readOnly = scenario.view || "detail" in scenario;
        assert.equal(form.props["data-swipe-readonly"], readOnly ? "true" : undefined);
        if (readOnly) {
          await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
          assert.equal(writes.length, 0, "Read-only details cannot save an evaluation");
        }
      }
      assert.deepEqual(navigations, scenario.redirect ? [`/player/golf/trainings/saved-session?child_id=${scenario.player}`] : []);
      assert.equal(writes.length, 0, "Opening an evaluation notification must not create or change a training");
    } finally { harness.cleanup(); }
  });
}
