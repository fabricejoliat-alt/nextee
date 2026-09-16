import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeCampParticipants,
  deriveCampLifecycle,
  evaluationToggleEffect,
  isSelectableCampGroup,
  moveCampItem,
  normalizeCampAttendanceStatus,
  remainingCampCapacity,
  validateCampDays,
} from "../lib/campsManagement.ts";

test("déduplique les juniors ajoutés par groupe et individuellement", () => {
  assert.deepEqual(dedupeCampParticipants(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
});

test("exclut les groupes techniques des événements spécifiques d’un stage", () => {
  assert.equal(isSelectableCampGroup("JUNIORS 1"), true);
  assert.equal(isSelectableCampGroup("Groupe spécifique"), false);
  assert.equal(isSelectableCampGroup("__EVENT_SPECIFIQUE__06e367d8"), false);
  assert.equal(isSelectableCampGroup("Event spécifique"), false);
});

test("classe les stages existants et les brouillons", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  assert.equal(deriveCampLifecycle("draft", [], now), "draft");
  assert.equal(deriveCampLifecycle("scheduled", [{ starts_at: "2026-09-07T08:00:00Z", ends_at: "2026-09-07T15:00:00Z" }], now), "upcoming");
  assert.equal(deriveCampLifecycle("scheduled", [{ starts_at: "2026-09-06T08:00:00Z", ends_at: "2026-09-06T15:00:00Z" }], now), "in_progress");
  assert.equal(deriveCampLifecycle("scheduled", [{ starts_at: "2026-09-05T08:00:00Z", ends_at: "2026-09-05T15:00:00Z" }], now), "completed");
});

test("valide les horaires, doublons et la réorganisation des journées", () => {
  const days = [{ starts_at: "2026-09-07T09:00", ends_at: "2026-09-07T16:00", location_text: "Practice" }, { starts_at: "2026-09-07T09:00", ends_at: "2026-09-07T16:00", location_text: "Practice" }];
  assert.equal(validateCampDays(days).length, 1);
  assert.deepEqual(moveCampItem(["jour 1", "jour 2"], 1, -1), ["jour 2", "jour 1"]);
});

test("préserve les évaluations lorsqu'une journée est désactivée", () => {
  assert.deepEqual(evaluationToggleEffect(true, false, 2), { requiresConfirmation: true, deleteExistingEvaluations: false });
});

test("réutilise les statuts de présence et contrôle la capacité des options", () => {
  assert.equal(normalizeCampAttendanceStatus("excused"), "excused");
  assert.equal(normalizeCampAttendanceStatus("inconnu"), "expected");
  assert.equal(remainingCampCapacity(8, 5), 3);
  assert.equal(remainingCampCapacity(4, 7), 0);
  assert.equal(remainingCampCapacity(null, 7), null);
});
