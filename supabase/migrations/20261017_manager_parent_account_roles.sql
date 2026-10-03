-- Allow an existing club member to also be a parent without replacing any role.
-- The legacy two-column uniqueness conflicts with the three-column upserts used
-- by the application. Preserve membership IDs, references, data, grants and RLS.
begin;
set local lock_timeout = '5s';
lock table public.club_members in access exclusive mode;

do $$
declare
  v_pair smallint[];
  v_roles smallint[];
  v_index record;
begin
  select array_agg(attnum order by attnum) into v_pair
    from pg_attribute where attrelid = 'public.club_members'::regclass
      and attname in ('club_id', 'user_id') and not attisdropped;
  select array_agg(attnum order by attnum) into v_roles
    from pg_attribute where attrelid = 'public.club_members'::regclass
      and attname in ('club_id', 'user_id', 'role') and not attisdropped;
  if cardinality(v_pair) <> 2 or cardinality(v_roles) <> 3 then
    raise exception 'club_members: required membership columns are missing';
  end if;

  -- Install/retain role-level uniqueness before removing the legacy restriction.
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.club_members'::regclass and i.indisunique
      and i.indisvalid and i.indimmediate and i.indpred is null and i.indexprs is null
      and array(select k from unnest(i.indkey::smallint[]) with ordinality a(k,n)
        where n <= i.indnkeyatts order by k) = v_roles
  ) then
    create unique index club_members_club_user_role_unique_idx
      on public.club_members (club_id, user_id, role);
  end if;

  -- Only unconditional uniqueness on exactly (club_id, user_id) is obsolete.
  -- No CASCADE: a dependent foreign key aborts and rolls back the whole migration.
  for v_index in
    select i.indexrelid::regclass as index_name, c.conname, c.contype
    from pg_index i
    left join pg_constraint c on c.conindid = i.indexrelid
      and c.conrelid = i.indrelid and c.contype in ('p', 'u')
    where i.indrelid = 'public.club_members'::regclass and i.indisunique
      and not i.indisprimary and i.indpred is null and i.indexprs is null
      and array(select k from unnest(i.indkey::smallint[]) with ordinality a(k,n)
        where n <= i.indnkeyatts order by k) = v_pair
  loop
    if v_index.contype = 'u' then
      execute format('alter table public.club_members drop constraint %I', v_index.conname);
    else
      execute format('drop index %s', v_index.index_name);
    end if;
  end loop;
end;
$$;

commit;
