-- One account-wide unread count for APNs and the foreground iOS badge.
-- Only the service can request other accounts; authenticated users can read their own.
create or replace function public.notification_badge_counts_v1(p_user_ids uuid[])
returns table(user_id uuid, unread_count bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if cardinality(p_user_ids) > 500 then
    raise exception 'Too many badge recipients' using errcode='22023';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and
    (auth.uid() is null or exists(select 1 from unnest(p_user_ids) u where u is distinct from auth.uid())) then
    raise exception 'Forbidden badge recipients' using errcode='42501';
  end if;
  return query
    select requested.id, count(n.id)
    from (select distinct unnest(p_user_ids) as id) requested
    left join public.user_notification_preferences prefs on prefs.user_id=requested.id
    left join public.notification_recipients r on r.user_id=requested.id
      and not r.is_read and not r.is_deleted
      and coalesce(prefs.receive_in_app,true) and coalesce(prefs.receive_push,false)
    left join public.notifications n on n.id=r.notification_id
      and (coalesce(cardinality(prefs.enabled_kinds),0)=0 or n.kind=any(prefs.enabled_kinds))
      and public.organization_notification_visible(n.id,requested.id)
    group by requested.id;
end;
$$;
revoke all on function public.notification_badge_counts_v1(uuid[]) from public,anon;
grant execute on function public.notification_badge_counts_v1(uuid[]) to authenticated,service_role;
