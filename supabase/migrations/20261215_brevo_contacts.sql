-- A private directory projection and durable reconciliation state. No network
-- calls or triggers in account writes: Brevo failures cannot block onboarding.
begin;

create view public.brevo_contact_directory as
with memberships as (
  select m.user_id, m.club_id as organization_id, m.role::text as role,
    coalesce(o.name,c.name) as organization_name
  from public.club_members m join public.clubs c on c.id=m.club_id
  left join public.organizations o on o.id=m.club_id
  where m.is_active and coalesce(o.is_active,true)
    and m.role::text in ('player','parent','coach','manager')
  union
  select m.user_id,m.organization_id,m.role,o.name
  from public.organization_members m join public.organizations o on o.id=m.organization_id
  where m.is_active and o.is_active and m.role in ('player','parent','coach','manager')
), people as (
  select lower(btrim(u.email)) as email,p.id,p.first_name,p.last_name,
    m.organization_id,m.organization_name,m.role
  from memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=p.id
  where (u.banned_until is null or u.banned_until<=now())
    and nullif(to_jsonb(u)->>'deleted_at','') is null
    and length(btrim(u.email))<=254
    and btrim(u.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(btrim(u.email)) !~ '@[^@]*(\.local|\.invalid|\.test|\.example)$'
), identities as (
  -- Prefer an adult's identity for a shared family mailbox. Never merge names.
  select distinct on(email) email,first_name,last_name
  from people order by email,case role when 'parent' then 0 when 'manager' then 1 when 'coach' then 2 else 3 end,id
)
select p.email,array_agg(distinct p.id order by p.id) as user_ids,jsonb_build_object(
  'ACTIVITEE_FIRSTNAME',coalesce(i.first_name,''),
  'ACTIVITEE_LASTNAME',coalesce(i.last_name,''),
  'ACTIVITEE_ACTIVE',true,
  'ACTIVITEE_ROLES','|'||string_agg(distinct p.role,'|' order by p.role)||'|',
  'ACTIVITEE_CLUBS',string_agg(distinct p.organization_name,' / ' order by p.organization_name),
  'ACTIVITEE_CLUB_IDS','|'||string_agg(distinct p.organization_id::text,'|' order by p.organization_id::text)||'|',
  'ACTIVITEE_PLAYER_CLUBS',coalesce('|'||string_agg(distinct p.organization_id::text,'|' order by p.organization_id::text) filter(where p.role='player')||'|',''),
  'ACTIVITEE_PARENT_CLUBS',coalesce('|'||string_agg(distinct p.organization_id::text,'|' order by p.organization_id::text) filter(where p.role='parent')||'|',''),
  'ACTIVITEE_COACH_CLUBS',coalesce('|'||string_agg(distinct p.organization_id::text,'|' order by p.organization_id::text) filter(where p.role='coach')||'|',''),
  'ACTIVITEE_MANAGER_CLUBS',coalesce('|'||string_agg(distinct p.organization_id::text,'|' order by p.organization_id::text) filter(where p.role='manager')||'|','')
) as attributes
from people p join identities i using(email) group by p.email,i.first_name,i.last_name;

revoke all on public.brevo_contact_directory from public,anon,authenticated;
grant select on public.brevo_contact_directory to service_role;

create table public.brevo_contact_sync_state (
  email text primary key,
  user_ids uuid[] not null,
  attributes jsonb not null,
  desired_hash text not null,
  synced_hash text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text
);
create table public.brevo_contact_suppressions (
  email_hash text primary key check(email_hash ~ '^[a-f0-9]{64}$'),
  user_ids uuid[] not null default '{}',
  reason text not null check(reason in ('unsubscribe','spam','deleted')),
  received_at timestamptz not null default now()
);
create index brevo_contact_sync_users_idx on public.brevo_contact_sync_state using gin(user_ids);
create index brevo_contact_suppression_users_idx on public.brevo_contact_suppressions using gin(user_ids);
create table public.brevo_contact_sync_control (
  singleton boolean primary key default true check(singleton),
  lease_token uuid,
  lease_until timestamptz,
  cooldown_until timestamptz,
  target_list_id bigint,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_error text
);
insert into public.brevo_contact_sync_control(singleton) values(true);
alter table public.brevo_contact_sync_state enable row level security;
alter table public.brevo_contact_suppressions enable row level security;
alter table public.brevo_contact_sync_control enable row level security;
revoke all on public.brevo_contact_sync_state,public.brevo_contact_suppressions,public.brevo_contact_sync_control from public,anon,authenticated;
grant all on public.brevo_contact_sync_state,public.brevo_contact_suppressions,public.brevo_contact_sync_control to service_role;

create function public.prepare_brevo_contact_sync(p_token uuid,p_list_id bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare previous_list bigint;
begin
  select target_list_id into previous_list from public.brevo_contact_sync_control
    where singleton for update;
  if exists(select 1 from public.brevo_contact_sync_control where lease_until>now() or cooldown_until>now()) then return false; end if;
  -- Changing the list silently would strand contacts in the previous list.
  if previous_list is not null and previous_list<>p_list_id then raise exception 'brevo_target_list_changed'; end if;
  update public.brevo_contact_sync_control set lease_token=p_token,lease_until=now()+interval '5 minutes',
    target_list_id=p_list_id,last_started_at=now(),last_error=null where singleton;
  insert into public.brevo_contact_sync_state as s(email,user_ids,attributes,desired_hash)
    select email,user_ids,attributes,md5(attributes::text||user_ids::text) from public.brevo_contact_directory
    on conflict(email) do update set user_ids=excluded.user_ids,attributes=excluded.attributes,desired_hash=excluded.desired_hash,
      attempts=0,next_attempt_at=now(),last_error=null
      where s.desired_hash<>excluded.desired_hash;
  update public.brevo_contact_sync_state s set attributes='{"ACTIVITEE_ACTIVE":false}',
    desired_hash=md5('{"ACTIVITEE_ACTIVE": false}'),attempts=0,next_attempt_at=now(),last_error=null
    where (s.attributes->>'ACTIVITEE_ACTIVE')::boolean
      and not exists(select 1 from public.brevo_contact_directory d where d.email=s.email);
  return true;
end $$;
revoke all on function public.prepare_brevo_contact_sync(uuid,bigint) from public,anon,authenticated;
grant execute on function public.prepare_brevo_contact_sync(uuid,bigint) to service_role;

create function public.due_brevo_contact_sync(p_token uuid,p_limit integer default 25)
returns setof public.brevo_contact_sync_state language sql security definer set search_path='' as $$
  select s.* from public.brevo_contact_sync_state s
  where s.synced_hash is distinct from s.desired_hash and s.next_attempt_at<=now()
    and exists(select 1 from public.brevo_contact_sync_control where lease_token=p_token and lease_until>now())
    -- Observe the old mailbox's blocklisting before creating a new mailbox
    -- for the same account, including when old-mailbox cleanup is retrying.
    and ((s.attributes->>'ACTIVITEE_ACTIVE')::boolean=false or not exists(
      select 1 from public.brevo_contact_sync_state old where old.user_ids && s.user_ids
        and (old.attributes->>'ACTIVITEE_ACTIVE')::boolean=false))
  order by (s.attributes->>'ACTIVITEE_ACTIVE')::boolean,s.next_attempt_at,s.email
  limit greatest(1,least(p_limit,25));
$$;
revoke all on function public.due_brevo_contact_sync(uuid,integer) from public,anon,authenticated;
grant execute on function public.due_brevo_contact_sync(uuid,integer) to service_role;

create function public.brevo_contact_sync_stats()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'contacts',(select count(*) from public.brevo_contact_directory),
    'pending',(select count(*) from public.brevo_contact_directory d left join public.brevo_contact_sync_state s using(email)
      where s.synced_hash is distinct from md5(d.attributes::text||d.user_ids::text)),
    'removals',(select count(*) from public.brevo_contact_sync_state s where not exists(select 1 from public.brevo_contact_directory d where d.email=s.email)),
    'failed',(select count(*) from public.brevo_contact_sync_state where last_error is not null),
    'suppressed',(select count(*) from public.brevo_contact_suppressions)
  );
$$;
revoke all on function public.brevo_contact_sync_stats() from public,anon,authenticated;
grant execute on function public.brevo_contact_sync_stats() to service_role;

create function public.suppress_brevo_contact(p_email text,p_hash text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  -- Carry the opt-out to a subsequent email of the same ActiviTee account.
  -- No names or raw email are kept in the suppression registry.
  select coalesce(array_agg(distinct id),'{}') into ids from (
    select unnest(user_ids) id from public.brevo_contact_directory where email=p_email
    union select unnest(user_ids) from public.brevo_contact_sync_state where email=p_email
    union select unnest(user_ids) from public.brevo_contact_suppressions where email_hash=p_hash
  ) identities;
  insert into public.brevo_contact_suppressions(email_hash,user_ids,reason) values(p_hash,ids,p_reason)
    on conflict(email_hash) do update set user_ids=excluded.user_ids,reason=excluded.reason,received_at=now();
  update public.brevo_contact_sync_state set synced_hash=null,next_attempt_at=now()
    where email=p_email or user_ids && ids;
end $$;
revoke all on function public.suppress_brevo_contact(text,text,text) from public,anon,authenticated;
grant execute on function public.suppress_brevo_contact(text,text,text) to service_role;
commit;
