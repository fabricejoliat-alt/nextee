import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, flush } from "./helpers/coachComponentHarness.ts";

const page = "app/coach/groups/[id]/planning/[eventId]/debrief/page.tsx";

for (const scenario of [
  { target: "selected", completeGroup: false, expected: "selected" },
  { target: "selected", completeGroup: true, expected: "selected" },
  { target: "", completeGroup: false, expected: "unfinished" },
  { target: "", completeGroup: true, expected: undefined },
  { target: "unavailable", completeGroup: false, expected: undefined },
]) {
  test(`entry for ${scenario.target || "group"}, complete=${scenario.completeGroup}`, async () => {
    const harness = coachComponentHarness(page, {
      params: { id: "group", eventId: "event" },
      searchParams: scenario.target ? `playerId=${scenario.target}` : "",
      modules: { "next/image": { default: "img" }, "@/components/coach/CoachActivityDocuments": { default: "documents" } },
      fetch: async () => Response.json({
        event: { club_id: "club", starts_at: "2026-01-01T10:00:00Z" },
        attendees: ["selected", "unfinished"].map(player_id => ({
          player_id, profile: { first_name: player_id },
          coach_recorded_status: player_id === "selected" || scenario.completeGroup ? "absent" : null,
        })),
      }),
    });
    try {
      harness.render();
      await flush();
      const nodes = elements(harness.render());
      assert.equal(nodes.find(node => node.type === "documents")?.props.playerId, scenario.expected);
      assert.equal(nodes.some(node => node.props.id === "evaluation-finished-title"), !scenario.target && scenario.completeGroup);
      if (scenario.target === "unavailable") assert.ok(nodes.some(node => node.props.role === "alert"));
    } finally { harness.cleanup(); }
  });
}
