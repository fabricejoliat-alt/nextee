begin;
-- Remaining planning/news routines must resolve academies in the canonical
-- registry. Preserve the legacy alias where SQL references clubs.id.
do $$ declare f record; definition text; begin
  for f in select p.oid::regprocedure signature,pg_get_functiondef(p.oid) def from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.prokind='f' and p.prosrc like '%public.clubs%'
    and p.proname not in ('sync_organization_club_identity') loop
    insert into public.organization_migration_baseline(object_key,definition)
      values('function:'||f.signature,f.def) on conflict do nothing;
    definition:=replace(f.def,'join public.clubs on clubs.id','join public.organizations clubs on clubs.id');
    definition:=replace(definition,'from public.clubs','from public.organizations');
    execute definition;
  end loop;
  select p.oid::regprocedure signature,pg_get_functiondef(p.oid) def into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_player_golf_rounds_transactional_without_group_id';
  insert into public.organization_migration_baseline(object_key,definition) values('function:'||f.signature,f.def) on conflict do nothing;
  definition:=replace(f.def,'insert into public.golf_rounds ('||chr(10)||'      user_id,',
    'insert into public.golf_rounds ('||chr(10)||'      club_id,'||chr(10)||'      user_id,');
  definition:=replace(definition,') values ('||chr(10)||'      p_player_id,',') values ('||chr(10)||'      v_round.club_id,'||chr(10)||'      p_player_id,');
  if definition=f.def then raise exception 'Golf transactional ownership adaptation failed'; end if;
  execute definition;
  -- A pending second affiliation never blocks a valid round in the first one.
  for f in select p.oid::regprocedure signature,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_player_golf_hole_transactional_business','save_player_golf_holes_transactional_business','update_player_golf_round_transactional_business',
      'save_player_golf_hole_transactional','save_player_golf_holes_transactional','update_player_golf_round_transactional','create_player_golf_rounds_transactional') loop
    insert into public.organization_migration_baseline(object_key,definition) values('function:'||f.signature,f.def) on conflict do nothing;
    definition:=replace(f.def,'and coalesce(cm.player_consent_status, ''pending'')','and cm.club_id=v_round.club_id and coalesce(cm.player_consent_status, ''pending'')');
    definition:=replace(definition,'select om_organization_id into club','select club_id into club');
    definition:=replace(definition,'nullif(p_round_payload->>''om_organization_id'','''')::uuid','nullif(p_round_payload->>''club_id'','''')::uuid');
    execute definition;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
