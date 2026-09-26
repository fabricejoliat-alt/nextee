import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  completedBefore,
  isFutureTraining,
  normalizeCoachPreparationPoints,
} from "../lib/coachPreparationInsights.ts";

test("normalizes, deduplicates and caps preparation checklist points", () => {
  const points = normalizeCoachPreparationPoints({
    points: [
      "  Vérifier l’alignement avant chaque série. ",
      "Vérifier l’alignement avant chaque série.",
      "Observer la routine entre les coups.",
      "Valider la cible annoncée.",
      "Faire verbaliser le choix de club.",
      "Ce cinquième point doit être ignoré.",
    ],
  });
  assert.deepEqual(points, [
    { text: "Vérifier l’alignement avant chaque série." },
    { text: "Observer la routine entre les coups." },
    { text: "Valider la cible annoncée." },
    { text: "Faire verbaliser le choix de club." },
  ]);
});

test("shows preparation only for future training sessions", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");
  assert.equal(isFutureTraining({ event_type: "training", starts_at: "2026-09-27T10:00:00.000Z" }, now), true);
  assert.equal(isFutureTraining({ event_type: "training", starts_at: "2026-09-25T10:00:00.000Z" }, now), false);
  assert.equal(isFutureTraining({ event_type: "interclub", starts_at: "2026-09-27T10:00:00.000Z" }, now), false);
});

test("keeps only completed, non-cancelled history events", () => {
  const boundary = new Date("2026-09-26T10:00:00.000Z");
  assert.equal(completedBefore({ starts_at: "2026-09-26T08:00:00.000Z", ends_at: null, duration_minutes: 60, status: "scheduled" }, boundary), true);
  assert.equal(completedBefore({ starts_at: "2026-09-26T09:30:00.000Z", ends_at: null, duration_minutes: 60, status: "scheduled" }, boundary), false);
  assert.equal(completedBefore({ starts_at: "2026-09-26T08:00:00.000Z", ends_at: null, duration_minutes: 60, status: "cancelled" }, boundary), false);
});

test("the coach event page and endpoint keep insights gated and player-isolated", () => {
  const page = readFileSync(
    new URL("../app/coach/groups/[id]/planning/[eventId]/page.tsx", import.meta.url),
    "utf8"
  );
  const route = readFileSync(
    new URL("../app/api/coach/events/[eventId]/preparation-insights/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(page, /coachTrainingAssistanceEnabled/);
  assert.match(page, /preparation-insights/);
  assert.match(page, /Points d’attention/);
  assert.match(route, /requireCoachEventAccess/);
  assert.match(route, /isCoachTrainingAssistanceEnabled/);
  assert.match(route, /player_reference: playerId/);
  assert.match(route, /select\("event_id,player_id,private_note,updated_at"\)/);
  assert.match(route, /from\("coach_player_private_notes"\)/);
  assert.match(route, /select\("id,event_id,player_id,body,source_report_version,validated_at"\)/);
  assert.match(route, /latestValidatedNoteByKey/);
  assert.match(route, /private_notes_by_session/);
  assert.doesNotMatch(route, /individual_comments|player_note|source_report_text/);
  assert.match(route, /minItems: 1/);
  assert.match(route, /une note qui ne contient qu'une seule information doit donner un seul point/);
  assert.match(route, /Ne complète jamais la liste pour atteindre un quota/);
  assert.match(route, /generationVersion: COACH_PREPARATION_GENERATION_VERSION/);
  assert.match(route, /cachedPoints\.length >= 1/);
  assert.doesNotMatch(route, /coach_comment|ratings:/);
  assert.match(route, /batch\.map\(async \(\[playerId, sourceData\]\)/);
  assert.match(route, /COACH_PREPARATION_MAX_HISTORY_EVENTS/);
  assert.match(page, /notes privées des cinq derniers entraînements/);
  assert.match(page, /Aucune note privée exploitable/);
});
