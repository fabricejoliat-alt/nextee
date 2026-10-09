-- Missing contact dependency only. Existing records and contact address are preserved.
begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
do $$ begin
  if current_database()<>'postgres' or current_user<>'postgres' then raise exception 'Unexpected database identity'; end if;
  if to_regprocedure('public.application_session_ready()') is null or to_regprocedure('public.application_mutation_ready()') is null then
    raise exception 'Apply Admin security first';
  end if;
end $$;
create temp table admin_security_checkpoint(table_schema text,table_name text,row_count bigint,fingerprint text) on commit drop;
alter table admin_security_checkpoint enable row level security;
do $checkpoint$ declare t record; n bigint; f text; begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and ((n.nspname='public' and c.relname<>'admin_security_events') or (n.nspname='auth' and c.relname='users'))
  loop
    execute format('select count(*),md5(coalesce(string_agg(j::text,''|'' order by j::text),'''')) from (select to_jsonb(t) j from %I.%I t) q',t.nspname,t.relname) into n,f;
    insert into admin_security_checkpoint values(t.nspname,t.relname,n,f);
  end loop;
end $checkpoint$;


-- Single public-facing contact mailbox, editable only through the platform Admin API.
create table if not exists public.platform_contact_settings (
  singleton boolean primary key default true check (singleton),
  contact_email text not null check (contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);
insert into public.platform_contact_settings (singleton, contact_email)
values (true, 'info@activitee.golf')
on conflict (singleton) do nothing;
alter table public.platform_contact_settings enable row level security;
revoke all on public.platform_contact_settings from public, anon, authenticated;
grant select, update on public.platform_contact_settings to service_role;

-- Tables added after the security rollout need the same session gates.
drop policy if exists application_session_gate on public.platform_contact_settings;
create policy application_session_gate on public.platform_contact_settings as restrictive for all to authenticated
  using ((select public.application_session_ready())) with check ((select public.application_mutation_ready()));
drop policy if exists application_update_gate on public.platform_contact_settings;
create policy application_update_gate on public.platform_contact_settings as restrictive for update to authenticated
  using ((select public.application_mutation_ready())) with check ((select public.application_mutation_ready()));
drop policy if exists application_delete_gate on public.platform_contact_settings;
create policy application_delete_gate on public.platform_contact_settings as restrictive for delete to authenticated
  using ((select public.application_mutation_ready()));
notify pgrst,'reload schema';
do $assertion$ declare t record; n bigint; f text; begin
  for t in select * from admin_security_checkpoint loop
    execute format('select count(*),md5(coalesce(string_agg(j::text,''|'' order by j::text),'''')) from (select to_jsonb(t) j from %I.%I t) q',t.table_schema,t.table_name) into n,f;
    if n<>t.row_count or f<>t.fingerprint then raise exception 'Data changed: %.%',t.table_schema,t.table_name; end if;
  end loop;
end $assertion$;
do $$ begin
  if (select count(*) from public.platform_contact_settings where singleton)<>1 then raise exception 'Contact singleton missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.platform_contact_settings'::regclass) then raise exception 'Contact RLS missing'; end if;
  if has_table_privilege('authenticated','public.platform_contact_settings','select') or has_table_privilege('anon','public.platform_contact_settings','select')
    or not has_table_privilege('service_role','public.platform_contact_settings','update') then raise exception 'Contact permissions invalid'; end if;
end $$;
select 'contact_settings_committed|existing_records_preserved' as result;
commit;
