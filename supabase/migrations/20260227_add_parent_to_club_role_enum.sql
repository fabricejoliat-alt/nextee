-- Ensure legacy enum club_role accepts parent.
-- Needed for inserts into public.club_members with role='parent'.

do $$
begin
  if exists (
    select 1
    from pg_type t
    where t.typname = 'club_role'
      and t.typtype = 'e'
  ) then
    if not exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'club_role'
        and e.enumlabel = 'parent'
    ) then
      execute 'alter type public.club_role add value ''parent''';
    end if;
  end if;
end $$;

