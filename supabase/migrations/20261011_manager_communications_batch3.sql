begin;

alter table public.access_invitation_tokens drop constraint if exists access_invitation_tokens_kind_check;
alter table public.access_invitation_tokens add constraint access_invitation_tokens_kind_check check (invitation_kind in ('parent_access','junior_access','account_recovery'));
alter table public.access_invitation_tokens add column if not exists recipient_user_id uuid references public.profiles(id) on delete cascade;
alter table public.access_invitation_tokens enable row level security;
revoke all on public.access_invitation_tokens from anon, authenticated;
grant select, insert, update, delete on public.access_invitation_tokens to service_role;

-- A token never changes Auth at send time. Recheck current access at redemption.
-- Serializing on the account also prevents two different links resetting it concurrently.
create or replace function public.claim_access_invitation_v1(p_token_hash text, p_consume boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.access_invitation_tokens%rowtype; recipient uuid;
begin
  select * into t from public.access_invitation_tokens where token_hash = p_token_hash;
  if not found then return null; end if;
  perform 1 from public.profiles where id = t.user_id for update;
  select * into t from public.access_invitation_tokens where token_hash = p_token_hash for update;
  if t.consumed_at is not null or t.expires_at <= clock_timestamp() then return null; end if;
  recipient := coalesce(t.recipient_user_id, case when t.invitation_kind='account_recovery' then t.sent_by else t.user_id end);
  if t.invitation_kind <> 'account_recovery' and (not exists (select 1 from public.club_members where club_id=t.club_id and user_id=t.sent_by and role='manager' and is_active)
     and not exists (select 1 from public.app_admins where user_id=t.sent_by)) then return null; end if;
  if not exists (select 1 from auth.users where id=recipient and lower(trim(email))=lower(trim(t.sent_to_email)) and email not like '%@noemail.local') then return null; end if;
  if t.invitation_kind = 'parent_access' then
    if recipient <> t.user_id or not exists (select 1 from public.club_members where club_id=t.club_id and user_id=t.user_id and role='parent' and is_active) then return null; end if;
  else
    if not exists (select 1 from public.club_members where club_id=t.club_id and user_id=t.user_id and role='player' and is_active)
      or exists (select 1 from public.club_members where user_id=t.user_id and role in ('coach','manager'))
      or exists (select 1 from public.app_admins where user_id=t.user_id) then return null; end if;
    if recipient <> t.user_id and (
      not exists (select 1 from public.club_members where club_id=t.club_id and user_id=recipient and role='parent' and is_active)
      or not exists (select 1 from public.player_guardians where player_id=t.user_id and guardian_user_id=recipient and can_view and can_edit)
    ) then return null; end if;
  end if;
  if p_consume then
    -- Fail closed if the subsequent Auth request fails: issue a new invitation.
    update public.access_invitation_tokens set consumed_at=clock_timestamp() where user_id=t.user_id and consumed_at is null;
  end if;
  return jsonb_build_object('user_id',t.user_id,'sent_to_email',t.sent_to_email,'invitation_kind',t.invitation_kind);
end $$;
revoke all on function public.claim_access_invitation_v1(text,boolean) from public, anon, authenticated;
grant execute on function public.claim_access_invitation_v1(text,boolean) to service_role;

create table if not exists public.club_news_email_deliveries (
  news_id uuid not null references public.club_news(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  status text not null check (status in ('sending','sent','failed','uncertain')),
  attempt_id uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key(news_id,recipient_user_id)
);
alter table public.club_news_email_deliveries enable row level security;
revoke all on public.club_news_email_deliveries from anon, authenticated;
grant select on public.club_news_email_deliveries to service_role;

create or replace function public.claim_manager_news_email_v1(p_actor uuid,p_club uuid,p_news uuid,p_recipient uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.club_news%rowtype; d public.club_news_email_deliveries%rowtype;
begin
  perform public.require_manager_club_scope_v1(p_actor,p_club);
  select * into n from public.club_news where id=p_news and club_id=p_club for update;
  if not found then raise exception 'news_not_found' using errcode='P0002'; end if;
  -- Historical aggregate receipts cannot identify individual deliveries. Never replay them.
  if n.last_email_sent_at is not null and not exists(select 1 from public.club_news_email_deliveries where news_id=p_news) then
    return jsonb_build_object('status','legacy_sent');
  end if;
  if not exists(select 1 from public.club_members where club_id=p_club and user_id=p_recipient and is_active)
    or not exists(select 1 from auth.users where id=p_recipient and lower(trim(email))=lower(trim(p_email))) then
    raise exception 'recipient_no_longer_available' using errcode='42501';
  end if;
  select * into d from public.club_news_email_deliveries where news_id=p_news and recipient_user_id=p_recipient;
  if found and d.status <> 'failed' then return jsonb_build_object('status',d.status); end if;
  insert into public.club_news_email_deliveries(news_id,recipient_user_id,email,status)
    values(p_news,p_recipient,p_email,'sending')
    on conflict(news_id,recipient_user_id) do update set email=excluded.email,status='sending',attempt_id=gen_random_uuid(),last_error=null,updated_at=now()
    returning * into d;
  return jsonb_build_object('status','claimed','attempt_id',d.attempt_id);
end $$;

create or replace function public.finish_manager_news_email_v1(p_actor uuid,p_club uuid,p_news uuid,p_recipient uuid,p_attempt uuid,p_status text,p_error text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_manager_club_scope_v1(p_actor,p_club);
  if p_status not in ('sent','failed','uncertain') then raise exception 'invalid_delivery_status' using errcode='22023'; end if;
  if not exists(select 1 from public.club_news where id=p_news and club_id=p_club) then raise exception 'news_not_found' using errcode='P0002'; end if;
  update public.club_news_email_deliveries set status=p_status,last_error=left(p_error,500),sent_at=case when p_status='sent' then now() else null end,updated_at=now()
    where news_id=p_news and recipient_user_id=p_recipient and attempt_id=p_attempt and status='sending';
  if not found then raise exception 'delivery_attempt_not_found' using errcode='P0002'; end if;
end $$;
revoke all on function public.claim_manager_news_email_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_manager_news_email_v1(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_manager_news_email_v1(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.finish_manager_news_email_v1(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
commit;
