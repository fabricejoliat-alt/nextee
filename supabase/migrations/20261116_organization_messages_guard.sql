begin;
-- Preserve existing thread/group restrictions and add today's scoped access.
do $$ declare r record; definition text; begin
  for r in select p.oid::regprocedure as signature,pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('can_manage_message_thread','can_read_message_thread','can_post_message_thread','can_create_message_thread') loop
    insert into public.organization_migration_baseline values('function:'||r.signature,r.def) on conflict do nothing;
    definition:=replace(r.def,'t.id = p_thread_id',
      't.id = p_thread_id and public.organization_actor_access(t.organization_id,p_user_id,t.player_id) and public.organization_actor_legal_ready(t.organization_id,p_user_id)');
    if r.signature::text like '%can_create_message_thread%' then
      definition:=replace(definition,'if p_org_id is null or p_user_id is null then',
        'if p_org_id is null or p_user_id is null or not public.organization_actor_access(p_org_id,p_user_id,p_player_id) or not public.organization_actor_legal_ready(p_org_id,p_user_id) then');
      definition:=replace(definition,'and public.is_group_staff_member(p_group_id, p_user_id)',
        'and exists(select 1 from public.coach_groups where id=p_group_id and club_id=p_org_id) and public.is_group_staff_member(p_group_id, p_user_id)');
    end if;
    execute definition;
  end loop;
end $$;
commit;
