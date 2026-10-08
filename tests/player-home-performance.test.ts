import assert from "node:assert/strict";
import test from "node:test";
import { createInFlightRead } from "../lib/inFlightRead.ts";
import { createReadOnceFetch } from "../lib/readOnceFetch.ts";
import { summarizePlayerHome, type HomeHistorySession, type HomeHistoryEvent } from "../lib/playerHomeSummary.ts";
import { claimInitialPlayerHome, matchesInitialPlayerHome, type InitialPlayerHomeRead } from "../lib/playerHomeBootstrap.ts";
import { createRequestTiming } from "../lib/server/requestTiming.ts";

test("concurrent reads share work, completed reads and failures are never cached", async () => {
  const once = createInFlightRead(); let count = 0;
  const read = async () => ++count;
  assert.deepEqual(await Promise.all([once("same", read), once("same", read)]), [1, 1]);
  assert.equal(await once("same", read), 2);
  await assert.rejects(once("failure", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await once("failure", read), 3);
});

test("an initial checked context cannot cross accounts, children or organization filters", () => {
  const read = { credential: "parent-A", childId: "child-A", organizationId: null };
  assert.equal(matchesInitialPlayerHome(read, read), true);
  assert.equal(matchesInitialPlayerHome(read, { ...read, credential: "parent-B" }, "child-A"), false);
  assert.equal(matchesInitialPlayerHome(read, { ...read, childId: "child-B" }, "child-A"), false);
  assert.equal(matchesInitialPlayerHome(read, { ...read, organizationId: "other" }, "child-A"), false);
  assert.equal(matchesInitialPlayerHome({ ...read, childId: "revoked-stored-child" }, read, "child-A"), true);
});

test("Strict Mode shares one initial read but returning to the page requires a fresh context", () => {
  const read = { result: Promise.resolve(null) } as InitialPlayerHomeRead;
  const firstMount = {}, nextMount = {};
  assert.equal(claimInitialPlayerHome(read, firstMount), true);
  assert.equal(claimInitialPlayerHome(read, firstMount), true);
  assert.equal(claimInitialPlayerHome(read, nextMount), false);
});

test("server timings stay request-local and record failed phases too", async () => {
  let clock = 0;
  const first = createRequestTiming(() => clock), second = createRequestTiming(() => clock);
  await first.measure("access", async () => { clock += 15; });
  await assert.rejects(first.measure("details", async () => { clock += 5; throw new Error("offline"); }));
  assert.equal(first.headers()["Server-Timing"], "total;dur=20.0, access;dur=15.0, details;dur=5.0");
  assert.equal(second.headers()["Server-Timing"], "total;dur=20.0");
});

test("HTTP coalescing isolates credentials and gives each reader an independent response body", async () => {
  let count = 0;
  const transport: typeof fetch = async () => { count++; return Response.json({ count }); };
  const read = createReadOnceFetch(transport);
  const first = { headers: { Authorization: "Bearer parent-A", apikey: "project-A" } };
  const [a, b, c, d] = await Promise.all([
    read("https://database.invalid/rest/v1/profiles", first), read("https://database.invalid/rest/v1/profiles", first),
    read("https://database.invalid/rest/v1/profiles", { headers: { Authorization: "Bearer player-B", apikey: "project-A" } }),
    read("https://database.invalid/rest/v1/profiles", { headers: { Authorization: "Bearer parent-A", apikey: "project-B" } }),
  ]);
  assert.equal(count, 3);
  assert.deepEqual(await a.json(), await b.json());
  await c.json(); await d.json();
  await read("https://database.invalid/rest/v1/profiles", first);
  assert.equal(count, 4);
});

test("mutations and different RPC subjects cannot be coalesced", async () => {
  let count = 0;
  const read = createReadOnceFetch(async () => { count++; return Response.json({ ok: true }); });
  await Promise.all([1, 2].map(() => read("https://database.invalid/rest/v1/rpc/decide_legal_document", { method: "POST", body: "{}" })));
  assert.equal(count, 2);
  await Promise.all([1, 1, 2].map(player => read("https://database.invalid/rest/v1/rpc/organization_access_summary_checked", { method: "POST", body: JSON.stringify({ player }) })));
  assert.equal(count, 4);
});

test("a cancelled reader cannot cancel a separate concurrent read", async () => {
  const read = createReadOnceFetch(async (_input, init) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return Response.json({ ok: true });
  });
  const controller = new AbortController();
  const cancelled = read("https://database.invalid/rest/v1/profiles", { signal: controller.signal });
  const independent = read("https://database.invalid/rest/v1/profiles");
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.deepEqual(await (await independent).json(), { ok: true });
});

const baseSession: HomeHistorySession = { id: "personal", start_at: "2026-10-03T10:00:00Z", total_minutes: 60,
  motivation: 4, difficulty: 3, satisfaction: 5, session_type: "individual", club_event_id: null };
const event: HomeHistoryEvent = { id: "club", event_type: "camp", title: "Stage", starts_at: "2026-10-01T09:00:00Z",
  ends_at: "2026-10-01T16:00:00Z", duration_minutes: 420, status: "scheduled", requires_evaluation: true };
const period = { monthStart: "2026-09-30T22:00:00Z", monthEnd: "2026-10-31T23:00:00Z",
  previousMonthStart: "2026-08-31T22:00:00Z", now: "2026-10-08T10:00:00Z", performanceEnabled: true };

test("home summary retains personal history, pending camp feedback and month boundaries", () => {
  const result = summarizePlayerHome({ ...period,
    sessions: [baseSession, { ...baseSession, id: "old", start_at: "2025-01-01T10:00:00Z", motivation: null }],
    items: [{ session_id: "personal", category: "putting", minutes: 60 }],
    events: [event], attendees: [{ event_id: "club", status: "present" }],
  });
  assert.deepEqual(result.pendingTrainings.map(row => row.id), ["club", "old"]);
  assert.deepEqual(result.monthSessions.map(row => row.id), ["personal"]);
  assert.equal(result.monthItems.reduce((sum, row) => sum + row.minutes, 0), 60);
  assert.deepEqual(result.attendanceInsight, { present: 1, expected: 1, rate: 100, change: null });
  assert.equal(result.monthPlannedClubMinutes, 420);
});

test("a complete linked evaluation clears its reminder; ongoing and excused camps add none", () => {
  const ongoing = { ...event, id: "ongoing", starts_at: "2026-10-08T09:00:00Z", ends_at: "2026-10-08T16:00:00Z" };
  const excused = { ...event, id: "excused" };
  const result = summarizePlayerHome({ ...period,
    sessions: [{ ...baseSession, club_event_id: event.id }],
    items: [{ session_id: "personal", category: "putting", minutes: 60 }],
    events: [event, ongoing, excused], attendees: [{ event_id: "club", status: "present" }, { event_id: "ongoing", status: "present" }, { event_id: "excused", status: "excused" }],
  });
  assert.deepEqual(result.pendingTrainings, []);
  assert.equal(result.monthClubEventDurationById.club, 420);
});

test("basic mode retains monthly minutes and attendance but has no evaluation reminders", () => {
  const result = summarizePlayerHome({ ...period, performanceEnabled: false,
    sessions: [{ ...baseSession, motivation: null }], items: [], events: [event], attendees: [{ event_id: "club", status: "absent" }],
  });
  assert.deepEqual(result.pendingTrainings, []);
  assert.equal(result.monthSessions[0].total_minutes, 60);
  assert.equal(result.attendanceInsight?.rate, 0);
  assert.equal(result.monthPlannedClubMinutes, 0);
});
