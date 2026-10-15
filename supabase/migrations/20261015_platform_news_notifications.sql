begin;

alter table public.platform_news add column if not exists notification_initialized_at timestamptz;
-- Existing publications need an explicit catch-up, never a broadcast on deployment.
update public.platform_news set notification_initialized_at=now()
where status='published' and notification_initialized_at is null;

create table public.platform_news_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  news_id uuid not null references public.platform_news(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  push_status text not null default 'pending' check (push_status in ('pending','processing','completed','failed','uncertain','skipped')),
  claimed_at timestamptz,
  completed_at timestamptz,
  push_result jsonb,
  unique(news_id,user_id)
);
alter table public.platform_news_notification_deliveries enable row level security;
revoke all on public.platform_news_notification_deliveries from public,anon,authenticated;
grant all on public.platform_news_notification_deliveries to service_role;
create index platform_news_push_pending on public.platform_news_notification_deliveries(push_status) where push_status='pending';

create function public.enqueue_platform_news_notifications(p_news_id uuid,p_include_existing boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  news public.platform_news%rowtype; target record; notification uuid; inserted_recipient bigint;
  texts jsonb; params jsonb; french jsonb; created integer:=0; actor uuid;
begin
  select * into news from public.platform_news where id=p_news_id for update;
  if not found then raise exception 'NEWS_NOT_FOUND'; end if;
  if news.status='scheduled' and news.scheduled_for<=now() then
    update public.platform_news set status='published',published_at=coalesce(published_at,now()) where id=p_news_id;
    news.status:='published';
  end if;
  if news.status<>'published' or (news.notification_initialized_at is not null and not p_include_existing) then
    return jsonb_build_object('created',0);
  end if;
  actor:=coalesce(news.updated_by,news.created_by);
  if not public.is_app_admin(actor) then raise exception 'ADMIN_ACTOR_REQUIRED'; end if;
  select jsonb_object_agg(locale,jsonb_build_object('newsTitle',title,'newsSummary',coalesce(nullif(summary,''),title)))
    into texts from public.platform_news_translations where news_id=p_news_id;
  french:=texts->'fr';
  if french is null then raise exception 'FRENCH_TITLE_REQUIRED'; end if;
  select jsonb_object_agg(locale,coalesce(texts->locale,french)) into params
    from unnest(array['fr','en','de','it']) locale;

  for target in
    with candidates as (
      select cm.user_id,t.club_id,cm.role::text as role,null::uuid as child_id,
        case cm.role when 'manager' then 0 when 'coach' then 1 else 2 end as priority
      from public.platform_news_clubs t join public.club_members cm on cm.club_id=t.club_id
      where t.news_id=p_news_id and cm.is_active and cm.role::text=any(t.target_roles)
      union all
      select g.guardian_user_id,t.club_id,'player',g.player_id,3
      from public.platform_news_clubs t
      join public.club_members cm on cm.club_id=t.club_id and cm.role='player' and cm.is_active
      join public.player_guardian_scopes g on g.organization_id=t.club_id and g.player_id=cm.user_id
      where t.news_id=p_news_id and 'player'=any(t.target_roles) and g.status='active' and g.can_view
    )
    select distinct on (c.user_id) c.* from candidates c
    left join public.user_notification_preferences pref on pref.user_id=c.user_id
    where c.user_id<>actor and coalesce(pref.receive_in_app,true)
      and (coalesce(cardinality(pref.enabled_kinds),0)=0 or 'manager_news'=any(pref.enabled_kinds))
      and public.organization_actor_legal_ready(c.club_id,c.user_id)
      and public.organization_actor_access(c.club_id,c.user_id,c.child_id)
    order by c.user_id,c.priority,c.club_id,c.child_id
  loop
    if exists(select 1 from public.platform_news_notification_deliveries where news_id=p_news_id and user_id=target.user_id) then continue; end if;
    insert into public.notifications(actor_user_id,type,kind,title,body,data)
    values(actor,'manager_news','manager_news',french->>'newsTitle',french->>'newsSummary',jsonb_build_object(
      'club_id',target.club_id,'platform_news_id',p_news_id,'child_id',target.child_id,
      'url','/'||target.role||'/news'||case when target.role='manager' then '?club='||target.club_id::text when target.child_id is not null then '?child_id='||target.child_id::text else '' end,
      'template_key','notif.managerNews','template_params',french,'template_params_by_locale',params))
    returning id into notification;
    inserted_recipient:=null;
    insert into public.notification_recipients(notification_id,user_id) values(notification,target.user_id) returning id into inserted_recipient;
    if inserted_recipient is null then
      delete from public.notifications where id=notification;
      continue;
    end if;
    insert into public.platform_news_notification_deliveries(news_id,user_id,notification_id) values(p_news_id,target.user_id,notification);
    created:=created+1;
  end loop;
  update public.platform_news set notification_initialized_at=coalesce(notification_initialized_at,now()) where id=p_news_id;
  return jsonb_build_object('created',created);
end $$;
revoke all on function public.enqueue_platform_news_notifications(uuid,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_platform_news_notifications(uuid,boolean) to service_role;

create function public.claim_platform_news_push_deliveries(p_news_id uuid default null,p_limit integer default 20)
returns setof jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- A worker that disappeared might already have sent its push. Never resend blindly.
  update public.platform_news_notification_deliveries set push_status='uncertain'
    where push_status='processing' and claimed_at<now()-interval '15 minutes';
  return query
    with picked as (
      select id from public.platform_news_notification_deliveries
      where push_status='pending' and (p_news_id is null or news_id=p_news_id)
      order by id for update skip locked limit greatest(1,least(p_limit,100))
    ), claimed as (
      update public.platform_news_notification_deliveries d set push_status='processing',claimed_at=now()
      from picked where d.id=picked.id returning d.*
    )
    select jsonb_build_object('id',c.id,'user_id',c.user_id,'news_id',c.news_id,
      'notification_id',c.notification_id,'notification',to_jsonb(n),'published',p.status='published')
    from claimed c join public.notifications n on n.id=c.notification_id join public.platform_news p on p.id=c.news_id;
end $$;
revoke all on function public.claim_platform_news_push_deliveries(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_platform_news_push_deliveries(uuid,integer) to service_role;

commit;
