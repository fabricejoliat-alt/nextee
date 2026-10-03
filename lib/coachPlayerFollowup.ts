export type CoachFollowupEvent = {
  id: string; starts_at: string; ends_at: string | null; event_type: string;
  title: string | null; group_id: string; club_id: string; status: string;
  location_text: string | null; group_name: string | null; organization_name: string | null;
  can_open_detail: boolean;
};
export type CoachFollowupSelfEvaluation = {
  id: string; club_event_id: string; motivation: number | null; difficulty: number | null;
  satisfaction: number | null; notes: string | null;
};
export type CoachFollowupCriterion = {
  event_id: string; id: string; snapshot_name: string; snapshot_choices: Array<{ value: unknown; label: string }>;
};
export type CoachFollowupResponse = {
  event_id: string; event_criterion_id: string; respondent_role: string; value_json: unknown;
};
export type CoachFollowupAttendance = { event_id: string; coach_recorded_status: string | null; status: string | null };
