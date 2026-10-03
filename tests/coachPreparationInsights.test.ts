import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  completedBefore,
  isFutureTraining,
  normalizeCoachPreparationPoints,
  selectPreparationPrivateNote,
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

test("a newer cleared feedback note overrides an older validated private note", () => {
  assert.equal(selectPreparationPrivateNote({
    feedbackText: null,
    feedbackUpdatedAt: "2026-09-26T18:56:01.000Z",
    validatedText: "Ancienne note privée validée",
    validatedAt: "2026-09-26T18:33:05.000Z",
  }), null);

  assert.deepEqual(selectPreparationPrivateNote({
    feedbackText: null,
    feedbackUpdatedAt: "2026-09-26T18:20:00.000Z",
    validatedText: "Note privée validée ensuite",
    validatedAt: "2026-09-26T18:33:05.000Z",
  }), {
    source: "validated",
    text: "Note privée validée ensuite",
    savedAt: "2026-09-26T18:33:05.000Z",
  });
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
  const sources = readFileSync(new URL("../lib/server/coachPreparationSources.ts", import.meta.url), "utf8");
  assert.match(route, /loadCoachPreparationSources\(supabaseAdmin, targetEvent, playerIds\)/);
  assert.match(page, /coachTrainingAssistanceEnabled/);
  assert.match(page, /preparation-insights/);
  assert.match(page, /Points d’attention/);
  assert.match(route, /requireCoachEventAccess/);
  assert.match(route, /isCoachTrainingAssistanceEnabled/);
  assert.match(sources, /player_reference: playerId/);
  assert.match(sources, /select\("event_id,player_id,private_note,updated_at"\)/);
  assert.match(sources, /from\("coach_player_private_notes"\)/);
  assert.match(sources, /select\("id,event_id,player_id,body,source_report_version,validated_at"\)/);
  assert.match(sources, /latestValidatedNoteByKey/);
  assert.match(sources, /selectPreparationPrivateNote/);
  assert.match(route, /playersWithoutSource/);
  assert.match(route, /\.delete\(\)/);
  assert.match(sources, /private_notes_by_session/);
  assert.doesNotMatch(route, /individual_comments|player_note|source_report_text/);
  assert.match(route, /minItems: 1/);
  assert.match(route, /une note qui ne contient qu'une seule information doit donner un seul point/);
  assert.match(route, /Ne complète jamais la liste pour atteindre un quota/);
  assert.match(sources, /generationVersion: COACH_PREPARATION_GENERATION_VERSION/);
  assert.match(route, /cachedPoints\.length >= 1/);
  assert.doesNotMatch(route, /coach_comment|ratings:/);
  assert.match(route, /batch\.map\(async \(\[playerId, sourceData\]\)/);
  assert.match(sources, /COACH_PREPARATION_MAX_HISTORY_EVENTS/);
  assert.match(page, /notes privées des cinq derniers entraînements/);
  assert.match(page, /Aucune note privée exploitable/);
});
