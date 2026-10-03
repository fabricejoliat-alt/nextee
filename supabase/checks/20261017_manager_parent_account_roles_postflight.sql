-- Read-only. Expected: 8 rows, all ok=true. Run on the same TEST database.
with membership_indexes as (
  select i.*, array(select a.attname::text
    from unnest(i.indkey::smallint[]) with ordinality k(attnum,n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where k.n <= i.indnkeyatts order by a.attname) as columns
  from pg_index i where i.indrelid = 'public.club_members'::regclass
)
select '01 role-level uniqueness' as check_name, exists (
  select 1 from membership_indexes where indisunique and indisvalid and indimmediate
    and indpred is null and indexprs is null and columns = array['club_id','role','user_id']
) as ok
union all select '02 no legacy club-account uniqueness', not exists (
  select 1 from membership_indexes where indisunique and columns = array['club_id','user_id']
)
union all select '03 membership IDs remain primary', exists (
  select 1 from membership_indexes where indisprimary and columns = array['id']
)
union all select '04 no duplicate role memberships', not exists (
  select 1 from public.club_members group by club_id,user_id,role having count(*) > 1
)
union all select '05 membership RLS enabled', relrowsecurity
  from pg_class where oid = 'public.club_members'::regclass
union all select '06 guardian RPC private',
  not has_function_privilege('anon','public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE')
union all select '07 guardian RPC available to server',
  has_function_privilege('service_role','public.manage_player_guardian_v1(uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE')
union all select '08 membership scope columns required', count(*) = 3 and bool_and(attnotnull)
  from pg_attribute where attrelid = 'public.club_members'::regclass
    and attname in ('club_id','user_id','role') and not attisdropped
order by check_name;
