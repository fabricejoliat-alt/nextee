-- TEST wizbeuuvjibmmuxyynly only, after applied 20261103.
-- No migration replay. Reuses disposable legalqa fixtures, rolls all writes back.
begin;
do $$ begin
 if (select enabled from public.legal_enforcement_control where singleton) is distinct from false
 or exists(select 1 from public.legal_documents where active) then raise exception 'Expected disabled legal controls'; end if;
end $$;
-- Only pre-existing disposable legalqa fixtures are touched, and all writes roll back.
do $$ begin
 if not exists(select 1 from auth.users where id='5d56ae08-76ba-438a-b50c-2daf82ed3fba'
 and email='legalqa_20261004_9a282f.coach@example.invalid') then raise exception 'Fixture identity mismatch'; end if;
 if not exists(select 1 from public.coach_groups where id='eab5aa57-f25f-4b5d-81e2-408dea246ff2' and club_id='efa61978-72ac-47f0-b0e4-0b692191c2bb') then raise exception 'Fixture group mismatch'; end if;
 if not exists(select 1 from public.club_events where id='65a28d29-1c19-48ce-a07a-86dd81d5fddd' and group_id='eab5aa57-f25f-4b5d-81e2-408dea246ff2') then raise exception 'Fixture event mismatch'; end if;
end $$;
create temporary table legal_coverage_checks(item text,ok boolean) on commit drop;
update public.coach_groups set head_coach_user_id='5d56ae08-76ba-438a-b50c-2daf82ed3fba' where id='eab5aa57-f25f-4b5d-81e2-408dea246ff2';
update public.club_members set is_active=false where user_id='5d56ae08-76ba-438a-b50c-2daf82ed3fba' and club_id='efa61978-72ac-47f0-b0e4-0b692191c2bb';
select set_config('request.jwt.claims','{"sub":"5d56ae08-76ba-438a-b50c-2daf82ed3fba","role":"authenticated"}',true);
do $$ declare before_count int; after_count int; begin
 begin
  perform public.staff_seed_group_players_attendees('65a28d29-1c19-48ce-a07a-86dd81d5fddd');
  insert into legal_coverage_checks values('candidate_inactive_coach_denied',false);
 exception when others then
  insert into legal_coverage_checks values('candidate_inactive_coach_denied',sqlerrm='forbidden');
 end;
 update public.club_members set is_active=true where user_id='5d56ae08-76ba-438a-b50c-2daf82ed3fba' and club_id='efa61978-72ac-47f0-b0e4-0b692191c2bb' and role='coach';
 perform public.staff_seed_group_players_attendees('65a28d29-1c19-48ce-a07a-86dd81d5fddd');
 select count(*) into before_count from public.club_event_attendees where event_id='65a28d29-1c19-48ce-a07a-86dd81d5fddd';
 perform public.staff_seed_group_players_attendees('65a28d29-1c19-48ce-a07a-86dd81d5fddd');
 select count(*) into after_count from public.club_event_attendees where event_id='65a28d29-1c19-48ce-a07a-86dd81d5fddd';
 insert into legal_coverage_checks values('candidate_active_coach_seed_idempotent',before_count=after_count and before_count>0);
 perform set_config('request.jwt.claims','{"sub":"218f8e60-b0cc-4725-9e93-a8f679bcb3fa","role":"authenticated"}',true);
 begin
  perform public.staff_seed_group_players_attendees('65a28d29-1c19-48ce-a07a-86dd81d5fddd');
  insert into legal_coverage_checks values('candidate_outside_club_denied',false);
 exception when others then insert into legal_coverage_checks values('candidate_outside_club_denied',sqlerrm='forbidden'); end;
 insert into legal_coverage_checks values('helpers_off_do_not_filter',public.legal_required_thread_access(null)
 and public.legal_required_club_training_access(null) and public.legal_required_round_access(null) and public.legal_required_contest_access(null));
end $$;
select item,ok from legal_coverage_checks order by item;
rollback;
