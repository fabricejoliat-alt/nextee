begin;
create function public.provision_academy_guardian_checked(p_actor uuid,p_entry uuid,p_guardian uuid,p_profile jsonb,p_relation text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.academy_roster_entries%rowtype; begin
  select * into r from public.academy_roster_entries where id=p_entry for update;
  if not found or r.status='ended' then raise exception 'Roster unavailable'; end if;
  perform public.organization_require_actor(p_actor,r.academy_id);
  if exists(select 1 from public.organization_members where user_id=p_guardian)
    or exists(select 1 from public.organization_identity_matches where player_id=p_guardian) then
    raise exception 'Existing parent requires human review' using errcode='42501'; end if;
  if p_guardian=r.player_id or p_relation not in ('father','mother','legal_guardian') then raise exception 'Invalid guardian'; end if;
  insert into public.profiles(id,first_name,last_name,username,app_role)
    values(p_guardian,p_profile->>'first_name',p_profile->>'last_name',p_profile->>'username','parent')
    on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,username=excluded.username,app_role='parent';
  insert into public.organization_identity_matches(organization_id,player_id,requested_by,approved_by,approved_at,evidence_note,status,subject_role)
    values(r.academy_id,p_guardian,p_actor,p_actor,now(),'New Auth parent identity provisioned after server email uniqueness check','approved','parent');
  perform public.attach_academy_guardian_checked(p_actor,p_entry,p_guardian,p_relation);
end $$;
revoke all on function public.provision_academy_guardian_checked(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.provision_academy_guardian_checked(uuid,uuid,uuid,jsonb,text) to service_role;
create function public.organization_new_legal_version() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.legal_documents%rowtype; begin
  select * into d from public.legal_documents where id=new.document_id;
  if d.active and d.required and (d.kind='parent_authorization' or (d.kind in ('terms','privacy','junior_notice') and 'player'=any(d.audience_roles))) then
    perform set_config('activitee.actor_id',new.published_by::text,true);
    update public.academy_roster_entries set status='suspended',revision=revision+1
      where status='active' and (d.scope='platform' or academy_id=d.club_id);
  end if;
  return new;
end $$;
create trigger organization_new_legal_version after insert on public.legal_versions
for each row execute function public.organization_new_legal_version();
revoke all on function public.organization_new_legal_version() from public,anon,authenticated;
commit;
