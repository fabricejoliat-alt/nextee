-- Let managers choose how each camp option is answered by players.
-- Existing options keep the checkbox behaviour.

alter table public.club_camp_options
  add column if not exists input_type text not null default 'checkbox',
  add column if not exists choices jsonb not null default '[]'::jsonb;

alter table public.club_camp_options
  drop constraint if exists club_camp_options_input_type_check,
  add constraint club_camp_options_input_type_check
    check (input_type in ('checkbox', 'yes_no', 'select', 'radio')),
  drop constraint if exists club_camp_options_choices_check,
  add constraint club_camp_options_choices_check
    check (jsonb_typeof(choices) = 'array');

alter table public.club_camp_player_options
  add column if not exists selected_value text null;

