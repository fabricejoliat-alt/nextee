-- Manager OM writes: scoped, transactional, versioned and retry-safe.
-- Uses the existing 15 / 10 / 5 podium rule without changing tournament scoring.
begin;
create table if not exists public.manager_om_write_requests (
 actor_id uuid not null,request_id uuid not null,payload jsonb not null,result jsonb,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
alter table public.manager_om_write_requests enable row level security;
revoke all on public.manager_om_write_requests from public,anon,authenticated;

create or replace function public.manager_om_contest_version_v1(p_id uuid)
returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_object('contest',to_jsonb(c),
  'results',coalesce((select jsonb_agg(to_jsonb(r) order by r.player_id) from public.om_internal_contest_results r where r.contest_id=c.id),'[]'),
  'bonuses',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.om_bonus_entries b where b.source_table='om_internal_contests' and b.source_id=c.id and b.bonus_type='internal_contest_podium'),'[]'))::text)
 from public.om_internal_contests c where c.id=p_id;
$$;
revoke all on function public.manager_om_contest_version_v1(uuid) from public,anon,authenticated;

create or replace function public.get_manager_om_data_v1(p_club_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_manager_club_scope_v1(auth.uid(),p_club_id);
 if p_kind='contest' then
  return jsonb_build_object('club_id',p_club_id,'rows',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('version',public.manager_om_contest_version_v1(c.id)) order by c.contest_date desc,c.id) from public.om_internal_contests c where c.organization_id=p_club_id),'[]'),
   'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'is_active',g.is_active,'club_season_id',g.club_season_id) order by g.name,g.id) from public.coach_groups g where g.club_id=p_club_id),'[]'));
 elsif p_kind='tournament' then
  return jsonb_build_object('club_id',p_club_id,'rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('version',md5(to_jsonb(r)::text)) order by r.starts_on desc nulls last,r.id) from public.om_exceptional_tournaments r where r.organization_id=p_club_id),'[]'),'groups','[]'::jsonb);
 end if;
 raise exception 'invalid_kind';
end $$;
revoke all on function public.get_manager_om_data_v1(uuid,text) from public,anon;
grant execute on function public.get_manager_om_data_v1(uuid,text) to authenticated;

create or replace function public.get_manager_om_contest_v1(p_contest_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.om_internal_contests%rowtype;
begin
 select * into c from public.om_internal_contests where id=p_contest_id for share;
 if c.id is null then raise exception 'contest_not_found'; end if;
 perform public.require_manager_club_scope_v1(auth.uid(),c.organization_id);
 return jsonb_build_object('contest',to_jsonb(c),'version',public.manager_om_contest_version_v1(c.id),
  'results',coalesce((select jsonb_agg(to_jsonb(r) order by r.rank,r.player_id) from public.om_internal_contest_results r where r.contest_id=c.id),'[]'),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'first_name',p.first_name,'last_name',p.last_name) order by p.last_name,p.first_name,p.id)
   from public.profiles p where exists(select 1 from public.om_internal_contest_results r where r.contest_id=c.id and r.player_id=p.id)
    or (exists(select 1 from public.club_members m where m.club_id=c.organization_id and m.user_id=p.id and m.role='player' and m.is_active)
     and (c.group_id is null or exists(select 1 from public.coach_group_players gp where gp.group_id=c.group_id and gp.player_user_id=p.id)))),'[]'));
end $$;
revoke all on function public.get_manager_om_contest_v1(uuid) from public,anon;
grant execute on function public.get_manager_om_contest_v1(uuid) to authenticated;

