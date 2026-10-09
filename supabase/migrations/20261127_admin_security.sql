-- No accounts, organizations, catalogs or legal evidence are removed or reseeded.
begin;

create table if not exists public.admin_security_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  request_id uuid not null,
  action text not null check(length(action) between 1 and 320),
  target_id text check(length(target_id) <= 256),
  phase text not null check(phase in ('started','succeeded','failed')),
  http_status integer check(http_status between 100 and 599),
  unique(request_id,phase)
);
create index if not exists admin_security_events_time on public.admin_security_events(occurred_at desc);
alter table public.admin_security_events enable row level security;
revoke all on public.admin_security_events from public,anon,authenticated;
grant select on public.admin_security_events to authenticated;
-- The API can append through the guarded function, never rewrite past events.
revoke all on public.admin_security_events from service_role;
grant select on public.admin_security_events to service_role;

create or replace function public.application_session_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case when auth.role()='service_role' then true
    when coalesce(auth.jwt()->'app_metadata'->>'initial_password_required','false')='true' then false
    when exists(select 1 from public.app_admins where user_id=auth.uid()) then coalesce(auth.jwt()->>'aal','')='aal2'
    else true end
$$;
revoke all on function public.application_session_ready() from public,anon;
grant execute on function public.application_session_ready() to authenticated,service_role;

create or replace function public.application_mutation_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.application_session_ready() and (
    auth.role()='service_role' or not exists(select 1 from public.app_admins where user_id=auth.uid()) or exists(
      select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) method
      where method->>'method'='totp' and jsonb_typeof(method->'timestamp')='number'
        and (method->>'timestamp')::numeric between extract(epoch from now())-900 and extract(epoch from now())+30
    )
  )
$$;
revoke all on function public.application_mutation_ready() from public,anon;
grant execute on function public.application_mutation_ready() to authenticated,service_role;

create or replace function public.is_app_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.app_admins where user_id=p_user_id)
    and (auth.role()='service_role' or (p_user_id=auth.uid() and public.application_session_ready()))
$$;
create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.is_app_admin(auth.uid())
$$;

drop policy if exists admin_security_events_read on public.admin_security_events;
create policy admin_security_events_read on public.admin_security_events for select to authenticated
  using(public.is_app_admin(auth.uid()));

create or replace function public.record_admin_security_event(
  p_actor uuid,p_request uuid,p_action text,p_target text,p_phase text,p_status integer
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.app_admins where user_id=p_actor) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  insert into public.admin_security_events(actor_id,request_id,action,target_id,phase,http_status)
    values(p_actor,p_request,p_action,p_target,p_phase,p_status);
end $$;
revoke all on function public.record_admin_security_event(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_admin_security_event(uuid,uuid,text,text,text,integer) to service_role;

-- Also constrain policies that check app_admins inline, Realtime, and Storage.
-- Only existing RLS tables are touched; their permissive role/organization policies remain required.
do $$ declare t record; begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity and n.nspname='public' and c.relname<>'app_admins'
  loop
    execute format('drop policy if exists application_session_gate on %I.%I',t.nspname,t.relname);
    execute format('create policy application_session_gate on %I.%I as restrictive for all to authenticated using ((select public.application_session_ready())) with check ((select public.application_mutation_ready()))',t.nspname,t.relname);
    execute format('drop policy if exists application_update_gate on %I.%I',t.nspname,t.relname);
    execute format('create policy application_update_gate on %I.%I as restrictive for update to authenticated using ((select public.application_mutation_ready())) with check ((select public.application_mutation_ready()))',t.nspname,t.relname);
    execute format('drop policy if exists application_delete_gate on %I.%I',t.nspname,t.relname);
    execute format('create policy application_delete_gate on %I.%I as restrictive for delete to authenticated using ((select public.application_mutation_ready()))',t.nspname,t.relname);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists application_session_gate on storage.objects';
    execute 'create policy application_session_gate on storage.objects as restrictive for all to authenticated using ((select public.application_session_ready())) with check ((select public.application_mutation_ready()))';
    execute 'drop policy if exists application_update_gate on storage.objects';
    execute 'create policy application_update_gate on storage.objects as restrictive for update to authenticated using ((select public.application_mutation_ready())) with check ((select public.application_mutation_ready()))';
    execute 'drop policy if exists application_delete_gate on storage.objects';
    execute 'create policy application_delete_gate on storage.objects as restrictive for delete to authenticated using ((select public.application_mutation_ready()))';
  end if;
end $$;

-- Self-only role bootstrap must work before enrollment. No administrative data is exposed.
drop policy if exists admin_bootstrap_self on public.app_admins;
create policy admin_bootstrap_self on public.app_admins for select to authenticated using(user_id=auth.uid());
drop policy if exists admin_bootstrap_gate on public.app_admins;
create policy admin_bootstrap_gate on public.app_admins as restrictive for select to authenticated
  using(user_id=auth.uid() or public.application_session_ready());
drop policy if exists admin_bootstrap_insert_gate on public.app_admins;
create policy admin_bootstrap_insert_gate on public.app_admins as restrictive for insert to authenticated
  with check(public.application_mutation_ready());
drop policy if exists admin_bootstrap_update_gate on public.app_admins;
create policy admin_bootstrap_update_gate on public.app_admins as restrictive for update to authenticated
  using(public.application_mutation_ready()) with check(public.application_mutation_ready());
drop policy if exists admin_bootstrap_delete_gate on public.app_admins;
create policy admin_bootstrap_delete_gate on public.app_admins as restrictive for delete to authenticated
  using(public.application_mutation_ready());

-- SECURITY DEFINER RPCs may bypass RLS: enforce the same gate before every Data API request.
create or replace function public.check_application_session()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()='authenticated' and not public.application_session_ready() then
    -- The only aal1 read allowed is the caller's role bootstrap, constrained by RLS above.
    if current_setting('request.method',true)='GET' and current_setting('request.path',true)='/app_admins'
      and coalesce(auth.jwt()->'app_metadata'->>'initial_password_required','false')<>'true' then return; end if;
    raise exception 'Additional authentication required' using errcode='42501';
  end if;
  if auth.role()='authenticated' and coalesce(current_setting('request.method',true),'') not in ('GET','HEAD','OPTIONS')
    and not public.application_mutation_ready() then
    raise exception 'Recent MFA verification required' using errcode='42501';
  end if;
end $$;
revoke all on function public.check_application_session() from public,anon;
grant execute on function public.check_application_session() to anon,authenticated,service_role;

-- Refuse to overwrite an unrelated existing hook. Resolve it explicitly before rollout.
do $$ declare existing text; begin
  for existing in select split_part(setting,'=',2)
    from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,unnest(s.setconfig) setting
    where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'
      and (s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database()))
  loop
    if coalesce(existing,'') not in ('','public.check_application_session') then
      raise exception 'Existing PostgREST pre-request hook must be preserved: %',existing;
    end if;
  end loop;
end $$;
alter role authenticator set pgrst.db_pre_request='public.check_application_session';
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
