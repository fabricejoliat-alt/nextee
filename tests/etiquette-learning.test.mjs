import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { etiquetteCards, etiquetteThemes } from "../data/etiquette.fr.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20261018_etiquette_learning.sql", import.meta.url), "utf8");
const seed = readFileSync(new URL("../supabase/migrations/20261019_seed_etiquette_fr.sql", import.meta.url), "utf8");
const overview = readFileSync(new URL("../app/api/etiquette/overview/route.ts", import.meta.url), "utf8");

test("the French program contains 12 themes and three complete, distinct cards per theme", () => {
  assert.equal(etiquetteThemes.length, 12);
  assert.equal(new Set(etiquetteThemes).size, 12);
  assert.equal(etiquetteCards.length, 36);
  assert.equal(new Set(etiquetteCards.map((card) => card.key)).size, 36);
  assert.equal(new Set(etiquetteCards.map((card) => card.title)).size, 36);
  for (let theme = 1; theme <= 12; theme++) {
    const prefix = String(theme).padStart(2, "0");
    assert.deepEqual(etiquetteCards.filter((card) => card.key.startsWith(`${prefix}.`)).map((card) => card.key),
      [`${prefix}.1`, `${prefix}.2`, `${prefix}.3`]);
  }
  for (const card of etiquetteCards) {
    const fields = ["title", "situation", "simple_explanation", "action_text", "common_mistake", "mission_text", "coach_tip", "official_reference", "reference_version"];
    for (const field of fields) assert.ok(card[field]?.trim(), `${card.key}: ${field}`);
    const count = ["situation", "simple_explanation", "action_text", "common_mistake", "mission_text", "coach_tip"]
      .map((field) => card[field]).join(" ").split(/\s+/).length;
    assert.ok(count >= 150 && count <= 230, `${card.key}: ${count} words`);
    assert.doesNotMatch(JSON.stringify(card), /lorem ipsum|contenu à rédiger|bientôt disponible/i);
  }
});

test("seed preserves existing editorial revisions and the new module has independent publication controls", () => {
  assert.equal((seed.match(/on conflict \(stable_key\) do nothing/g) ?? []).length, 48);
  assert.equal((seed.match(/on conflict \(card_id,version,locale\) do nothing/g) ?? []).length, 36);
  assert.match(migration, /v_count<>3/);
  assert.match(migration, /editorial_status='approved'/);
  assert.match(migration, /public\.is_app_admin\(auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /create or replace function public\.validate_rules_series_for_publication|rules_questions|rules_quiz_attempts/i);
  assert.match(overview, /\.eq\("status", "published"\)/);
  assert.match(overview, /published_version_id/);
  assert.match(overview, /\.eq\("editorial_status", "approved"\)/);
});