create or replace function public.write_manager_om_v1(p_request_id uuid,p_club_id uuid,p_kind text,p_action text,p_id uuid,p_expected text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.om_internal_contests%rowtype; tour public.om_exceptional_tournaments%rowtype;
 req public.manager_om_write_requests%rowtype; body jsonb; v_result jsonb; v_version text; v_id uuid; v_group uuid;
 v_title text; v_start date; v_end date; rankings jsonb; item jsonb; v_player uuid; v_rank int; v_points numeric; v_saved int; v_bonus int;
begin
 perform public.require_manager_club_scope_v1(auth.uid(),p_club_id);
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or p_kind is null or p_kind not in ('contest','tournament')
  or p_action is null or p_action not in ('create','delete','toggle','publish') then raise exception 'invalid_request'; end if;
 body:=jsonb_build_object('club',p_club_id,'kind',p_kind,'action',p_action,'id',p_id,'expected',p_expected,'payload',p_payload);
 insert into public.manager_om_write_requests(actor_id,request_id,payload) values(auth.uid(),p_request_id,body) on conflict do nothing;
 select * into req from public.manager_om_write_requests where actor_id=auth.uid() and request_id=p_request_id for update;
 if req.payload is distinct from body then raise exception 'request_conflict'; end if;
 if req.result is not null then return req.result||jsonb_build_object('replayed',true); end if;
 if p_action='create' then
  if p_id is not null then raise exception 'invalid_request'; end if;
  v_title:=nullif(btrim(p_payload->>'name'),'');
  if v_title is null or length(v_title)>500 or length(coalesce(p_payload->>'description',''))>10000 then raise exception 'invalid_fields'; end if;
  if p_kind='contest' then
   v_start:=(p_payload->>'date')::date; v_group:=nullif(p_payload->>'group_id','')::uuid;
   if v_start is null then raise exception 'invalid_dates'; end if;
   if v_group is not null then
    perform 1 from public.coach_groups g where g.id=v_group and g.club_id=p_club_id and g.is_active is distinct from false and g.club_season_id is not null and coalesce(g.name,'') !~ '^(__ARCHIVE_|__EVENT_SPECIFIQUE__)' and coalesce(g.name,'')<>'Groupe spécifique' for share;
    if not found then raise exception 'invalid_group'; end if;
   end if;
   insert into public.om_internal_contests(organization_id,group_id,title,description,contest_date,created_by)
    values(p_club_id,v_group,v_title,nullif(btrim(p_payload->>'description'),''),v_start,auth.uid()) returning id into v_id;
  else
   v_start:=nullif(p_payload->>'starts_on','')::date; v_end:=nullif(p_payload->>'ends_on','')::date;
   if v_start is not null and v_end is not null and v_end<v_start then raise exception 'invalid_dates'; end if;
   insert into public.om_exceptional_tournaments(organization_id,name,description,starts_on,ends_on,is_active,created_by)
    values(p_club_id,v_title,nullif(btrim(p_payload->>'description'),''),v_start,v_end,true,auth.uid()) returning id into v_id;
  end if;
 else
  v_id:=p_id;
  if p_kind='contest' then
   select * into c from public.om_internal_contests where id=p_id for update;
   if c.id is null then raise exception 'contest_not_found'; end if;
   if c.organization_id is distinct from p_club_id then raise exception 'forbidden'; end if;
   perform 1 from public.om_internal_contest_results where contest_id=p_id for update;
   perform 1 from public.om_bonus_entries where source_table='om_internal_contests' and source_id=p_id and bonus_type='internal_contest_podium' for update;
   v_version:=public.manager_om_contest_version_v1(p_id);
  else
   select * into tour from public.om_exceptional_tournaments where id=p_id for update;
   if tour.id is null then raise exception 'tournament_not_found'; end if;
   if tour.organization_id is distinct from p_club_id then raise exception 'forbidden'; end if;
   v_version:=md5(to_jsonb(tour)::text);
  end if;
  if p_expected is null or p_expected is distinct from v_version then raise exception 'om_conflict'; end if;
  if p_action='delete' then
   if p_kind='contest' then
    delete from public.om_bonus_entries where source_table='om_internal_contests' and source_id=p_id and bonus_type='internal_contest_podium';
    delete from public.om_internal_contests where id=p_id;
   else
    -- A referenced tournament is deactivated instead: deleting it must not rewrite played rounds.
    if exists(select 1 from public.golf_rounds where om_exceptional_tournament_id=p_id) then raise exception 'tournament_in_use'; end if;
    delete from public.om_exceptional_tournaments where id=p_id;
   end if;
  elsif p_action='toggle' and p_kind='tournament' then
   if jsonb_typeof(p_payload->'is_active') is distinct from 'boolean' then raise exception 'invalid_fields'; end if;
   update public.om_exceptional_tournaments set is_active=(p_payload->>'is_active')::boolean where id=p_id;
  elsif p_action='publish' and p_kind='contest' then
   rankings:=p_payload->'rankings';
   if jsonb_typeof(rankings) is distinct from 'array' or jsonb_array_length(rankings)>2000 then raise exception 'invalid_rankings'; end if;
   if jsonb_array_length(rankings)=0 and exists(select 1 from public.om_internal_contest_results where contest_id=p_id)
    and not coalesce((p_payload->>'allow_empty')::boolean,false) then raise exception 'empty_confirmation_required'; end if;
   if exists(select 1 from jsonb_array_elements(rankings) x group by x->>'player_id' having count(*)>1) then raise exception 'duplicate_player'; end if;
   for item in select * from jsonb_array_elements(rankings) loop
    v_player:=(item->>'player_id')::uuid;
    if v_player is null or (item->>'rank') is null or (item->>'rank') !~ '^[0-9]+$' or (item->>'rank')::numeric not between 1 and 10000 or length(coalesce(item->>'note',''))>10000 then raise exception 'invalid_rankings'; end if;
    if not exists(select 1 from public.om_internal_contest_results where contest_id=p_id and player_id=v_player) then
     perform 1 from public.club_members where club_id=p_club_id and user_id=v_player and role='player' and is_active for share;
     if not found then raise exception 'invalid_player'; end if;
     if c.group_id is not null then
      perform 1 from public.coach_groups g join public.coach_group_players gp on gp.group_id=g.id where g.id=c.group_id and g.club_id=p_club_id and gp.player_user_id=v_player for share of g,gp;
      if not found then raise exception 'invalid_player'; end if;
     end if;
    end if;
   end loop;
   delete from public.om_internal_contest_results r where r.contest_id=p_id and not exists(select 1 from jsonb_array_elements(rankings) x where (x->>'player_id')::uuid=r.player_id);
   for item in select * from jsonb_array_elements(rankings) loop
    v_player:=(item->>'player_id')::uuid;v_rank:=(item->>'rank')::int;v_points:=case v_rank when 1 then 15 when 2 then 10 when 3 then 5 else 0 end;
    insert into public.om_internal_contest_results(contest_id,player_id,rank,points_net,points_brut,note)
     values(p_id,v_player,v_rank,v_points,v_points,nullif(btrim(item->>'note'),''))
     on conflict(contest_id,player_id) do update set rank=excluded.rank,points_net=excluded.points_net,points_brut=excluded.points_brut,note=excluded.note;
   end loop;
   -- Drop only obsolete/duplicate generated podium entries. Keep IDs for unchanged participants.
   delete from public.om_bonus_entries b where b.source_table='om_internal_contests' and b.source_id=p_id and b.bonus_type='internal_contest_podium' and (
    b.organization_id<>p_club_id or not exists(select 1 from public.om_internal_contest_results r where r.contest_id=p_id and r.player_id=b.player_id and r.rank<=3)
    or exists(select 1 from public.om_bonus_entries older where older.source_table=b.source_table and older.source_id=b.source_id and older.bonus_type=b.bonus_type and older.player_id=b.player_id and older.organization_id=p_club_id and (older.created_at,older.id)<(b.created_at,b.id)));
   for item in select * from jsonb_array_elements(rankings) loop
    v_player:=(item->>'player_id')::uuid;v_rank:=(item->>'rank')::int;
    if v_rank>3 then continue; end if;
    v_points:=case v_rank when 1 then 15 when 2 then 10 else 5 end;
    update public.om_bonus_entries set points_net=v_points,points_brut=v_points,occurred_on=c.contest_date
     where source_table='om_internal_contests' and source_id=p_id and bonus_type='internal_contest_podium' and player_id=v_player and organization_id=p_club_id;
    if not found then
     insert into public.om_bonus_entries(organization_id,player_id,bonus_type,points_net,points_brut,source_table,source_id,description,occurred_on,created_by)
      values(p_club_id,v_player,'internal_contest_podium',v_points,v_points,'om_internal_contests',p_id,'Internal contest podium',c.contest_date,auth.uid());
    end if;
   end loop;
   update public.om_internal_contests set full_ranking=coalesce((select jsonb_agg(jsonb_build_object('rank',r.rank,'player_id',r.player_id,'player_name',nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'note',r.note) order by r.rank,r.player_id)
    from public.om_internal_contest_results r join public.profiles p on p.id=r.player_id where r.contest_id=p_id),'[]'),updated_at=clock_timestamp() where id=p_id;
   select count(*) into v_saved from public.om_internal_contest_results where contest_id=p_id;
   select count(*) into v_bonus from public.om_bonus_entries where source_table='om_internal_contests' and source_id=p_id and bonus_type='internal_contest_podium';
  else raise exception 'invalid_action'; end if;
 end if;
 v_result:=jsonb_build_object('ok',true,'id',v_id,'action',p_action,'saved_rows',v_saved,'bonus_rows',v_bonus,'replayed',false);
 update public.manager_om_write_requests set result=v_result where actor_id=auth.uid() and request_id=p_request_id;
 return v_result;
end $$;
revoke all on function public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb) from public,anon;
grant execute on function public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb) to authenticated;

