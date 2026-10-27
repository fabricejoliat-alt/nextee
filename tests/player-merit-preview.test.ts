import test from "node:test";
import assert from "node:assert/strict";
import { playerMeritPreview } from "../lib/playerMeritPreview.ts";

const rows = Array.from({ length: 8 }, (_, index) => ({ player_id: String(index + 1), full_name: `Player ${index + 1}`, rank_net: index + 1, rank_brut: 8 - index }));
const ids = (player: string, mode: "net" | "brut" = "net") => playerMeritPreview(rows, player, mode).map(row => row.player_id);

test("shows the leader, predecessor, current player and successor", () => {
  assert.deepEqual(ids("5"), ["1", "4", "5", "6"]);
});
test("gross mode uses its own leader and neighbors", () => {
  assert.deepEqual(ids("4", "brut"), ["8", "5", "4", "3"]);
  assert.equal(rows[0].player_id, "1");
});
test("fills four distinct places at the top and bottom", () => {
  assert.deepEqual(ids("1"), ["1", "2", "3", "4"]);
  assert.deepEqual(ids("2"), ["1", "2", "3", "4"]);
  assert.deepEqual(ids("8"), ["1", "6", "7", "8"]);
});
test("handles fewer than four players, empty rankings and unranked players", () => {
  assert.deepEqual(playerMeritPreview(rows.slice(0, 2), "1", "net"), rows.slice(0, 2));
  assert.deepEqual(playerMeritPreview([], "1", "net"), []);
  assert.deepEqual(ids("missing"), ["1", "2", "3", "4"]);
});
test("ties follow the full ranking name order", () => {
  const tied = [{ ...rows[0], full_name: "Zoe" }, { ...rows[1], full_name: "Alice", rank_net: 1 }, ...rows.slice(2)];
  assert.deepEqual(playerMeritPreview(tied, "5", "net").map(row => row.player_id), ["2", "4", "5", "6"]);
});
