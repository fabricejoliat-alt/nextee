import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Answer = [label: string, explanation: string];
type Question = { v: number; p: string; i: string; x: string; o: Answer[] };
type Card = { n: number; r: string; s: string; e: string; a: string; m: string; c: string; v: string; q: Question[] };

const migration = readFileSync(new URL("../supabase/migrations/20260925_seed_rules_series_3_to_12_content.sql", import.meta.url), "utf8");
const payload = migration.match(/\$cards\$([\s\S]*?)\$cards\$/)?.[1];
assert.ok(payload, "Le payload éditorial doit exister.");
const cards = JSON.parse(payload) as Card[];

test("les dix séries restantes ont six fiches et trois questions originales par fiche", () => {
  assert.deepEqual(cards.map((card) => card.n), Array.from({ length: 60 }, (_, index) => index + 13));
  for (let series = 0; series < 10; series++) {
    assert.equal(cards.slice(series * 6, series * 6 + 6).length, 6);
  }
  assert.equal(cards.flatMap((card) => card.q).length, 180);
  assert.equal(new Set(cards.flatMap((card) => card.q.map((question) => question.p))).size, 180);
});

test("chaque fiche et chaque réponse possède ses éléments éditoriaux", () => {
  for (const card of cards) {
    for (const field of [card.r, card.s, card.e, card.a, card.m, card.c, card.v]) {
      assert.ok(field.trim(), `Champ de la fiche ${card.n} vide`);
    }
    assert.deepEqual(card.q.map((question) => question.v), [0, 1, 2]);
    for (const question of card.q) {
      assert.ok(question.p.trim() && question.i.trim() && question.x.trim());
      assert.ok(question.o.length >= 3 && question.o.length <= 4);
      for (const answer of question.o) {
        assert.ok(answer[0].trim() && answer[1].trim(), `Réponse incomplète ${card.n}/${question.v}`);
      }
    }
  }
});

test("le seed ne publie pas de contenu et protège les corrections éditoriales", () => {
  assert.match(migration, /editorial_status\)\s*values\([\s\S]*?'needs_review'\)/);
  assert.match(migration, /on conflict\(card_version_id,kind,variant\) do nothing/);
  assert.match(migration, /approved_at is not null/);
  assert.match(migration, /where id=v_version_id and situation like/);
});
