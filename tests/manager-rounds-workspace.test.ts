import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, elements, textContent } from "./helpers/coachComponentHarness.ts";

const round = { id: "junior-round", start_at: "2025-09-10T12:00:00Z", course_name: "Golf de démonstration", competition_name: "Junior Trophy", tee_name: "Yellow", round_type: "competition", total_score: 72 };
const holes = Array.from({ length: 18 }, (_, index) => ({ round_id: round.id, hole_no: index + 1, par: 4, score: 4, putts: 2, fairway_hit: true }));

test("manager round cards respect the applied period and expand the shared Player scorecard without Player actions", () => {
  let playerReads = 0;
  const h = coachComponentHarness("components/golf/GolfRoundsWorkspace.tsx", {
    props: { readOnly: true, listOnly: true, appliedRange: { from: "2025-09-01", to: "2025-09-30" }, dataset: { rounds: [round, { ...round, id: "outside", start_at: "2025-10-01T12:00:00Z" }], holes, loading: false } },
    fetch: async () => { playerReads++; throw new Error("Unexpected Player request"); },
    inlineComponentNames: ["RoundDetail", "HorizontalScorecard", "RoundPerformanceInsights"],
    modules: {
      "@/lib/useRememberedPeriod": { useRememberedPeriod: () => ({ period: "year", setPeriod() {}, from: "", setFrom() {}, to: "", setTo() {} }) },
      "@/components/ui/ActiviteeEChart": { default: "chart" },
    },
  });
  try {
    let tree = h.render();
    const card = () => elements(tree).find(node => node.type === "button" && node.props["aria-controls"] === `detail-${round.id}`)!;
    assert.ok(card());
    assert.equal(card().props["aria-expanded"], false);
    assert.match(textContent(card()), /Golf de démonstration.*Junior Trophy/);
    assert.ok(!elements(tree).some(node => node.props["aria-controls"] === "detail-outside"));
    assert.ok(!elements(tree).some(node => node.type === "select" && /Cette année/.test(textContent(node))));
    assert.ok(!elements(tree).some(node => node.type === "table"));
    card().props.onClick(); tree = h.render();
    assert.equal(card().props["aria-expanded"], true);
    assert.equal(elements(tree).filter(node => node.type === "table").length, 1);
    assert.match(textContent(tree), /ALLER.*RETOUR.*TOTAL/);
    assert.match(textContent(tree), /Synthèse de performance/);
    assert.equal(elements(tree).filter(node => node.type === "chart").length, 3);
    assert.ok(!elements(tree).some(node => node.type === "a" && String(node.props.href).startsWith("/player/")));
    card().props.onClick(); tree = h.render();
    assert.equal(card().props["aria-expanded"], false);
    assert.ok(!elements(tree).some(node => node.type === "table"));
    assert.equal(playerReads, 0);
  } finally { h.cleanup(); }
});
