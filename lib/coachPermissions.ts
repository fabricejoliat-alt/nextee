export type CoachPermissions = {
  can_manage_assigned_groups: boolean;
  can_manage_assigned_group_planning: boolean;
  can_transfer_players_between_club_groups: boolean;
};

export const DEFAULT_COACH_PERMISSIONS: CoachPermissions = {
  can_manage_assigned_groups: false,
  can_manage_assigned_group_planning: false,
  can_transfer_players_between_club_groups: false,
};

export const COACH_PERMISSION_PRESETS = {
  supervising: DEFAULT_COACH_PERMISSIONS,
  planner: { ...DEFAULT_COACH_PERMISSIONS, can_manage_assigned_group_planning: true },
  groupLead: { ...DEFAULT_COACH_PERMISSIONS, can_manage_assigned_groups: true, can_manage_assigned_group_planning: true },
  headCoach: { ...DEFAULT_COACH_PERMISSIONS, can_transfer_players_between_club_groups: true },
} satisfies Record<string, CoachPermissions>;

export function normalizeCoachPermissions(value: Partial<CoachPermissions> | null | undefined): CoachPermissions {
  return {
    can_manage_assigned_groups: Boolean(value?.can_manage_assigned_groups),
    can_manage_assigned_group_planning: Boolean(value?.can_manage_assigned_group_planning),
    can_transfer_players_between_club_groups: Boolean(value?.can_transfer_players_between_club_groups),
  };
}

export function canCoachSeePlayer(options: { assignedToPlayer: boolean; sameClub: boolean; permissions: CoachPermissions }) {
  return options.assignedToPlayer || (options.sameClub && options.permissions.can_transfer_players_between_club_groups);
}

export function isFutureTransferAction(value: string): value is "keep" | "remove_old" | "move" {
  return value === "keep" || value === "remove_old" || value === "move";
}
