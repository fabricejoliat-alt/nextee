import assert from "node:assert/strict";
import test from "node:test";
import { readCoachGroupRosters } from "../lib/coachGroupRosterReads.ts";
import { deferred } from "./helpers/coachComponentHarness.ts";

test("roster reads isolate group queries, deduplicate IDs and bound concurrent reads", async () => {
  const pending = new Map<string, ReturnType<typeof deferred<{ data: string[]; error: null }>>>();
  const reads: string[] = [];
  const result = readCoachGroupRosters(["a", "b", "a", "c", "d"], (id) => {
    reads.push(id);
    const gate = deferred<{ data: string[]; error: null }>();
    pending.set(id, gate);
    return gate.promise;
  });
  assert.deepEqual(reads, ["a", "b", "c"]);
  for (const id of reads) pending.get(id)!.resolve({ data: [id], error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reads, ["a", "b", "c", "d"]);
  pending.get("d")!.resolve({ data: ["d"], error: null });
  assert.deepEqual(await result, { data: ["a", "b", "c", "d"], error: null });
});

test("a failed group prevents partial rosters being shown as complete", async () => {
  const error = { message: "canceling statement due to statement timeout" };
  const reads: string[] = [];
  assert.deepEqual(await readCoachGroupRosters(["a", "b", "c", "d"], async (id) => {
    reads.push(id);
    return id === "b" ? { data: null, error } : { data: [id], error: null };
  }), { data: [], error });
  assert.deepEqual(reads, ["a", "b", "c"]);
});

test("an empty authorized group list never reads a roster", async () => {
  assert.deepEqual(await readCoachGroupRosters([], async () => { throw new Error("Unexpected read"); }), { data: [], error: null });
});
