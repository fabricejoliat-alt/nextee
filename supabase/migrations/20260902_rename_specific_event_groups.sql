-- Event-specific support groups are internal implementation details. Keep their
-- label readable everywhere it can surface in the manager interface.
update public.coach_groups
set name = 'Groupe spécifique'
where name like '__EVENT_SPECIFIQUE__%';
