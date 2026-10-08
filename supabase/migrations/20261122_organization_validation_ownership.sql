begin;
alter table public.player_validation_attempts add column organization_id uuid references public.organizations(id) on delete restrict;
update public.player_validation_attempts a set organization_id=(
  select min(organization_id::text)::uuid from public.organization_members m
  where m.user_id=a.player_id and m.role='player' and m.is_active having count(*)=1);
do $$ begin
  if exists(select 1 from public.player_validation_attempts where organization_id is null) then
    raise exception 'Historical validation ownership requires human review before migration';
  end if;
end $$;
alter table public.player_validation_attempts alter column organization_id set not null;
create index player_validation_organization on public.player_validation_attempts(organization_id,player_id,attempted_at);
create function public.organization_validation_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if tg_op='UPDATE' and (new.organization_id is distinct from old.organization_id or new.player_id<>old.player_id) then
    raise exception 'Validation ownership is immutable' using errcode='42501';
  end if;
  if not exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=new.player_id and role='player' and is_active) then
    raise exception 'Validation player outside organization' using errcode='42501';
  end if;
  if auth.role()='authenticated' and (new.created_by_user_id<>auth.uid()
    or not public.organization_actor_access(new.organization_id,auth.uid(),new.player_id,true)
    or not public.organization_actor_legal_ready(new.organization_id,auth.uid())) then
    raise exception 'Validation access forbidden' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.organization_validation_owner() from public,anon,authenticated;
create trigger organization_validation_owner before insert or update on public.player_validation_attempts
for each row execute function public.organization_validation_owner();
create policy organization_scope_guard on public.player_validation_attempts as restrictive for all to authenticated
using(public.organization_actor_access(organization_id,auth.uid(),player_id) and public.organization_actor_legal_ready(organization_id,auth.uid()))
with check(public.organization_actor_access(organization_id,auth.uid(),player_id,true) and public.organization_actor_legal_ready(organization_id,auth.uid()));
create policy organization_view_scope on public.player_validation_attempts as restrictive for all to authenticated
using(public.organization_view_scope(organization_id)) with check(public.organization_view_scope(organization_id));
notify pgrst,'reload schema';
commit;
