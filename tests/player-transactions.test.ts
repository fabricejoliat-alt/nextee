import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapPlayerTransactionError } from "../lib/playerTransactionErrors.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260926_transactional_player_mutations_batch4.sql", import.meta.url),
  "utf8",
);

test("maps transactional capacity and authorization failures to stable API responses", () => {
  assert.deepEqual(mapPlayerTransactionError({ message: "P0001: CAMP_CAPACITY_EXCEEDED" }), {
    error: "La capacité maximale du stage est atteinte.",
    status: 409,
  });
  assert.deepEqual(mapPlayerTransactionError("CAMP_OPTION_CAPACITY_EXCEEDED"), {
    error: "La capacité disponible pour cette option est dépassée.",
    status: 409,
  });
  assert.deepEqual(mapPlayerTransactionError({ message: "FORBIDDEN" }), {
    error: "Forbidden",
    status: 403,
  });
});

test("keeps consent, camps and multi-round creation inside database transactions", () => {
  for (const functionName of [
    "grant_player_consent_transactional",
    "set_player_camp_registration_transactional",
    "set_player_camp_attendance_transactional",
    "set_player_camp_option_transactional",
    "create_player_golf_rounds_transactional",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}\\(`));
  }

  assert.match(migration, /for update/gi);
  assert.match(migration, /CAMP_CAPACITY_EXCEEDED/);
  assert.match(migration, /CAMP_OPTION_CAPACITY_EXCEEDED/);
  assert.match(migration, /on conflict \(event_id, player_id\) do update/);
  assert.match(migration, /returns uuid\[\]/);
});

test("does not expose server-only transactional mutations to authenticated clients", () => {
  for (const functionName of [
    "grant_player_consent_transactional",
    "set_player_camp_registration_transactional",
    "set_player_camp_attendance_transactional",
    "set_player_camp_option_transactional",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`),
    );
  }

  assert.match(
    migration,
    /grant execute on function public\.create_player_golf_rounds_transactional\(uuid, jsonb, timestamptz\[\], jsonb\) to authenticated;/,
  );
});