-- Aggregate server-side so PostgREST row limits cannot silently truncate point details.
create or replace function public.get_manager_om_ranking_v1(p_club_id uuid,p_from date,p_to date,p_player_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ranking jsonb;
begin
 perform public.require_manager_club_scope_v1(auth.uid(),p_club_id);
 if p_from is null or p_to is null or p_to<p_from then raise exception 'invalid_dates';end if;
 if p_player_id is null then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into ranking from public.om_ranking_snapshot(p_club_id,p_from,p_to) r;
  return jsonb_build_object('club_id',p_club_id,'rows',ranking,'avatars',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'avatar_url',p.avatar_url)) from public.profiles p where exists(select 1 from jsonb_array_elements(ranking) r where r->>'player_id'=p.id::text)),'[]'));
 end if;
 return jsonb_build_object('club_id',p_club_id,'player_id',p_player_id,
  'scores',coalesce((select jsonb_agg(to_jsonb(s)) from public.om_tournament_scores s where s.organization_id=p_club_id and s.player_id=p_player_id and s.occurred_on between p_from and p_to),'[]'),
  'bonuses',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'bonus_type',b.bonus_type,'points_net',b.points_net,'points_brut',b.points_brut,'description',b.description,'occurred_on',b.occurred_on)) from public.om_bonus_entries b where b.organization_id=p_club_id and b.player_id=p_player_id and b.occurred_on between p_from and p_to),'[]'),
  'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'start_at',r.start_at,'competition_name',r.competition_name,'course_name',r.course_name)) from public.golf_rounds r where exists(select 1 from public.om_tournament_scores s where s.round_id=r.id and s.organization_id=p_club_id and s.player_id=p_player_id and s.occurred_on between p_from and p_to)),'[]'));
