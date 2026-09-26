import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VersionedAutosaveQueue } from "../lib/versionedAutosaveQueue.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260926_player_golf_reliability_batch5.sql", import.meta.url),
  "utf8",
);

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("autosave serializes a newer edit made while the previous request is slow", async () => {
  const firstRequest = deferred();
  const savedScores: number[] = [];
  let requestCount = 0;
  const queue = new VersionedAutosaveQueue<{ score: number }>(async ({ score }) => {
    requestCount += 1;
    if (requestCount === 1) await firstRequest.promise;
    savedScores.push(score);
  });

  queue.enqueue({ score: 4 });
  const flush = queue.flush();
  queue.enqueue({ score: 5 });
  firstRequest.resolve();
  await flush;

  assert.deepEqual(savedScores, [4, 5]);
  assert.equal(queue.getSnapshot().status, "clean");
  assert.equal(queue.getSnapshot().acknowledgedRevision, 2);
});

test("autosave retains a rejected snapshot until a retry is acknowledged", async () => {
  let shouldFail = true;
  const savedScores: number[] = [];
  const queue = new VersionedAutosaveQueue<{ score: number }>(async ({ score }) => {
    if (shouldFail) throw new Error("network unavailable");
    savedScores.push(score);
  });

  queue.enqueue({ score: 6 });
  await assert.rejects(queue.flush(), /network unavailable/);
  assert.equal(queue.getSnapshot().status, "error");
  assert.equal(queue.hasPendingChanges(), true);

  shouldFail = false;
  await queue.flush();
  assert.deepEqual(savedScores, [6]);
  assert.equal(queue.getSnapshot().status, "clean");
});

test("the Player role guard exposes retryable failures instead of a permanent quiet blank", () => {
  const source = readFileSync(new URL("../components/auth/RoleGuard.tsx", import.meta.url), "utf8");
  assert.match(source, /status.*error/s);
  assert.match(source, /Réessayer/);
  assert.match(source, /response\.text\(\)/);
  assert.match(source, /catch/);
});

test("registered camp events are flattened from the Supabase relationship before display", () => {
  const source = readFileSync(
    new URL("../app/api/player/home-upcoming/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /\.flatMap\(\(row\) => row\.club_events \?\? \[\]\)/);
  assert.doesNotMatch(source, /\.map\(\(row\) => row\.club_events \?\? null\)/);
});

test("golf hole, grid and round-format saves are transactional and ownership checked", () => {
  for (const functionName of [
    "save_player_golf_hole_transactional",
    "save_player_golf_holes_transactional",
    "update_player_golf_round_transactional",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}\\(`));
  }

  assert.match(migration, /from public\.player_guardians pg[\s\S]*?coalesce\(pg\.can_edit, false\) = true/);
  assert.match(migration, /for update/g);
  assert.match(migration, /on conflict \(round_id, hole_no\) do update/g);
  assert.match(migration, /perform public\.om_recompute_round\(p_round_id\)/g);
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to anon/);
});

test("the golf editor protects navigation and restores same-tab drafts", () => {
  const source = readFileSync(
    new URL("../app/player/golf/rounds/[roundId]/edit/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /readRoundDraft/);
  assert.match(source, /beforeunload/);
  assert.match(source, /addEventListener\("online"/);
  assert.match(source, /protectClientNavigation/);
});
