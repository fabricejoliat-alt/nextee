-- Enforce that only performance-enabled players can structure/evaluate trainings.
-- Applies to training_sessions and training_session_items writes.

create or replace function public.is_user_performance_enabled_globally(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_members cm
    where cm.user_id = p_player_id
      and cm.role = 'player'
      and cm.is_active = true
      and coalesce(cm.is_performance, false) = true
  );
$$;

grant execute on function public.is_user_performance_enabled_globally(uuid) to authenticated;

create or replace function public.enforce_performance_mode_on_training_sessions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    raise exception 'missing_player_id';
  end if;

  if not public.is_user_performance_enabled_globally(new.user_id) then
    raise exception 'performance_mode_required';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_performance_mode_on_training_sessions on public.training_sessions;
create trigger trg_enforce_performance_mode_on_training_sessions
before insert or update on public.training_sessions
for each row execute function public.enforce_performance_mode_on_training_sessions();

create or replace function public.enforce_performance_mode_on_training_session_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  if new.session_id is null then
    raise exception 'missing_session_id';
  end if;

  select ts.user_id
  into v_player_id
  from public.training_sessions ts
  where ts.id = new.session_id;

  if v_player_id is null then
    raise exception 'training_session_not_found';
  end if;

  if not public.is_user_performance_enabled_globally(v_player_id) then
    raise exception 'performance_mode_required';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_performance_mode_on_training_session_items on public.training_session_items;
create trigger trg_enforce_performance_mode_on_training_session_items
before insert or update on public.training_session_items
for each row execute function public.enforce_performance_mode_on_training_session_items();