end $$;
revoke all on function public.get_manager_om_ranking_v1(uuid,date,date,uuid) from public,anon;
grant execute on function public.get_manager_om_ranking_v1(uuid,date,date,uuid) to authenticated;

-- Force client writes through the validated entry point. Existing reads and player selection remain available.
revoke insert,update,delete on public.om_internal_contests,public.om_internal_contest_results,public.om_exceptional_tournaments from public,anon,authenticated;
revoke all on function public.om_publish_internal_contest(uuid,jsonb,jsonb) from public,anon,authenticated;
drop policy if exists manager_om_podium_insert on public.om_bonus_entries;
create policy manager_om_podium_insert on public.om_bonus_entries as restrictive for insert to authenticated with check(bonus_type<>'internal_contest_podium');
drop policy if exists manager_om_podium_update on public.om_bonus_entries;
create policy manager_om_podium_update on public.om_bonus_entries as restrictive for update to authenticated using(bonus_type<>'internal_contest_podium') with check(bonus_type<>'internal_contest_podium');
drop policy if exists manager_om_podium_delete on public.om_bonus_entries;
create policy manager_om_podium_delete on public.om_bonus_entries as restrictive for delete to authenticated using(bonus_type<>'internal_contest_podium');
notify pgrst,'reload schema';
commit;
