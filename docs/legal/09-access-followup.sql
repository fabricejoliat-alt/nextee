-- Read-only follow-up on isolated TEST. One result grid to export in full.
-- Inspect current database definitions before changing any direct-access policy or RPC.
with bucket_rows as (
  select 'bucket'::text as category,b.id::text as item,
    jsonb_build_object('public',b.public,'name',b.name) as details
  from storage.buckets b
), policy_rows as (
  select 'policy_mode'::text as category,n.nspname||'.'||c.relname||' / '||p.polname as item,
    jsonb_build_object('permissive',p.polpermissive,'command',p.polcmd,
      'roles',array(select case when assigned.role_oid=0 then 'PUBLIC' else role_name.rolname end
        from unnest(p.polroles) as assigned(role_oid)
        left join pg_roles role_name on role_name.oid=assigned.role_oid
        order by 1)) as details
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' and c.relname in (
    'marketplace_items','club_events','club_event_attendees','training_sessions',
    'training_session_items','golf_rounds','golf_round_holes','coach_groups','coach_group_players'))
    or (n.nspname='storage' and c.relname='objects')
), rpc_rows as (
  select 'rpc_definition'::text as category,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as item,
    jsonb_build_object('definition',pg_get_functiondef(p.oid)) as details
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and p.proname in (
    'create_coach_events_v1','create_manager_events_v1','create_player_golf_rounds_transactional',
    'save_coach_training_debrief','save_coach_training_debrief_v2',
    'set_player_performance_mode','om_ranking_snapshot')
)
select category,item,details from bucket_rows
union all select category,item,details from policy_rows
union all select category,item,details from rpc_rows
order by category,item;
