-- Pack 3: performance indexes for high-traffic reads (player/coach/manager).
-- Safe/idempotent with IF NOT EXISTS.

-- Rounds / score pages
create index if not exists idx_golf_rounds_user_start_at
  on public.golf_rounds (user_id, start_at desc);

create index if not exists idx_golf_round_holes_round_id
  on public.golf_round_holes (round_id);

-- Club events (calendar, upcoming, planning)
create index if not exists idx_club_events_group_starts_at
  on public.club_events (group_id, starts_at);

create index if not exists idx_club_events_club_starts_at
  on public.club_events (club_id, starts_at);

create index if not exists idx_club_events_group_status_starts_at
  on public.club_events (group_id, status, starts_at);

create index if not exists idx_club_events_club_status_starts_at
  on public.club_events (club_id, status, starts_at);

create index if not exists idx_club_events_series_id
  on public.club_events (series_id);

-- Event attendees / attendance analytics
create index if not exists idx_club_event_attendees_event_player
  on public.club_event_attendees (event_id, player_id);

create index if not exists idx_club_event_attendees_event_status
  on public.club_event_attendees (event_id, status);

create index if not exists idx_club_event_attendees_player_event
  on public.club_event_attendees (player_id, event_id);

-- Coach feedback lookups
create index if not exists idx_club_event_coach_feedback_event_player_coach
  on public.club_event_coach_feedback (event_id, player_id, coach_id);

create index if not exists idx_club_event_coach_feedback_coach_event
  on public.club_event_coach_feedback (coach_id, event_id);

-- Player feedback lookups
create index if not exists idx_club_event_player_feedback_event_player
  on public.club_event_player_feedback (event_id, player_id);

-- Training sessions / structures
create index if not exists idx_training_sessions_user_club_event_created
  on public.training_sessions (user_id, club_event_id, created_at desc);

create index if not exists idx_training_session_items_session_created
  on public.training_session_items (session_id, created_at);

-- Group membership / coach assignment
create index if not exists idx_coach_group_coaches_coach_group
  on public.coach_group_coaches (coach_user_id, group_id);

create index if not exists idx_coach_group_players_group_player
  on public.coach_group_players (group_id, player_user_id);

-- Club membership role filters
create index if not exists idx_club_members_user_role_active
  on public.club_members (user_id, role, is_active);

create index if not exists idx_club_members_club_role_active
  on public.club_members (club_id, role, is_active);

