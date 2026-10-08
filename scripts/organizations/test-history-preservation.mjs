// Tables whose complete original data must survive the populated TEST migration.
export const testHistoryTables = ['auth.users','public.profiles','public.app_admins','public.club_members','public.player_guardians',
 'public.training_sessions','public.training_session_items','public.golf_rounds','public.golf_round_holes',
 'public.player_activity_events','public.player_camps','public.player_camp_days','public.player_validation_attempts',
 'public.club_events','public.club_event_attendees','public.coach_groups','public.coach_group_players',
 'public.coach_player_private_notes','public.club_event_coach_feedback','public.player_periodic_reports','public.player_periodic_report_deliveries',
 'public.training_volume_settings','public.training_volume_targets'];
export function historyCheckpoint() {
 return `create temporary table activitee_test_history_checkpoint(name text primary key, columns text[], fingerprint text) on commit drop;
 do $$ declare name text; fields text[]; expression text; fingerprint text; begin
  foreach name in array array[${testHistoryTables.map(name=>`'${name}'`).join(',')}] loop
   select array_agg(attname order by attnum) into fields from pg_attribute where attrelid=name::regclass and attnum>0 and not attisdropped;
   select 'jsonb_build_object('||string_agg(quote_literal(field)||',t.'||quote_ident(field),',')||')' into expression from unnest(fields) field;
   execute format('select md5(coalesce(jsonb_agg(j order by j::text)::text,''[]'')) from (select %s j from %s t) data',expression,name) into fingerprint;
   insert into activitee_test_history_checkpoint values(name,fields,fingerprint);
  end loop;
 end $$;`;
}
export function historyAssertion() {
 return `do $$ declare checkpoint record; expression text; fingerprint text; begin
  for checkpoint in select * from activitee_test_history_checkpoint loop
   select 'jsonb_build_object('||string_agg(quote_literal(field)||',t.'||quote_ident(field),',')||')' into expression from unnest(checkpoint.columns) field;
   execute format('select md5(coalesce(jsonb_agg(j order by j::text)::text,''[]'')) from (select %s j from %s t) data',expression,checkpoint.name) into fingerprint;
   if fingerprint<>checkpoint.fingerprint then raise exception 'TEST history changed: %',checkpoint.name; end if;
  end loop;
 end $$; select name,'preserved' as status from activitee_test_history_checkpoint order by name;`;
}
