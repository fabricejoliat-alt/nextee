import assert from "node:assert/strict";
import { test } from "node:test";
import { readAllRows, readRelatedRows } from "../lib/server/paginatedRead.ts";

test("history spanning the PostgREST row limit retains every row", async () => {
  const history = Array.from({ length: 1251 }, (_, id) => ({ id }));
  const rows = await readAllRows<{ id: number }>(async (from, to) => ({ data: history.slice(from, to + 1), error: null }));
  assert.deepEqual(rows, history);
});

test("related history crosses ID batches and page boundaries without duplicates", async () => {
  const ids = Array.from({ length: 205 }, (_, id) => String(id));
  const history = ids.flatMap(id => Array.from({ length: 12 }, (_, index) => ({ id, index })));
  const rows = await readRelatedRows([...ids, ids[0]], async (batch, from, to) => ({
    data: history.filter(row => batch.includes(row.id)).slice(from, to + 1), error: null,
  }));
  assert.deepEqual(rows, history);
});

test("a failed later page never returns misleading partial statistics", async () => {
  await assert.rejects(() => readAllRows(async (from) => from === 0
    ? { data: Array(500).fill({}), error: null }
    : { data: null, error: { message: "database unavailable" } }), /database unavailable/);
});
