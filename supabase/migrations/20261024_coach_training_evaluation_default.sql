-- Coach creation omitted requires_evaluation, inheriting the opt-in table
-- default. Update only that insert, preserving legal wrappers and permissions.
begin;
do $migration$
declare
  target regprocedure;
  definition text;
  updated text;
begin
  target := coalesce(
    to_regprocedure('public.create_coach_events_v1_business(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)'),
    to_regprocedure('public.create_coach_events_v1(uuid,uuid,text,jsonb,uuid[],uuid[],jsonb)')
  );
  if target is null then raise exception 'coach_creation_function_missing'; end if;
  definition := pg_get_functiondef(target);
  if position('coach_note,created_by,requires_evaluation)' in definition) > 0 then return; end if;
  updated := replace(definition,
    'duration_minutes,location_text,coach_note,created_by)',
    'duration_minutes,location_text,coach_note,created_by,requires_evaluation)');
  updated := replace(updated,
    'nullif(btrim(p_template->>''coach_note''),''''),auth.uid()) returning id into v_event_id;',
    'nullif(btrim(p_template->>''coach_note''),''''),auth.uid(),v_type in (''training'',''camp'') and coalesce((p_template->>''requires_evaluation'')::boolean,true)) returning id into v_event_id;');
  if updated = definition or position('coalesce((p_template->>''requires_evaluation'')::boolean,true)' in updated) = 0 then
    raise exception 'unexpected_coach_creation_definition';
  end if;
  execute updated;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
