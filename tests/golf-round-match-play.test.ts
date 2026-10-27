import test from "node:test";
import assert from "node:assert/strict";
import { golfRoundPresentation } from "../lib/golfRoundPresentation.ts";
import { coachComponentHarness, elements, textContent } from "./helpers/coachComponentHarness.ts";

const base = { start_at: "2026-10-27T12:00:00Z", round_type: "competition", course_name: "Sion", competition_name: "Test", om_competition_format: "match_play_individual" };
const holes = Array.from({ length: 9 }, (_, index) => ({ hole_no: index + 1, par: 4, score: 4 }));

test("match play completion follows the result, independently of hole scores", () => {
  for (const result of ["won", "lost"] as const) assert.equal(golfRoundPresentation({ ...base, om_match_result: result }, []).complete, true);
  assert.equal(golfRoundPresentation({ ...base, om_match_result: null }, holes).complete, false);
  assert.equal(golfRoundPresentation({ om_competition_format: "stroke_play_individual" }, holes).complete, true);
  assert.equal(golfRoundPresentation({ om_competition_format: "stroke_play_individual" }, []).complete, false);
});

test("cards show match play and its result; the completed filter includes wins and losses", () => {
  const harness = coachComponentHarness("components/golf/GolfRoundsWorkspace.tsx", {
    props: { readOnly: true, dataset: { loading: false, holes: [], rounds: [
      { ...base, id: "won", om_match_result: "won", match_score_text: "2 & 1" },
      { ...base, id: "lost", om_match_result: "lost" },
      { ...base, id: "pending", om_match_result: null },
    ] } },
    fetch: async () => { throw new Error("External dataset must not fetch"); },
    modules: {
      "@/lib/useRememberedPeriod": { useRememberedPeriod: () => ({ period: "all", setPeriod() {}, from: "", setFrom() {}, to: "", setTo() {} }) },
      "@/components/ui/ActiviteeEChart": { default: "chart" },
    },
  });
  try {
    let tree = harness.render();
    const card = (id: string) => elements(tree).find(element => element.type === "button" && element.props["aria-controls"] === `detail-${id}`);
    assert.match(textContent(card("won")), /Match play/);
    assert.match(textContent(card("won")), /Gagné/);
    assert.match(textContent(card("won")), /2 & 1/);
    assert.doesNotMatch(textContent(card("won")), /En cours|9 trous|Putts|Fairways|GIR/);
    assert.match(textContent(card("lost")), /Perdu/);
    assert.match(textContent(card("pending")), /En cours/);
    const filter = elements(tree).find(element => element.type === "select" && /Terminés/.test(textContent(element)))!;
    (filter.props.onChange as (event: unknown) => void)({ target: { value: "complete" } });
    tree = harness.render();
    assert.ok(card("won")); assert.ok(card("lost")); assert.equal(card("pending"), undefined);
    (filter.props.onChange as (event: unknown) => void)({ target: { value: "progress" } });
    tree = harness.render();
    assert.equal(card("won"), undefined); assert.equal(card("lost"), undefined); assert.ok(card("pending"));
  } finally { harness.cleanup(); }
});
