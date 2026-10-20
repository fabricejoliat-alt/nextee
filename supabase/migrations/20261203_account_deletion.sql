-- Account erasure is explicitly requested by the authenticated account holder.
-- Apply after the legal, organization, document-storage and admin-security migrations.
begin;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'requested' check(status in ('requested','processing','completed','cancelled')),
  receipt_hash text not null check(receipt_hash ~ '^[0-9a-f]{64}$'),
  contact_email text,
  locale text not null default 'fr' check(locale in ('fr','en','de','it')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default (now()+interval '30 days'),
  data_erased_at timestamptz,
  files_ready_after timestamptz not null default now(),
  completed_at timestamptz,
  confirmation_sent_at timestamptz,
  last_error text,
  processed_by uuid
);
create unique index account_deletion_active_user on public.account_deletion_requests(user_id)
  where status in ('requested','processing');
create unique index account_deletion_receipt on public.account_deletion_requests(receipt_hash);
create table public.account_deletion_files (
  request_id uuid not null references public.account_deletion_requests(id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  removed_at timestamptz,
  primary key(request_id,bucket_id,object_path)
);
create table public.account_deletion_attempts (
  user_id uuid primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_files enable row level security;
alter table public.account_deletion_attempts enable row level security;
revoke all on public.account_deletion_requests,public.account_deletion_files,public.account_deletion_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.account_deletion_requests,public.account_deletion_files,public.account_deletion_attempts to service_role;

create function public.reserve_account_deletion_attempt(p_user uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
  insert into public.account_deletion_attempts(user_id) values(p_user)
  on conflict(user_id) do update set
    attempts=case when account_deletion_attempts.window_start<now()-interval '15 minutes' then 1 else account_deletion_attempts.attempts+1 end,
    window_start=case when account_deletion_attempts.window_start<now()-interval '15 minutes' then now() else account_deletion_attempts.window_start end
  returning attempts into n;
  return n<=5;
end $$;

create function public.request_account_deletion(p_user uuid,p_receipt_hash text,p_email text,p_locale text)
returns public.account_deletion_requests language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,21));
  perform 1 from auth.users where id=p_user for key share;
  if not found then raise exception 'Account unavailable'; end if;
  select * into r from public.account_deletion_requests where user_id=p_user and status in ('requested','processing') for update;
  if found then
    -- Reissuing a receipt never postpones the deadline or restarts processing.
    update public.account_deletion_requests set receipt_hash=p_receipt_hash where id=r.id returning * into r;
  else
    insert into public.account_deletion_requests(user_id,receipt_hash,contact_email,locale)
      values(p_user,p_receipt_hash,p_email,p_locale) returning * into r;
  end if;
  return r;
end $$;

-- Existing RLS, Storage and the Data API pre-request hook use this function.
-- A still-valid JWT must not restore access once erasure has started.
create or replace function public.application_session_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select case when auth.role()='service_role' then true
    when not exists(select 1 from auth.users where id=auth.uid()) then false
    when exists(select 1 from public.account_deletion_requests where user_id=auth.uid() and status in ('processing','completed')) then false
    when coalesce(auth.jwt()->'app_metadata'->>'initial_password_required','false')='true' then false
    when exists(select 1 from public.app_admins where user_id=auth.uid()) then coalesce(auth.jwt()->>'aal','')='aal2'
    else true end
$$;

-- Child rows of personal records (holes, answers, images, etc.) are erased first.
-- This helper is not an API. Only the guarded erasure function can invoke it.
create function public.account_erasure_delete(p_table regclass,p_predicate text,p_user uuid,p_depth integer default 0)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare fk record; join_sql text; child_predicate text; parent_alias text:=format('erasure_parent_%s',p_depth);
begin
  if p_depth>20 then raise exception 'Erasure dependency cycle'; end if;
  if p_table in ('public.profiles'::regclass,'public.organizations'::regclass,'public.clubs'::regclass) then
    raise exception 'Shared identity cannot be erased through a dependency';
  end if;
  for fk in select c.*,n.nspname from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and c.confrelid=p_table and c.conrelid<>p_table
  loop
    if fk.nspname<>'public' then raise exception 'Unreviewed cross-schema dependency'; end if;
    select string_agg(format('subject.%I=%I.%I',a.attname,parent_alias,b.attname),' and ' order by k.i) into join_sql
      from generate_subscripts(fk.conkey,1) k(i)
      join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=fk.conkey[k.i]
      join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=fk.confkey[k.i];
    child_predicate:=format('exists(select 1 from %s %I where (%s) and %s)',p_table,parent_alias,
      replace(p_predicate,'subject.',parent_alias||'.'),join_sql);
    perform public.account_erasure_delete(fk.conrelid,child_predicate,p_user,p_depth+1);
  end loop;
  execute format('delete from %s subject where %s',p_table,p_predicate) using p_user;
end $$;

-- The existing legal-evidence guard remains immutable outside this one transaction.
create or replace function public.legal_prevent_evidence_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op='DELETE' and tg_table_name in ('legal_presentations','legal_decisions',
    'legal_representative_events','legal_conflict_resolutions','legal_data_request_events')
    and exists(select 1 from public.account_deletion_requests
      where user_id::text=nullif(current_setting('app.account_erasure_user',true),'') and status='processing')
    and current_user=(select pg_get_userbyid(proowner) from pg_proc
      where oid='public.erase_account_data(uuid,uuid)'::regprocedure)
  then return old; end if;
  raise exception 'Published legal evidence is immutable';
end $$;

-- Keep shared club structures; remove only attribution to the departing account.
-- A coach's departure must never cascade into deleting a camp, club or other player.
create function public.account_erasure_attributions() returns jsonb
language sql immutable as $$ select '{
  "coach_groups":["head_coach_user_id"],
  "club_camps":["head_coach_user_id","created_by"],
  "club_camp_days":["responsible_coach_id"],
  "club_trainings":["created_by"],
  "club_events":["created_by"],
  "club_event_series":["created_by"],
  "club_event_attendees":["coach_recorded_by"],
  "club_event_player_structure_items":["created_by"],
  "club_camp_player_options":["assigned_by"],
  "training_sessions":["coach_user_id"],
  "message_threads":["created_by"],
  "organization_settings":["updated_by"],
  "organization_relationships":["created_by","approved_by"],
  "external_club_references":["created_by"],
  "academy_roster_entries":["created_by","source_approved_by"],
  "organization_identity_matches":["requested_by","approved_by"],
  "club_member_sensitive_field_values":["updated_by"],
  "player_guardian_scopes":["created_by"],
  "player_validation_attempts":["created_by_user_id"],
  "player_handicap_history":["created_by"],
  "om_internal_contests":["created_by"],
  "om_exceptional_tournaments":["created_by"],
  "om_bonus_entries":["created_by"],
  "rules_rewards":["created_by"],
  "rules_card_versions":["approved_by"],
  "etiquette_card_versions":["approved_by"],
  "club_news":["created_by","updated_by"],
  "platform_news":["created_by","updated_by"],
  "app_translations":["updated_by"],
  "club_evaluation_criteria":["created_by"],
  "player_periodic_report_configs":["created_by","updated_by"],
  "player_periodic_reports":["generated_by"],
  "platform_contact_settings":["updated_by"],
  "legal_documents":["created_by"],
  "legal_drafts":["updated_by"]
}'::jsonb $$;

