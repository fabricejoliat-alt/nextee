begin;
-- Derive ownership from the business object, rather than trusting browser data.
create function public.organization_notification_owner(p_data jsonb) returns uuid
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare owner uuid; candidate uuid; object_id uuid; key text; begin
  foreach key in array array['event_id','group_id','thread_id','news_id','camp_id'] loop
    object_id:=nullif(p_data->>key,'')::uuid;
    if object_id is null then continue; end if;
    candidate:=null;
    case key
      when 'event_id' then select club_id into candidate from public.club_events where id=object_id;
      when 'group_id' then select club_id into candidate from public.coach_groups where id=object_id;
      when 'thread_id' then select organization_id into candidate from public.message_threads where id=object_id;
      when 'news_id' then select club_id into candidate from public.club_news where id=object_id;
      when 'camp_id' then select club_id into candidate from public.club_camps where id=object_id;
    end case;
    if owner is not null and candidate is not null and candidate<>owner then raise exception 'Notification ownership mismatch' using errcode='42501'; end if;
    owner:=coalesce(owner,candidate);
  end loop;
  candidate:=nullif(coalesce(p_data->>'organization_id',p_data->>'club_id'),'')::uuid;
  if owner is not null and candidate is not null and owner<>candidate then raise exception 'Notification ownership mismatch' using errcode='42501'; end if;
  -- Explicit scope supports notifications of an object that has just been deleted.
  return coalesce(owner,candidate);
end $$;
revoke all on function public.organization_notification_owner(jsonb) from public,anon,authenticated;

insert into public.organization_migration_baseline(object_key,definition)
select 'notification_owners_before',coalesce(jsonb_object_agg(id,club_id),'{}'::jsonb)::text from public.notifications;
update public.notifications set club_id=public.organization_notification_owner(data)
  where club_id is null and public.organization_notification_owner(data) is not null;

create function public.organization_notification_scope() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid; begin
  owner:=public.organization_notification_owner(new.data);
  if new.club_id is not null and owner is not null and new.club_id<>owner then raise exception 'Notification ownership mismatch' using errcode='42501'; end if;
  new.club_id:=coalesce(owner,new.club_id);
  if tg_op='UPDATE' and old.club_id is not null and new.club_id is distinct from old.club_id then raise exception 'Notification ownership is immutable'; end if;
  if new.club_id is null and not public.is_app_admin(coalesce(new.actor_user_id,new.created_by)) then
    raise exception 'Notification organization required' using errcode='42501';
  end if;
  if auth.role()='authenticated' and (new.actor_user_id is distinct from auth.uid()
    or (new.club_id is not null and not public.organization_actor_access(new.club_id,auth.uid()))) then
    raise exception 'Forbidden notification actor' using errcode='42501';
  end if;
  return new;
end $$;
create trigger notification_organization_scope before insert or update on public.notifications
for each row execute function public.organization_notification_scope();
revoke all on function public.organization_notification_scope() from public,anon,authenticated;

create function public.organization_notification_visible(p_notification uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.notifications n where n.id=p_notification and
    (public.is_app_admin(p_actor) or (n.club_id is null and public.is_app_admin(coalesce(n.actor_user_id,n.created_by)))
    or (n.club_id is not null and public.organization_actor_legal_ready(n.club_id,p_actor)
      and public.organization_actor_access(n.club_id,p_actor,nullif(n.data->>'child_id','')::uuid))));
$$;
revoke all on function public.organization_notification_visible(uuid,uuid) from public,anon;
grant execute on function public.organization_notification_visible(uuid,uuid) to authenticated,service_role;
create policy organization_notification_read on public.notification_recipients as restrictive for select to authenticated
using(public.organization_notification_visible(notification_id,auth.uid()));
create function public.organization_notification_recipient() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if not public.organization_notification_visible(new.notification_id,new.user_id) then
    if auth.role()='service_role' then return null; end if;
    raise exception 'Notification recipient outside authorized organization' using errcode='42501';
  end if;
  return new;
end $$;
create trigger notification_organization_recipient before insert or update on public.notification_recipients
for each row execute function public.organization_notification_recipient();
revoke all on function public.organization_notification_recipient() from public,anon,authenticated;

-- Keep the deleted object's organization available for scoped parent delivery.
do $$ declare r record; begin
  for r in select p.oid::regprocedure signature,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('delete_coach_planning_v1','delete_manager_planning_v1') loop
    insert into public.organization_migration_baseline values('function:'||r.signature,r.def) on conflict do nothing;
    execute replace(r.def,'''location_text'',location_text)', '''location_text'',location_text,''club_id'',club_id)');
  end loop;
end $$;
commit;
