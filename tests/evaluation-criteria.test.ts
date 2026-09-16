import test from "node:test";
import assert from "node:assert/strict";
import {
  criterionAppliesTo,
  defaultEvaluationChoices,
  respondentIncludes,
  validateCriterionInput,
  validateEventCriterionSelection,
  validateResponseValue,
  type EvaluationCriterion,
} from "../lib/evaluationCriteria.ts";
import { readFileSync } from "node:fs";

test("criterion creation accepts every supported response format", () => {
  for (const response_format of ["scale_1_6", "delta", "sentiment", "feeling", "yes_no", "short_text"] as const) {
    assert.deepEqual(validateCriterionInput({ name: "Routine", respondent: "both", response_format, activity_types: ["training"], domain_key: "mental", domain_label: "Mental" }), []);
  }
});

test("activity selection is deduplicated and limited to three", () => {
  assert.deepEqual(validateEventCriterionSelection(["a", "a", "b", "c"]), { ids: ["a", "b", "c"], valid: true, error: null });
  assert.equal(validateEventCriterionSelection(["a", "b", "c", "d"]).valid, false);
});

test("coach and player answers remain distinct for a both criterion", () => {
  assert.equal(respondentIncludes("both", "coach"), true);
  assert.equal(respondentIncludes("both", "player"), true);
  assert.equal(respondentIncludes("coach", "player"), false);
});

test("structured choices validate without inferring positive direction", () => {
  const choices = defaultEvaluationChoices("delta");
  assert.equal(validateResponseValue("delta", choices, -1), true);
  assert.equal(validateResponseValue("delta", choices, 2), false);
  assert.equal(validateResponseValue("short_text", [], "Observation"), true);
});

test("club, type, disabled and archived criteria are filtered", () => {
  const criterion: Pick<EvaluationCriterion, "club_id" | "activity_types" | "is_active" | "archived_at"> = { club_id: "club-a", activity_types: ["training"], is_active: true, archived_at: null };
  assert.equal(criterionAppliesTo(criterion, "club-a", "training"), true);
  assert.equal(criterionAppliesTo(criterion, "club-b", "training"), false);
  assert.equal(criterionAppliesTo({ ...criterion, is_active: false }, "club-a", "training"), false);
  assert.equal(criterionAppliesTo({ ...criterion, archived_at: "2026-09-10" }, "club-a", "training"), false);
});

test("migration preserves snapshots and enforces tenant/RLS and independent roles", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260910_add_custom_evaluation_criteria.sql", import.meta.url), "utf8");
  assert.match(sql, /snapshot_name/);
  assert.match(sql, /Maximum three custom criteria per activity/);
  assert.match(sql, /public\.is_org_manager_member\(club_id, auth\.uid\(\)\)/);
  assert.match(sql, /unique \(event_criterion_id, player_id, respondent_role\)/);
  assert.match(sql, /on delete restrict/);
});
