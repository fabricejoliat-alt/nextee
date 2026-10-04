-- Apply only after reviewing the TEST audit. No data write or legal activation.
-- These Coach debrief RPCs were intended for service-role callers, but the
-- TEST privilege export showed inherited or explicit anon/authenticated EXECUTE.
begin;
revoke all on function public.save_coach_training_debrief(uuid,uuid,text,text,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.save_coach_training_debrief(uuid,uuid,text,text,jsonb,boolean)
  to service_role;

revoke all on function public.save_coach_training_debrief_v2(uuid,uuid,text,text,text,jsonb,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.save_coach_training_debrief_v2(uuid,uuid,text,text,text,jsonb,jsonb,boolean)
  to service_role;

revoke all on function public.validate_coach_training_private_notes(uuid,uuid,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.validate_coach_training_private_notes(uuid,uuid,integer,jsonb)
  to service_role;
commit;
