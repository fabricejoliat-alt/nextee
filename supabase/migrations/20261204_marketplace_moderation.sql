begin;

-- Existing listings also enter the review queue: no unreviewed photo is published.
alter table public.marketplace_items
  add column moderation_status text not null default 'pending'
    check (moderation_status in ('pending','approved','rejected')),
  add column moderation_revision integer not null default 1,
  add column moderation_note text,
  add column moderated_at timestamptz,
  add column moderated_by uuid references public.profiles(id) on delete set null;
create index marketplace_review_queue on public.marketplace_items(moderation_status,created_at);

create table public.marketplace_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id), check (blocker_id<>blocked_id)
);
create index marketplace_blocks_recipient on public.marketplace_blocks(blocked_id);
create table public.marketplace_contact_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.marketplace_items(id) on delete set null,
  club_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  reply_email text not null check(length(reply_email)<=254),
  subject text not null check(length(subject) between 3 and 160),
  message text not null check(length(message) between 10 and 4000),
  status text not null default 'pending' check(status in ('pending','sent','failed')),
  created_at timestamptz not null default now()
);
create index marketplace_contact_inbox on public.marketplace_contact_messages(recipient_id,created_at);
create index marketplace_contact_rate on public.marketplace_contact_messages(sender_id,created_at);
create table public.marketplace_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.marketplace_items(id) on delete set null,
  message_id uuid references public.marketplace_contact_messages(id) on delete set null,
  club_id uuid not null references public.organizations(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(reason in ('inappropriate','harassment','fraud','other')),
  details text not null default '' check(length(details)<=2000),
  status text not null default 'open' check(status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create unique index marketplace_open_report on public.marketplace_reports(item_id,reporter_id) where status='open';
create unique index marketplace_open_message_report on public.marketplace_reports(message_id,reporter_id) where status='open';
create index marketplace_report_queue on public.marketplace_reports(status,created_at);
create table public.marketplace_suspensions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.organizations(id) on delete cascade,
  reason text not null check(length(reason) between 3 and 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(user_id,club_id)
);
alter table public.marketplace_blocks enable row level security;
alter table public.marketplace_reports enable row level security;
alter table public.marketplace_suspensions enable row level security;
alter table public.marketplace_contact_messages enable row level security;
revoke all on public.marketplace_blocks,public.marketplace_reports,public.marketplace_suspensions,public.marketplace_contact_messages from public,anon,authenticated;
grant all on public.marketplace_blocks,public.marketplace_reports,public.marketplace_suspensions,public.marketplace_contact_messages to service_role;

create function public.marketplace_is_moderator(p_actor uuid,p_club uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from app_admins where user_id=p_actor)
    or exists(select 1 from organization_members where user_id=p_actor and organization_id=p_club
      and role='manager' and is_active);
$$;

-- Internal helper also used by restrictive RLS. Parent protection follows the child.
create function public.marketplace_pair_blocked(p_actor uuid,p_subject uuid,p_other uuid,p_club uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from marketplace_suspensions where club_id=p_club and user_id in(p_actor,p_subject,p_other))
    or exists(select 1 from marketplace_blocks where
      (blocker_id in(p_actor,p_subject) and blocked_id=p_other)
      or (blocked_id in(p_actor,p_subject) and blocker_id=p_other));
$$;

create function public.marketplace_item_visible(p_item uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from marketplace_items i where i.id=p_item and (
    (i.user_id=p_actor or organization_guardian_allowed(p_actor,i.user_id,i.club_id,false,false))
    or (i.is_active and i.moderation_status='approved'
      and not marketplace_pair_blocked(p_actor,p_actor,i.user_id,i.club_id)
      and (
        organization_actor_access(i.club_id,p_actor,p_actor,false)
        or exists(select 1 from player_guardians g where g.guardian_user_id=p_actor
          and organization_guardian_allowed(p_actor,g.player_id,i.club_id,false,false)
          and organization_actor_access(i.club_id,p_actor,g.player_id,false)
          and not marketplace_pair_blocked(p_actor,g.player_id,i.user_id,i.club_id))
      ))
  ));
$$;
create policy marketplace_moderated_read on public.marketplace_items as restrictive for select to anon,authenticated
  using(public.marketplace_item_visible(id,auth.uid()));
create policy marketplace_moderated_images on public.marketplace_images as restrictive for select to anon,authenticated
  using(public.marketplace_item_visible(item_id,auth.uid()));

-- All bytes are uploaded through the authenticated server endpoint. In particular,
-- replacing the contents of an approved image must not bypass a new review.
create policy marketplace_server_uploads on storage.objects as restrictive for insert to anon,authenticated
  with check(bucket_id<>'marketplace');
create policy marketplace_server_updates on storage.objects as restrictive for update to anon,authenticated
  using(bucket_id<>'marketplace') with check(bucket_id<>'marketplace');
create policy marketplace_moderated_storage on storage.objects as restrictive for select to anon,authenticated
  using(bucket_id<>'marketplace' or exists(select 1 from public.marketplace_images i
    where i.path=name and public.marketplace_item_visible(i.item_id,auth.uid())));

create function public.marketplace_review_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.moderation_status:='pending'; new.moderation_revision:=1;
    new.moderation_note:=null; new.moderated_by:=null; new.moderated_at:=null;
  else
    if new.user_id is distinct from old.user_id or new.club_id is distinct from old.club_id then
      raise exception 'Listing ownership cannot change' using errcode='42501';
    end if;
    if coalesce(auth.role(),'')<>'service_role' and pg_trigger_depth()=1 and
      (new.moderation_status,new.moderation_revision,new.moderation_note,new.moderated_by,new.moderated_at)
      is distinct from
      (old.moderation_status,old.moderation_revision,old.moderation_note,old.moderated_by,old.moderated_at) then
      raise exception 'Moderation fields are protected' using errcode='42501';
    end if;
    if (to_jsonb(new)-array['moderation_status','moderation_revision','moderation_note','moderated_by','moderated_at','is_active'])
      is distinct from
      (to_jsonb(old)-array['moderation_status','moderation_revision','moderation_note','moderated_by','moderated_at','is_active']) then
      new.moderation_status:='pending'; new.moderation_revision:=old.moderation_revision+1;
      new.moderation_note:=null; new.moderated_by:=null; new.moderated_at:=null;
    end if;
  end if;
  if exists(select 1 from marketplace_suspensions where user_id=new.user_id and club_id=new.club_id)
    and pg_trigger_depth()=1 and (tg_op='INSERT' or new.is_active)
    and (tg_op='INSERT' or new.moderation_revision<>old.moderation_revision or new.is_active is distinct from old.is_active) then
    raise exception 'Marketplace access suspended' using errcode='42501';
  end if;
  return new;
end $$;
create trigger marketplace_review_guard before insert or update on public.marketplace_items
  for each row execute function public.marketplace_review_guard();

create function public.marketplace_image_review_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;
begin
  target:=case when tg_op='DELETE' then old.item_id else new.item_id end;
  if tg_op='UPDATE' and (new.item_id,new.path) is distinct from (old.item_id,old.path) then
    raise exception 'Image identity cannot change' using errcode='42501';
  end if;
  if tg_op<>'DELETE' and exists(select 1 from marketplace_items i join marketplace_suspensions s
    on s.user_id=i.user_id and s.club_id=i.club_id where i.id=target) then
    raise exception 'Marketplace access suspended' using errcode='42501';
  end if;
  -- Lock the listing, serializing edits with moderator approval.
  perform 1 from marketplace_items where id=target for update;
  if tg_op='INSERT' and (select count(*) from marketplace_images where item_id=target)>5 then
    raise exception 'Maximum five images';
  end if;
  -- Only this trigger can bypass the client protection, using a nested trigger.
  update marketplace_items set moderation_status='pending',moderation_revision=moderation_revision+1,
    moderation_note=null,moderated_by=null,moderated_at=null where id=target;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger marketplace_image_review_guard after insert or update or delete on public.marketplace_images
  for each row execute function public.marketplace_image_review_guard();

create function public.moderate_marketplace_item(p_actor uuid,p_item uuid,p_revision integer,p_action text,p_note text default '')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare item marketplace_items;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into item from marketplace_items where id=p_item for update;
  if not found or not marketplace_is_moderator(p_actor,item.club_id) then raise exception 'Forbidden' using errcode='42501'; end if;
  if item.moderation_revision<>p_revision then raise exception 'Listing changed; review it again' using errcode='40001'; end if;
  if p_action not in ('approve','reject') or length(p_note)>2000
    or (p_action='reject' and length(trim(p_note))<3) then raise exception 'Invalid decision'; end if;
  if p_action='approve' and exists(select 1 from marketplace_suspensions where user_id=item.user_id and club_id=item.club_id) then
    raise exception 'Marketplace access suspended'; end if;
  update marketplace_items set moderation_status=case when p_action='approve' then 'approved' else 'rejected' end,
    moderation_note=nullif(trim(p_note),''),moderated_by=p_actor,moderated_at=now()
    where id=p_item;
end $$;
revoke all on function public.moderate_marketplace_item(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.moderate_marketplace_item(uuid,uuid,integer,text,text) to service_role;
revoke all on function public.marketplace_is_moderator(uuid,uuid),public.marketplace_pair_blocked(uuid,uuid,uuid,uuid),
  public.marketplace_item_visible(uuid,uuid),public.marketplace_review_guard(),public.marketplace_image_review_guard() from public,anon,authenticated;
grant execute on function public.marketplace_item_visible(uuid,uuid) to anon,authenticated,service_role;
grant execute on function public.marketplace_pair_blocked(uuid,uuid,uuid,uuid),public.marketplace_is_moderator(uuid,uuid) to service_role;

create function public.reserve_marketplace_contact(p_actor uuid,p_subject uuid,p_item uuid,p_email text,p_subject_text text,p_message text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare item marketplace_items; message_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-contact:'||p_actor::text,0));
  select * into item from marketplace_items where id=p_item;
  if not found or not item.is_active or item.moderation_status<>'approved'
    or not organization_actor_access(item.club_id,p_actor,p_subject,true)
    or marketplace_pair_blocked(p_actor,p_subject,item.user_id,item.club_id) then
    raise exception 'Contact unavailable' using errcode='42501';
  end if;
  if (select count(*) from marketplace_contact_messages where sender_id=p_actor and created_at>now()-interval '10 minutes')>=3 then
    raise exception 'Rate limited' using errcode='P0001';
  end if;
  insert into marketplace_contact_messages(item_id,club_id,sender_id,recipient_id,reply_email,subject,message)
    values(item.id,item.club_id,p_actor,item.user_id,p_email,p_subject_text,p_message) returning id into message_id;
  return message_id;
end $$;
revoke all on function public.reserve_marketplace_contact(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_marketplace_contact(uuid,uuid,uuid,text,text,text) to service_role;

-- Extend the existing deletion classification, preserving shared listings reviewed
-- by a departing moderator and the child's blocks created by a departing parent.
do $$
declare mapping jsonb; definition text; marker text:='"marketplace_items":["user_id"],';
begin
  mapping:=public.account_erasure_attributions() || '{
    "marketplace_items":["moderated_by"],
    "marketplace_blocks":["created_by"],
    "marketplace_reports":["resolved_by"],
    "marketplace_suspensions":["created_by"]
  }'::jsonb;
  execute format('create or replace function public.account_erasure_attributions() returns jsonb language sql immutable as %L',
    'select '||quote_literal(mapping::text)||'::jsonb');
  definition:=pg_get_functiondef('public.erase_account_data(uuid,uuid)'::regprocedure);
  if strpos(definition,marker)=0 then raise exception 'Account erasure classification changed; review this migration'; end if;
  definition:=replace(definition,marker,marker||'
    "marketplace_blocks":["blocker_id","blocked_id"],
    "marketplace_reports":["reporter_id","subject_id"],
    "marketplace_contact_messages":["sender_id","recipient_id"],
    "marketplace_suspensions":["user_id"],');
  execute definition;
end $$;
notify pgrst,'reload schema';
commit;
