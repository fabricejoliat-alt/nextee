-- Identity names of active players are managed by authorized staff.
create or replace function public.prevent_player_self_name_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name)
    and auth.role() = 'authenticated'
    and auth.uid() = old.id
    and exists (
      select 1 from public.club_members cm
      where cm.user_id = old.id and cm.role = 'player' and cm.is_active = true
    ) then
    raise exception 'A player cannot change their own name'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_player_self_name_change on public.profiles;
create trigger trg_prevent_player_self_name_change
before update of first_name, last_name on public.profiles
for each row execute function public.prevent_player_self_name_change();