-- Nullable authorship is required even where an old FK used SET NULL on NOT NULL.
do $$ declare item record; col text; begin
  for item in select * from jsonb_each(public.account_erasure_attributions()) loop
    if to_regclass('public.'||item.key) is null then continue; end if;
    for col in select jsonb_array_elements_text(item.value) loop
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name=item.key and column_name=col) then
        execute format('alter table public.%I alter column %I drop not null',item.key,col);
      end if;
    end loop;
  end loop;
end $$;

create function public.erase_account_data(p_request uuid,p_admin uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests; item record; col text; rel regclass;
begin
  if not exists(select 1 from public.app_admins where user_id=p_admin) then raise exception 'Forbidden'; end if;
  select * into r from public.account_deletion_requests where id=p_request for update;
  if not found or r.status not in ('requested','processing') then raise exception 'Request unavailable'; end if;
  if r.user_id=p_admin then raise exception 'Another administrator must process this request'; end if;
  update public.account_deletion_requests set status='processing',processed_by=p_admin,last_error=null where id=r.id;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||'{"account_deletion_started":true}'::jsonb,
    banned_until=now()+interval '100 years' where id=r.user_id;
  perform set_config('app.account_erasure_user',r.user_id::text,true);
  -- Existing signed upload URLs remain valid for two hours. Retain their paths
  -- even if no object exists yet and never confirm completion before they expire.
  update public.account_deletion_requests set files_ready_after=greatest(files_ready_after,
    coalesce((select max(expires_at)+interval '10 minutes' from public.player_document_upload_reservations
      where player_id=r.user_id or uploaded_by=r.user_id),now())) where id=r.id;
  insert into public.account_deletion_files(request_id,bucket_id,object_path)
    select r.id,storage_bucket,storage_path from public.player_dashboard_documents where player_id=r.user_id or uploaded_by=r.user_id
    union select r.id,storage_bucket,storage_path from public.player_document_upload_reservations where player_id=r.user_id or uploaded_by=r.user_id
  on conflict do nothing;

  -- Capture files before deleting their metadata. Physical deletion uses Storage API,
  -- never SQL DELETE on storage.objects (which would leave the bytes behind).
  insert into public.account_deletion_files(request_id,bucket_id,object_path)
    select r.id,o.bucket_id,o.name from storage.objects o
    where o.owner::text=r.user_id::text or to_jsonb(o)->>'owner_id'=r.user_id::text or split_part(o.name,'/',1)=r.user_id::text
      or (o.bucket_id in ('player-documents','marketplace') and split_part(o.name,'/',1)='player-documents' and split_part(o.name,'/',3)=r.user_id::text)
      or exists(select 1 from public.player_dashboard_documents d
        where (d.player_id=r.user_id or d.uploaded_by=r.user_id) and d.storage_path=o.name and d.storage_bucket=o.bucket_id)
      or exists(select 1 from public.player_document_upload_reservations d
        where (d.player_id=r.user_id or d.uploaded_by=r.user_id) and d.storage_path=o.name and d.storage_bucket=o.bucket_id)
      or exists(select 1 from public.account_deletion_files f
        where f.request_id=r.id and f.object_path=o.name and f.bucket_id=o.bucket_id)
  on conflict(request_id,bucket_id,object_path) do update set removed_at=null;

  for item in select * from jsonb_each(public.account_erasure_attributions()) loop
    rel:=to_regclass('public.'||item.key);
    if rel is null then continue; end if;
    for col in select jsonb_array_elements_text(item.value) loop
      if exists(select 1 from pg_attribute where attrelid=rel and attname=col and not attisdropped) then
        execute format('update %s set %I=null where %I=$1',rel,col,col) using r.user_id;
      end if;
    end loop;
  end loop;

  -- Explicit ownership, including legacy UUID columns with no foreign keys.
  -- Never infer ownership from "created_by" on shared club activities.
  for item in select * from jsonb_each('{
    "thread_messages":["sender_user_id"],"message_threads":["player_id"],
    "coach_player_private_notes":["player_id","author_coach_id"],
    "coach_training_debriefs":["author_coach_id"],
    "coach_training_preparation_insights":["player_id"],
    "coach_training_preparation_reads":["player_id","coach_id"],
    "player_dashboard_documents":["player_id","uploaded_by"],
    "player_document_upload_reservations":["player_id","uploaded_by"],
    "marketplace_items":["user_id"],"golf_rounds":["user_id"],"training_sessions":["user_id"],
    "player_camps":["user_id"],"player_activity_events":["user_id"],
    "player_handicap_history":["user_id"],"player_validation_attempts":["player_id"],
    "club_training_coach_evals":["player_user_id","coach_user_id"],
    "club_training_attendance":["player_user_id"],
    "club_event_evaluation_responses":["player_id","respondent_user_id"],
    "club_event_coach_feedback":["player_id","coach_id"],
    "club_event_player_feedback":["player_id"],"club_event_player_structure_items":["player_id"],
    "club_event_attendees":["player_id"],"club_event_coaches":["coach_id"],
    "club_event_reminders":["created_by"],
    "club_camp_players":["player_id"],"club_camp_coaches":["coach_id"],"club_camp_player_options":["player_id"],
    "coach_players":["player_user_id","coach_user_id"],"coach_group_players":["player_user_id"],
    "coach_group_coaches":["coach_user_id"],"coach_player_group_transfers":["player_user_id","performed_by"],
    "rules_coach_coverage":["coach_user_id"],"rules_quiz_attempts":["player_user_id"],
    "rules_card_progress":["player_user_id"],"rules_reward_winners":["user_id"],
    "om_internal_contest_results":["player_id"],"om_tournament_scores":["player_id"],"om_bonus_entries":["player_id"],
    "player_periodic_report_configs":["player_user_id"],"player_periodic_reports":["player_user_id"],
    "player_periodic_report_deliveries":["recipient_user_id"],
    "notifications":["actor_user_id","created_by"],"notification_recipients":["user_id"],
    "push_subscriptions":["user_id"],"user_notification_preferences":["user_id"],
    "thread_participants":["user_id"],"club_news_email_deliveries":["recipient_user_id"],
    "access_invitation_logs":["recipient_user_id","target_user_id","sent_by"],
    "access_invitation_tokens":["user_id","recipient_user_id","sent_by"],
    "legal_current_state":["beneficiary_id"],
    "legal_parent_challenges":["actor_id","beneficiary_id"],
    "legal_conflict_resolutions":["beneficiary_id","resolved_by"],
    "legal_decisions":["actor_id","beneficiary_id"],
    "legal_presentations":["actor_id","beneficiary_id"],
    "legal_representative_events":["guardian_id","child_id","reviewed_by"],
    "legal_representative_assertions":["guardian_id","child_id","verified_by"],
    "legal_legacy_current_refs":["player_user_id"],
    "player_consents":["player_user_id","signer_guardian_user_id"],
    "player_consent_history":["player_user_id","signer_guardian_user_id","changed_by"],
    "legal_data_requests":["requester_id"],
    "legal_data_request_events":["actor_id"],
    "player_guardian_scopes":["player_id","guardian_user_id"],
    "player_guardians":["player_id","guardian_user_id"],
    "organization_identity_matches":["player_id"],"academy_roster_entries":["player_id"],
    "club_members":["user_id"],"program_members":["user_id"],"organization_members":["user_id"],
    "organization_audit_events":["actor_id"],"rules_admin_events":["actor_user_id"],
    "manager_om_write_requests":["actor_id"],"coach_event_creation_requests":["actor_id"],
    "manager_activity_creation_requests":["actor_id"],"manager_event_creation_requests":["actor_id"],
    "account_deletion_attempts":["user_id"],"app_admins":["user_id"]
  }'::jsonb) loop
    rel:=to_regclass('public.'||item.key);
    if rel is null then continue; end if;
    for col in select jsonb_array_elements_text(item.value) loop
      if exists(select 1 from pg_attribute where attrelid=rel and attname=col and not attisdropped) then
        perform public.account_erasure_delete(rel,format('subject.%I=$1',col),r.user_id);
      end if;
    end loop;
  end loop;

  -- Remove legacy requests matched by the verified email, and embedded recipient lists.
  if r.contact_email is not null then
    perform public.account_erasure_delete('public.legal_data_requests',
      'lower(subject.contact_email)=(select lower(contact_email) from public.account_deletion_requests where user_id=$1 and status=''processing'')',r.user_id);
  end if;
  update public.player_periodic_report_configs set recipient_user_ids=array_remove(recipient_user_ids,r.user_id)
    where r.user_id=any(recipient_user_ids);
  delete from public.player_periodic_report_deliveries where r.user_id=any(player_user_ids);
  update public.player_consents set updated_by=null where updated_by=r.user_id;
  -- Audit/version publisher UUIDs are not login records; remove personal security events.
  delete from public.admin_security_events where actor_id=r.user_id or target_id=r.user_id::text;
  update public.account_deletion_requests set data_erased_at=now() where id=r.id;
  perform set_config('app.account_erasure_user','',true);
end $$;

create function public.finish_account_deletion(p_request uuid,p_admin uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.account_deletion_requests; fk record; remaining boolean;
begin
  if not exists(select 1 from public.app_admins where user_id=p_admin) then raise exception 'Forbidden'; end if;
  select * into r from public.account_deletion_requests where id=p_request for update;
  if not found then raise exception 'Request unavailable'; end if;
  if r.status='completed' then return; end if;
  if r.status<>'processing' or r.data_erased_at is null then raise exception 'Erasure incomplete'; end if;
  if r.files_ready_after>now() then raise exception 'Existing upload links have not expired'; end if;
  if exists(select 1 from public.account_deletion_files where request_id=r.id and removed_at is null)
    or exists(select 1 from public.account_deletion_files f join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path where f.request_id=r.id)
    or exists(select 1 from storage.objects o where owner::text=r.user_id::text or to_jsonb(o)->>'owner_id'=r.user_id::text or split_part(name,'/',1)=r.user_id::text
      or (o.bucket_id in ('player-documents','marketplace') and split_part(o.name,'/',1)='player-documents' and split_part(o.name,'/',3)=r.user_id::text))
  then raise exception 'Files remain'; end if;
  -- Fail closed on new or unclassified public references, including CASCADE FKs.
  for fk in select c.conrelid::regclass rel,a.attname col from pg_constraint c
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and n.nspname='public' and array_length(c.conkey,1)=1
      and c.confrelid in ('public.profiles'::regclass,'auth.users'::regclass)
      and c.conrelid<>'public.profiles'::regclass
  loop
    execute format('select exists(select 1 from %s where %I=$1)',fk.rel,fk.col) into remaining using r.user_id;
    if remaining then raise exception 'Unprocessed reference: %.%',fk.rel,fk.col; end if;
  end loop;
  -- No CASCADE override: an unreviewed dependency aborts the transaction.
  delete from public.profiles where id=r.user_id;
  delete from auth.users where id=r.user_id;
  if exists(select 1 from auth.users where id=r.user_id) then raise exception 'Account still exists'; end if;
  update public.account_deletion_requests set status='completed',completed_at=now(),last_error=null where id=r.id;
end $$;

revoke all on function public.account_erasure_delete(regclass,text,uuid,integer),public.account_erasure_attributions() from public,anon,authenticated,service_role;
revoke all on function public.reserve_account_deletion_attempt(uuid),public.request_account_deletion(uuid,text,text,text),
  public.erase_account_data(uuid,uuid),public.finish_account_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_account_deletion_attempt(uuid),public.request_account_deletion(uuid,text,text,text),
  public.erase_account_data(uuid,uuid),public.finish_account_deletion(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
