import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260930_add_golf_tournament_group_ids.sql", import.meta.url),
  "utf8",
);
const newRoundPage = readFileSync(
  new URL("../app/player/golf/rounds/new/page.tsx", import.meta.url),
  "utf8",
);
const editRoundPage = readFileSync(
  new URL("../app/player/golf/rounds/[roundId]/edit/page.tsx", import.meta.url),
  "utf8",
);
const scorecardPage = readFileSync(
  new URL("../app/player/golf/rounds/[roundId]/scorecard/page.tsx", import.meta.url),
  "utf8",
);
const transactionErrors = readFileSync(
  new URL("../lib/playerTransactionErrors.ts", import.meta.url),
  "utf8",
);

test("multi-round creation receives one stable tournament group id", () => {
  assert.match(migration, /add column if not exists tournament_group_id uuid/);
  assert.match(migration, /v_tournament_group_id uuid := gen_random_uuid\(\)/);
  assert.match(migration, /set tournament_group_id = v_tournament_group_id/);
  assert.match(migration, /gr\.id = any\(v_round_ids\)/);
});

test("historical batches are separated by creation transaction and normalized", () => {
  assert.match(migration, /group by gr\.user_id, gr\.created_at/);
  assert.match(migration, /set om_rounds_18_count = tournament_sizes\.round_count/);
  assert.match(migration, /INVALID_TOURNAMENT_ROUND_COUNT/);
  assert.match(transactionErrors, /INVALID_TOURNAMENT_ROUND_COUNT/);
});

test("player pages associate rounds exclusively through tournament_group_id", () => {
  assert.match(editRoundPage, /\.eq\("tournament_group_id", loadedRound\.tournament_group_id\)/);
  assert.match(scorecardPage, /\.eq\("tournament_group_id", loadedRound\.tournament_group_id\)/);
  assert.doesNotMatch(editRoundPage, /normCurrentName/);
  assert.doesNotMatch(scorecardPage, /normCurrentName/);
  assert.match(editRoundPage, /edit\?mode=\$\{entryView\}/);
});

test("the first multi-round date is not rendered twice", () => {
  assert.match(newRoundPage, /Date de la partie 1/);
  assert.match(newRoundPage, /length: omRounds18Count - 1/);
});
