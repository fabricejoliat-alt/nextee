-- Demonstration status is global across seasons. Quiz access is unchanged.
begin;
alter table public.organizations add column if not exists is_demo boolean not null default false;

create or replace function public.protect_organization_demo_mode()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;
begin
  if (tg_op='INSERT' and new.is_demo) or (tg_op='UPDATE' and new.is_demo is distinct from old.is_demo) then
    actor:=nullif(current_setting('activitee.demo_actor',true),'')::uuid;
    if auth.role() is distinct from 'service_role' or actor is null
      or not exists(select 1 from public.app_admins where user_id=actor) then
      raise exception 'Demo mode requires the checked superadmin operation' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_organization_demo_mode() from public,anon,authenticated;
drop trigger if exists protect_organization_demo_mode on public.organizations;
create trigger protect_organization_demo_mode before insert or update of is_demo on public.organizations
for each row execute function public.protect_organization_demo_mode();

-- Keep the existing four-argument creation function for old clients.
create or replace function public.create_organization_with_mode_checked(
  p_actor uuid,p_name text,p_slug text,p_type text,p_is_demo boolean default false
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid;
begin
  perform public.organization_require_actor(p_actor,null,true);
  if p_is_demo is null then raise exception 'Invalid demo mode'; end if;
  perform set_config('activitee.demo_actor',p_actor::text,true);
  org:=public.create_organization_checked(p_actor,p_name,p_slug,p_type);
  if p_is_demo then update public.organizations set is_demo=true where id=org; end if;
  return org;
end $$;
revoke all on function public.create_organization_with_mode_checked(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.create_organization_with_mode_checked(uuid,text,text,text,boolean) to service_role;

create or replace function public.save_organization_settings_checked(p_actor uuid,p_org uuid,p_values jsonb,p_settings jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  perform public.organization_require_actor(p_actor,null,true);
  perform 1 from public.organizations where id=p_org for update;
  if not found then raise exception 'Organization unavailable'; end if;
  if length(btrim(p_values->>'name'))<2 or (p_values->>'org_type') not in ('club','academy','federation')
    or p_settings is null or jsonb_typeof(p_settings)<>'object'
    or (p_values ? 'is_demo' and jsonb_typeof(p_values->'is_demo') is distinct from 'boolean') then raise exception 'Invalid settings'; end if;
  perform set_config('activitee.demo_actor',p_actor::text,true);
  update public.organizations set name=btrim(p_values->>'name'),slug=nullif(btrim(p_values->>'slug'),''),
    org_type=p_values->>'org_type',is_active=(p_values->>'is_active')::boolean,
    is_demo=case when p_values ? 'is_demo' then (p_values->>'is_demo')::boolean else is_demo end,
    country_code=nullif(btrim(p_values->>'country_code'),''),region_code=nullif(btrim(p_values->>'region_code'),'') where id=p_org;
  insert into public.organization_settings(organization_id,settings,updated_by,updated_at) values(p_org,p_settings,p_actor,now())
    on conflict(organization_id) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=now();
end $$;
revoke all on function public.save_organization_settings_checked(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_organization_settings_checked(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
