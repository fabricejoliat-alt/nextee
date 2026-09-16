import test from "node:test";
import assert from "node:assert/strict";
import { COACH_PERMISSION_PRESETS, DEFAULT_COACH_PERMISSIONS, canCoachSeePlayer, isFutureTransferAction, normalizeCoachPermissions } from "../lib/coachPermissions.ts";

test("les permissions Coach sont désactivées par défaut", () => {
  assert.deepEqual(DEFAULT_COACH_PERMISSIONS, { can_manage_assigned_groups: false, can_manage_assigned_group_planning: false, can_transfer_players_between_club_groups: false });
  assert.deepEqual(normalizeCoachPermissions(undefined), DEFAULT_COACH_PERMISSIONS);
});

test("les presets restent indépendants et limités", () => {
  assert.equal(COACH_PERMISSION_PRESETS.planner.can_manage_assigned_group_planning, true);
  assert.equal(COACH_PERMISSION_PRESETS.planner.can_manage_assigned_groups, false);
  assert.equal(COACH_PERMISSION_PRESETS.groupLead.can_manage_assigned_groups, true);
  assert.equal(COACH_PERMISSION_PRESETS.headCoach.can_transfer_players_between_club_groups, true);
  assert.equal(COACH_PERMISSION_PRESETS.headCoach.can_manage_assigned_group_planning, false);
});

test("un coach voit ses juniors et un Head Coach les juniors de son club uniquement", () => {
  assert.equal(canCoachSeePlayer({ assignedToPlayer: true, sameClub: false, permissions: DEFAULT_COACH_PERMISSIONS }), true);
  assert.equal(canCoachSeePlayer({ assignedToPlayer: false, sameClub: true, permissions: COACH_PERMISSION_PRESETS.headCoach }), true);
  assert.equal(canCoachSeePlayer({ assignedToPlayer: false, sameClub: false, permissions: COACH_PERMISSION_PRESETS.headCoach }), false);
});

test("seules les stratégies explicites d’activités futures sont acceptées", () => {
  assert.equal(isFutureTransferAction("keep"), true);
  assert.equal(isFutureTransferAction("remove_old"), true);
  assert.equal(isFutureTransferAction("move"), true);
  assert.equal(isFutureTransferAction("delete_history"), false);
});
