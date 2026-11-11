begin;

-- Editing an existing recurrence may legitimately leave no future dates:
-- shortening it into the past must still cancel the surplus scheduled slots.
-- Patch only the business function, preserving the legal gate, permissions,
-- conflict checks and the existing non-destructive cancellation logic.
do $series_end_date$
declare
  signature regprocedure := to_regprocedure('public.update_manager_event_series_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)');
  definition text;
  guard text := 'if cardinality(dates)=0 then raise exception ''empty_series'' using errcode=''22023''; end if;';
begin
  if signature is null then raise exception 'Manager series business function missing'; end if;
  definition := pg_get_functiondef(signature);
  if (length(definition)-length(replace(definition,guard,'')))/length(guard) <> 1 then
    raise exception 'Unexpected Manager series definition: empty-series guard';
  end if;
  execute replace(definition,guard,'-- Zero future dates are valid when editing an existing recurrence.');
end $series_end_date$;

notify pgrst, 'reload schema';
commit;
