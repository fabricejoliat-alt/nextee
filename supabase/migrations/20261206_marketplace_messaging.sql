begin;

alter table public.marketplace_contact_messages
  add column actor_id uuid references public.profiles(id) on delete set null,
  add column reply_to_id uuid references public.marketplace_contact_messages(id) on delete set null,
  add column client_request_id uuid,
  add column email_claimed_at timestamptz,
  add column sender_deleted_at timestamptz,
  add column recipient_deleted_at timestamptz,
  add column notification_id uuid unique references public.notifications(id) on delete set null,
  add column push_status text not null default 'skipped'
    check(push_status in ('skipped','pending','processing','completed','failed','uncertain')),
  add column push_claimed_at timestamptz,
  add column push_result jsonb;
-- Preserve the actor of existing messages; never notify historical messages.
update public.marketplace_contact_messages set actor_id=sender_id;
alter table public.marketplace_contact_messages drop constraint marketplace_contact_messages_message_check;
alter table public.marketplace_contact_messages add constraint marketplace_contact_messages_message_check check(length(message) between 1 and 4000);
create unique index marketplace_message_request on public.marketplace_contact_messages(actor_id,client_request_id) where client_request_id is not null;
create index marketplace_message_sent on public.marketplace_contact_messages(sender_id,created_at desc) where sender_deleted_at is null;
create index marketplace_message_push_pending on public.marketplace_contact_messages(push_status) where push_status='pending';

-- In-app delivery is part of the message transaction. Push is claimed separately.
create function public.notify_marketplace_message() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; notification uuid; inserted public.notification_recipients.id%type; delivered boolean:=false;
begin
  for target in
    select distinct c.user_id from (
      select new.recipient_id as user_id
      union select g.guardian_user_id from public.player_guardian_scopes g
        where g.organization_id=new.club_id and g.player_id=new.recipient_id and g.status='active' and g.can_view
    ) c left join public.user_notification_preferences pref on pref.user_id=c.user_id
    where c.user_id<>coalesce(new.actor_id,new.sender_id)
      and coalesce(pref.receive_in_app,true)
      and (coalesce(cardinality(pref.enabled_kinds),0)=0 or 'marketplace_message'=any(pref.enabled_kinds))
      and not public.marketplace_pair_blocked(c.user_id,new.recipient_id,new.sender_id,new.club_id)
      and not public.marketplace_pair_blocked(c.user_id,new.recipient_id,coalesce(new.actor_id,new.sender_id),new.club_id)
      and public.organization_actor_legal_ready(new.club_id,c.user_id)
      and public.organization_actor_access(new.club_id,c.user_id,new.recipient_id,false)
  loop
    if notification is null then
      -- Keep child exchanges independent from the acting parent's account erasure.
      insert into public.notifications(actor_user_id,club_id,type,kind,title,body,data)
      values(new.sender_id,new.club_id,'marketplace_message','marketplace_message',
        'Nouveau message du Marketplace','Un nouveau message est disponible dans le Marketplace.',
        jsonb_build_object('organization_id',new.club_id,'child_id',new.recipient_id,'marketplace_message_id',new.id,
          'url','/player/marketplace/messages?message='||new.id::text||'&child_id='||new.recipient_id::text,
          'template_key','notif.marketplaceMessage','template_params','{}'::jsonb)) returning id into notification;
    end if;
    inserted:=null;
    insert into public.notification_recipients(notification_id,user_id) values(notification,target) returning id into inserted;
    delivered:=delivered or inserted is not null;
  end loop;
  if delivered then
    update public.marketplace_contact_messages set notification_id=notification,push_status='pending' where id=new.id;
  elsif notification is not null then
    delete from public.notifications where id=notification;
  end if;
  return new;
end $$;
create trigger marketplace_message_notification after insert on public.marketplace_contact_messages
  for each row execute function public.notify_marketplace_message();
revoke all on function public.notify_marketplace_message() from public,anon,authenticated;

