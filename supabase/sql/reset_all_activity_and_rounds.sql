-- Hard reset of all activity and recorded rounds across all organizations.
-- WARNING: this is destructive and irreversible.
-- It deletes (does not archive) events, training logs, OM activity data, and golf rounds.

begin;

truncate table
  public.club_event_player_structure_items,
  public.club_event_structure_items,
  public.club_event_attendees,
  public.club_event_coaches,
  public.training_session_items,
  public.player_activity_events,
  public.om_internal_contest_results,
  public.om_bonus_entries,
  public.om_tournament_scores,
  public.golf_round_holes,
  public.training_sessions,
  public.club_events,
  public.club_event_series,
  public.om_internal_contests,
  public.golf_rounds
restart identity cascade;

commit;
