import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness, textContent } from "./helpers/coachComponentHarness.ts";

const noFetch = async () => { throw new Error("Presentational cards must not fetch"); };
test("cards distinguish insufficient data and significant performance in the selected dataset", () => {
  const rounds = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
  const holesByRound = Object.fromEntries(rounds.map(r => [r.id, Array.from({ length: 18 }, (_, i) => ({
    hole_no: i + 1, par: 4, score: i < 9 ? 5 : 4,
  }))]));
  const harness = coachComponentHarness("components/golf/GolfRoundTrendCards.tsx", {
    fetch: noFetch, props: { rounds, holesByRound, loading: false },
  });
  try {
    let text = textContent(harness.render());
    assert.match(text, /Plus performant au retour/);
    assert.match(text, /8\s+cartes complètes/);
    assert.match(text, /Pas encore assez de données/);
    text = textContent(harness.render({ rounds: rounds.slice(0, 2), holesByRound, loading: false }));
    assert.doesNotMatch(text, /Plus performant au retour/);
    assert.match(text, /2\s+cartes complètes/);
  } finally { harness.cleanup(); }
});

test("legacy round-list entry returns to My golf with its navigation", () => {
  let destination = "";
  const harness = coachComponentHarness("app/player/golf/rounds/page.tsx", {
    fetch: noFetch,
    modules: { "next/navigation": { redirect: (path: string) => { destination = path; } } },
  });
  try { harness.render(); assert.equal(destination, "/player/golf?section=rounds"); }
  finally { harness.cleanup(); }
});