create function public.send_marketplace_contact_v2(p_actor uuid,p_subject uuid,p_item uuid,p_email text,p_subject_text text,p_message text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.marketplace_items; message_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_actor is null or p_subject is null or p_message is null or p_subject_text is null or p_email is null or length(trim(p_message)) not between 10 and 4000
    or length(trim(p_subject_text)) not between 3 and 160 or length(p_email)>254 then raise exception 'Invalid message' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-contact:'||p_actor::text,0));
  select * into item from public.marketplace_items where id=p_item;
  if not found or not item.is_active or item.moderation_status<>'approved' or item.user_id in(p_actor,p_subject)
    or not public.organization_actor_access(item.club_id,p_actor,p_subject,true)
    or public.marketplace_pair_blocked(p_actor,p_subject,item.user_id,item.club_id) then
    raise exception 'Contact unavailable' using errcode='42501';
  end if;
  select id into message_id from public.marketplace_contact_messages where actor_id=p_actor and client_request_id=p_request_id;
  if found then
    if not exists(select 1 from public.marketplace_contact_messages where id=message_id and sender_id=p_subject
      and item_id=p_item and reply_to_id is null and message=trim(p_message) and subject=trim(p_subject_text) and reply_email=p_email) then
      raise exception 'Request already used' using errcode='22023'; end if;
    return message_id;
  end if;
  if (select count(*) from public.marketplace_contact_messages where coalesce(actor_id,sender_id)=p_actor
    and reply_to_id is null and created_at>now()-interval '10 minutes')>=3 then raise exception 'Rate limited' using errcode='P0001'; end if;
  insert into public.marketplace_contact_messages(item_id,club_id,sender_id,actor_id,recipient_id,reply_email,subject,message,client_request_id)
    values(item.id,item.club_id,p_subject,p_actor,item.user_id,p_email,trim(p_subject_text),trim(p_message),p_request_id) returning id into message_id;
  return message_id;
end $$;
revoke all on function public.send_marketplace_contact_v2(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.send_marketplace_contact_v2(uuid,uuid,uuid,text,text,text,uuid) to service_role;

-- Keep the previous app release working while the new code is deployed.
create or replace function public.reserve_marketplace_contact(p_actor uuid,p_subject uuid,p_item uuid,p_email text,p_subject_text text,p_message text)
returns uuid language sql security definer set search_path=public,pg_temp as $$
  select public.send_marketplace_contact_v2(p_actor,p_subject,p_item,p_email,p_subject_text,p_message,null);
$$;

create function public.reply_marketplace_message(p_actor uuid,p_subject uuid,p_message_id uuid,p_message text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.marketplace_contact_messages; message_id uuid; email text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_actor is null or p_subject is null or p_request_id is null or p_message is null or length(trim(p_message)) not between 1 and 4000 then
    raise exception 'Invalid message' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-contact:'||p_actor::text,0));
  select * into original from public.marketplace_contact_messages where id=p_message_id and recipient_id=p_subject and recipient_deleted_at is null for update;
  if not found or original.sender_id in(p_actor,p_subject)
    or not public.organization_actor_access(original.club_id,p_actor,p_subject,true)
    or not exists(select 1 from public.organization_members where organization_id=original.club_id and user_id=original.sender_id and role='player' and is_active)
    or public.marketplace_pair_blocked(p_actor,p_subject,original.sender_id,original.club_id)
    or (original.actor_id is not null and public.marketplace_pair_blocked(p_actor,p_subject,original.actor_id,original.club_id)) then
    raise exception 'Reply unavailable' using errcode='42501'; end if;
  select id into message_id from public.marketplace_contact_messages where actor_id=p_actor and client_request_id=p_request_id;
  if found then
    if not exists(select 1 from public.marketplace_contact_messages where id=message_id and sender_id=p_subject
      and reply_to_id=p_message_id and message=trim(p_message)) then
      raise exception 'Request already used' using errcode='22023'; end if;
    return message_id;
  end if;
  if (select count(*) from public.marketplace_contact_messages where coalesce(actor_id,sender_id)=p_actor and created_at>now()-interval '10 minutes')>=10 then
    raise exception 'Rate limited' using errcode='P0001'; end if;
  select coalesce(nullif(u.email,''),'') into email from auth.users u where u.id=p_actor;
  if email like '%@noemail.local' then email:=''; end if;
  insert into public.marketplace_contact_messages(item_id,club_id,sender_id,actor_id,recipient_id,reply_email,subject,message,status,reply_to_id,client_request_id)
    values(original.item_id,original.club_id,p_subject,p_actor,original.sender_id,coalesce(email,''),
      case when original.subject ilike 'Re: %' then original.subject else left('Re: '||original.subject,160) end,
      trim(p_message),'sent',original.id,p_request_id) returning id into message_id;
  return message_id;
end $$;
revoke all on function public.reply_marketplace_message(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reply_marketplace_message(uuid,uuid,uuid,text,uuid) to service_role;

-- Deletion only hides this participant's copy. It can be undone and preserves reports.
create function public.set_marketplace_message_deleted(p_actor uuid,p_subject uuid,p_message_id uuid,p_deleted boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare message public.marketplace_contact_messages;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into message from public.marketplace_contact_messages where id=p_message_id for update;
  if not found or p_actor is null or p_subject is null or p_deleted is null or p_subject not in(message.sender_id,message.recipient_id)
    or not public.organization_actor_access(message.club_id,p_actor,p_subject,true) then
    raise exception 'Message unavailable' using errcode='42501'; end if;
  update public.marketplace_contact_messages set
    sender_deleted_at=case when sender_id=p_subject then case when p_deleted then now() else null end else sender_deleted_at end,
    recipient_deleted_at=case when recipient_id=p_subject then case when p_deleted then now() else null end else recipient_deleted_at end
    where id=p_message_id;
  if p_deleted and message.recipient_id=p_subject and message.notification_id is not null then
    update public.notification_recipients set is_deleted=true,deleted_at=now() where notification_id=message.notification_id;
  end if;
end $$;
revoke all on function public.set_marketplace_message_deleted(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_marketplace_message_deleted(uuid,uuid,uuid,boolean) to service_role;

create function public.claim_marketplace_message_pushes(p_message_id uuid default null,p_limit integer default 20)
returns setof jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  update public.marketplace_contact_messages set push_status='uncertain' where push_status='processing' and push_claimed_at<now()-interval '15 minutes';
  return query with picked as (
    select id from public.marketplace_contact_messages where push_status='pending' and (p_message_id is null or id=p_message_id)
    order by created_at for update skip locked limit greatest(1,least(p_limit,50))
  ), claimed as (
    update public.marketplace_contact_messages m set push_status='processing',push_claimed_at=now() from picked where m.id=picked.id returning m.*
  ) select jsonb_build_object('id',m.id,'club_id',m.club_id,'sender_id',m.sender_id,'actor_id',m.actor_id,'recipient_id',m.recipient_id,
    'recipient_deleted_at',m.recipient_deleted_at,'notification_id',m.notification_id,'notification',to_jsonb(n))
    from claimed m left join public.notifications n on n.id=m.notification_id;
end $$;
revoke all on function public.claim_marketplace_message_pushes(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_marketplace_message_pushes(uuid,integer) to service_role;

create function public.cleanup_marketplace_message_notification() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.notifications where id=old.notification_id;
  return old;
end $$;
create trigger marketplace_message_notification_cleanup after delete on public.marketplace_contact_messages
  for each row execute function public.cleanup_marketplace_message_notification();
revoke all on function public.cleanup_marketplace_message_notification() from public,anon,authenticated;

-- A parent's departure clears authorship without deleting their child's messages.
do $$ declare mapping jsonb; begin
  mapping:=public.account_erasure_attributions() || '{"marketplace_contact_messages":["actor_id"]}'::jsonb;
  execute format('create or replace function public.account_erasure_attributions() returns jsonb language sql immutable as %L',
    'select '||quote_literal(mapping::text)||'::jsonb');
end $$;
notify pgrst,'reload schema';
commit;
