import test from "node:test";
import assert from "node:assert/strict";
import { coachComponentHarness } from "./helpers/coachComponentHarness.ts";

const noFetch = async () => { throw new Error("Round-list redirect must not fetch"); };
test("legacy round-list entry returns to My golf with its navigation", () => {
  let destination = "";
  const harness = coachComponentHarness("app/player/golf/rounds/page.tsx", {
    fetch: noFetch,
    modules: { "next/navigation": { redirect: (path: string) => { destination = path; } } },
  });
  try { harness.render(); assert.equal(destination, "/player/golf?section=rounds"); }
  finally { harness.cleanup(); }
});
