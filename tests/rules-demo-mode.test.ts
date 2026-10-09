import test from "node:test";
import assert from "node:assert/strict";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

function fixture(caller = "real-player", failureTable?: string) {
  const clubs = [{ id: "real-a", name: "Real A", org_type: "club", is_demo: false }, { id: "real-b", name: "Real B", org_type: "club", is_demo: false }, { id: "demo", name: "Demo", org_type: "club", is_demo: true }];
  const series = Array.from({ length: 4 }, (_, i) => ({ id: `series-${i}`, season_id: "season", position: i, status: "published", discovery_starts_at: "2020-01-01", quiz_opens_at: "2020-01-01", quiz_closes_at: "2099-01-01", results_published_at: "2020-01-02" }));
  const attempts = clubs.flatMap(club => [1, 2].flatMap(player => series.map(item => ({ id: `${club.id}-${player}-${item.id}`, series_id: item.id, player_user_id: `${club.id}-player-${player}`, club_id: club.id, question_order: [1, 2, 3, 4, 5, 6], total_score: club.is_demo ? 600 : club.id === "real-a" ? 480 : 360, submitted_at: "2020-02-01", status: "submitted" }))));
  const links = attempts.flatMap(attempt => [{ attempt_id: attempt.id, club_id: attempt.club_id }, ...(attempt.club_id === "demo" ? [{ attempt_id: attempt.id, club_id: "real-a" }] : [])]);
  const f = managerDatabase({ organizations: clubs, rules_seasons: [{ id: "season", status: "published", points_per_correct: 100, speed_bonus_enabled: false, perfect_bonus: 0, minimum_player_series: 4, minimum_club_participants: 2 }], rules_series: series, rules_quiz_attempts: attempts, rules_quiz_attempt_clubs: links,
    club_members: [{ user_id: "real-player", club_id: "real-a", role: "player", is_active: true }, { user_id: "demo-player", club_id: "demo", role: "player", is_active: true }], profiles: attempts.map(attempt => ({ id: attempt.player_user_id, first_name: "Fixture", last_name: "Player" })) }, { caller, failureTable, applyOrder: true });
  const route = loadManagerModule<{ GET: (req: Request & { nextUrl: URL }) => Promise<Response> }>("app/api/rules/overview/route.ts", {
    "@supabase/supabase-js": { createClient: () => f.db }, "next/server": { NextResponse: { json: Response.json } },
  });
  const request = Object.assign(new Request("https://fixture.invalid/api/rules/overview", { headers: { Authorization: "Bearer fixture" } }), { nextUrl: new URL("https://fixture.invalid/api/rules/overview") });
  return { f, load: () => route.GET(request) };
}

test("API excludes demo before interclub averages and positions, including demo results copied into a real affiliation", async () => {
  const { f, load } = fixture();
  const response = await load(); const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.leaderboard.interclub.rows.map((row: { clubId: string; rank: number; score: number }) => [row.clubId, row.rank, row.score]), [["real-a", 1, 80], ["real-b", 2, 60]]);
  assert.equal(body.leaderboard.interclub.rows[0].eligiblePlayers, 2);
  assert.equal(f.writes.length, 0);
});

test("demo player retains quiz access and its internal ranking, but its own club is not reinserted into interclub results", async () => {
  const { load } = fixture("demo-player");
  const body = await (await load()).json();
  assert.equal(body.quizAvailable, true);
  assert.equal(body.leaderboard.clubs[0].clubId, "demo");
  assert.equal(body.leaderboard.clubs[0].rows.length, 2);
  assert.equal(body.leaderboard.clubs[0].rows[0].score, 100);
  assert.ok(body.leaderboard.interclub.rows.every((row: { clubId: string }) => row.clubId !== "demo"));
});

test("organization lookup failure never publishes a ranking with demo data", async () => {
  const { load } = fixture("real-player", "organizations");
  const body = await (await load()).json();
  assert.equal(body.leaderboard.status, "unavailable");
  assert.equal(body.quizAvailable, true);
});
