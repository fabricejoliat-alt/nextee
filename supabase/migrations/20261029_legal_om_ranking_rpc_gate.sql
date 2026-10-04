-- Apply after 20261024 on isolated TEST. Legal enforcement remains constrained OFF.
-- Both historical overloads keep their public signatures and existing business checks.
begin;

alter function public.om_ranking_snapshot(uuid,date)
  rename to om_ranking_snapshot_legacy_business;
revoke all on function public.om_ranking_snapshot_legacy_business(uuid,date)
  from public,anon,authenticated;
grant execute on function public.om_ranking_snapshot_legacy_business(uuid,date) to service_role;

alter function public.om_ranking_snapshot(uuid,date,date)
  rename to om_ranking_snapshot_business;
revoke all on function public.om_ranking_snapshot_business(uuid,date,date)
  from public,anon,authenticated;
grant execute on function public.om_ranking_snapshot_business(uuid,date,date) to service_role;

create function public.om_ranking_snapshot(
  p_org_id uuid,p_as_of date default ((now() at time zone 'Europe/Zurich')::date))
returns table(player_id uuid,full_name text,tournament_points_net numeric,bonus_points_net numeric,
  total_points_net numeric,rank_net integer,tournament_points_brut numeric,bonus_points_brut numeric,
  total_points_brut numeric,rank_brut integer,period_slot smallint,period_limit integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_org_id) is not true then raise exception 'Legal validation required'; end if;
  return query select * from public.om_ranking_snapshot_legacy_business(p_org_id,p_as_of);
end $$;
revoke all on function public.om_ranking_snapshot(uuid,date) from public,anon,authenticated;
grant execute on function public.om_ranking_snapshot(uuid,date) to authenticated,service_role;

create function public.om_ranking_snapshot(
  p_org_id uuid,p_from date default null,
  p_as_of date default ((now() at time zone 'Europe/Zurich')::date))
returns table(player_id uuid,full_name text,tournament_points_net numeric,bonus_points_net numeric,
  total_points_net numeric,rank_net integer,tournament_points_brut numeric,bonus_points_brut numeric,
  total_points_brut numeric,rank_brut integer,period_slot smallint,period_limit integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if public.legal_required_direct_access(p_org_id) is not true then raise exception 'Legal validation required'; end if;
  return query select * from public.om_ranking_snapshot_business(p_org_id,p_from,p_as_of);
end $$;
revoke all on function public.om_ranking_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.om_ranking_snapshot(uuid,date,date) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
