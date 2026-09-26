import assert from "node:assert/strict";
import test from "node:test";
import {
  coachCalendarActionState,
  coachCalendarActionHref,
  coachEventEndMs,
  coachTrainingCompletionByEvent,
  coachTrainingEvaluationComplete,
} from "../lib/coachCalendar.ts";
import { messages } from "../lib/i18n/messages.ts";

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_A = "11111111-1111-4111-8111-111111111111";
const PLAYER_B = "22222222-2222-4222-8222-222222222222";

test("a sequential evaluation is complete only after every attendee is explicitly persisted", () => {
  const feedback = [{ event_id: EVENT_A, player_id: PLAYER_A, engagement: 5, attitude: 4, performance: 6 }];
  assert.equal(coachTrainingEvaluationComplete([
    { event_id: EVENT_A, player_id: PLAYER_A, coach_recorded_status: "present" },
    { event_id: EVENT_A, player_id: PLAYER_B, coach_recorded_status: "absent" },
  ], feedback), true);
  assert.equal(coachTrainingEvaluationComplete([
    { event_id: EVENT_A, player_id: PLAYER_A, coach_recorded_status: "present" },
    { event_id: EVENT_A, player_id: PLAYER_B, coach_recorded_status: null },
  ], feedback), false);
});

test("a present attendee requires all three valid persisted ratings", () => {
  const attendees = [{ event_id: EVENT_A, player_id: PLAYER_A, coach_recorded_status: "present" as const }];
  assert.equal(coachTrainingEvaluationComplete(attendees, []), false);
  assert.equal(coachTrainingEvaluationComplete(attendees, [
    { event_id: EVENT_A, player_id: PLAYER_A, engagement: 5, attitude: null, performance: 6 },
  ]), false);
  assert.equal(coachTrainingEvaluationComplete(attendees, [
    { event_id: EVENT_A, player_id: PLAYER_A, engagement: 5, attitude: 4, performance: 6 },
  ]), true);
});

test("an empty training is not marked complete and collective debrief existence is irrelevant", () => {
  assert.equal(coachTrainingEvaluationComplete([], []), false);
  assert.deepEqual(coachTrainingCompletionByEvent([EVENT_A], [], []), { [EVENT_A]: false });
});

test("calendar exposes the four action states", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const pastTraining = { event_type: "training", starts_at: "2026-09-26T09:00:00Z", ends_at: "2026-09-26T10:00:00Z", duration_minutes: 60 };
  const futureTraining = { event_type: "training", starts_at: "2026-09-26T14:00:00Z", ends_at: "2026-09-26T15:00:00Z", duration_minutes: 60 };
  const competition = { event_type: "interclub", starts_at: "2026-09-26T09:00:00Z", ends_at: "2026-09-26T10:00:00Z", duration_minutes: 60 };
  assert.equal(coachCalendarActionState(pastTraining, false, now), "needs_evaluation");
  assert.equal(coachCalendarActionState(pastTraining, true, now), "evaluation_complete");
  assert.equal(coachCalendarActionState(futureTraining, false, now), "prepare_training");
  assert.equal(coachCalendarActionState(competition, false, now), "view_activity");
});

test("past trainings open the evaluation while future trainings and other activities keep the detail route", () => {
  const groupId = "group-id";
  const eventId = "event-id";
  assert.equal(coachCalendarActionHref("needs_evaluation", groupId, eventId), `/coach/groups/${groupId}/planning/${eventId}/debrief`);
  assert.equal(coachCalendarActionHref("evaluation_complete", groupId, eventId), `/coach/groups/${groupId}/planning/${eventId}/debrief`);
  assert.equal(coachCalendarActionHref("prepare_training", groupId, eventId), `/coach/groups/${groupId}/planning/${eventId}`);
  assert.equal(coachCalendarActionHref("view_activity", groupId, eventId), `/coach/groups/${groupId}/planning/${eventId}`);
});

test("all four action labels are translated in every supported locale", () => {
  const expected = {
    fr: ["À évaluer", "Évaluation terminée", "Préparer l’entraînement", "Voir l’activité"],
    en: ["To evaluate", "Evaluation complete", "Prepare training", "View activity"],
    de: ["Zu bewerten", "Bewertung abgeschlossen", "Training vorbereiten", "Aktivität ansehen"],
    it: ["Da valutare", "Valutazione completata", "Prepara l’allenamento", "Vedi attività"],
  } as const;
  const keys = ["coachCalendar.toEvaluate", "coachCalendar.evaluationComplete", "coachCalendar.prepareTraining", "coachCalendar.viewActivity"];
  Object.entries(expected).forEach(([locale, labels]) => {
    const dictionary = messages[locale as keyof typeof messages] as Record<string, string>;
    assert.deepEqual(keys.map((key) => dictionary[key]), labels);
  });
});

test("the exact end instant is past and duration is the fallback when ends_at is absent", () => {
  const event = { event_type: "training", starts_at: "2026-09-26T11:00:00Z", ends_at: null, duration_minutes: 60 };
  const end = Date.parse("2026-09-26T12:00:00Z");
  assert.equal(coachEventEndMs(event), end);
  assert.equal(coachCalendarActionState(event, false, end - 1), "prepare_training");
  assert.equal(coachCalendarActionState(event, false, end), "needs_evaluation");
});
