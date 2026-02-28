-- Parent accounts should manage full player space by default.

alter table if exists public.player_guardians
  alter column can_edit set default true;

update public.player_guardians
set can_edit = true
where coalesce(can_edit, false) = false
  and coalesce(can_view, true) = true;
