-- Non-performance players can log manual trainings with a duration and notes,
-- but still cannot submit performance-only sensations fields.

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
    if new.motivation is not null
       or new.difficulty is not null
       or new.satisfaction is not null then
      raise exception 'performance_mode_required';
    end if;
  end if;

  return new;
end;
$$;
