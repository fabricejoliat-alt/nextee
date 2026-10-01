-- Coach security batch 1. Apply with the matching application changes.
-- No club, activity, feedback or private note is deleted or migrated.
begin;

-- Assignments are subordinate to an ACTIVE membership in the same club.
create or replace function public.is_group_staff_member(p_group_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.coach_groups g
    join public.club_members cm on cm.club_id = g.club_id
      and cm.user_id = p_user_id
      and cm.is_active = true and cm.role in ('coach', 'manager')
    where g.id = p_group_id and (
      cm.role = 'manager' or g.head_coach_user_id = cm.user_id or exists (
        select 1 from public.coach_group_coaches cgc
        where cgc.group_id = g.id and cgc.coach_user_id = cm.user_id
      )
    )
  );
$$;
revoke all on function public.is_group_staff_member(uuid, uuid) from public, anon;
grant execute on function public.is_group_staff_member(uuid, uuid) to authenticated, service_role;

create or replace function public.can_manage_coach_event(p_event_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
      and cm.user_id = case when auth.role() = 'service_role' then p_user_id else auth.uid() end
      and cm.is_active = true and cm.role in ('coach', 'manager')
    where e.id = p_event_id and (
      cm.role = 'manager'
      or exists (
        select 1 from public.coach_groups g
        where g.id = e.group_id and g.club_id = e.club_id
          and public.is_group_staff_member(g.id, cm.user_id)
      )
      or exists (
        select 1 from public.club_event_coaches ec
        where ec.event_id = e.id and ec.coach_id = cm.user_id
      )
    )
  );
$$;
revoke all on function public.can_manage_coach_event(uuid, uuid) from public, anon;
grant execute on function public.can_manage_coach_event(uuid, uuid) to authenticated, service_role;

-- Sensitive player-wide material requires a relationship IN THIS CLUB.
create or replace function public.can_read_coach_player_sensitive(p_club_id uuid, p_player_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.club_members staff
    join public.club_members player on player.club_id = staff.club_id
      and player.user_id = p_player_id and player.is_active = true and player.role = 'player'
    where staff.club_id = p_club_id and staff.user_id = auth.uid()
      and staff.is_active = true and staff.role in ('coach', 'manager')
      and (staff.role = 'manager' or exists (
        select 1 from public.coach_groups g
        join public.coach_group_players gp on gp.group_id = g.id and gp.player_user_id = p_player_id
        where g.club_id = p_club_id and g.is_active = true
          and public.is_group_staff_member(g.id, staff.user_id)
      ))
  );
$$;
revoke all on function public.can_read_coach_player_sensitive(uuid, uuid) from public, anon;
grant execute on function public.can_read_coach_player_sensitive(uuid, uuid) to authenticated;

-- A row-level policy cannot conceal a column. Remove table-wide SELECT, then
-- grant only the non-private columns. Service-role APIs retain access, after
-- the explicit event/player/club checks. Also revoke any prior column grant.
revoke select on public.club_event_coach_feedback from public, anon, authenticated;
revoke select (private_note) on public.club_event_coach_feedback from public, anon, authenticated;
do $$
declare readable_columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into readable_columns
  from pg_attribute
  where attrelid = 'public.club_event_coach_feedback'::regclass
    and attnum > 0 and not attisdropped and attname <> 'private_note';
  execute format('grant select (%s) on public.club_event_coach_feedback to authenticated', readable_columns);
end;
$$;
grant all on public.club_event_coach_feedback to service_role;

-- Coach writes must use the guided RPC, never a direct REST insert/update.
revoke insert, update, delete on public.club_event_coach_feedback from public, anon, authenticated;
do $$
declare all_columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into all_columns
  from pg_attribute where attrelid = 'public.club_event_coach_feedback'::regclass
    and attnum > 0 and not attisdropped;
  execute format('revoke insert (%s), update (%s) on public.club_event_coach_feedback from public, anon, authenticated', all_columns, all_columns);
end;
$$;

-- Manager screens share this table. Preserve their workflow through a narrowly
-- authorized function rather than re-granting the private column to browsers.
create or replace function public.save_manager_event_feedback_v1(p_event_id uuid, p_player_id uuid, p_feedback jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_event public.club_events%rowtype;
  v_engagement integer := (p_feedback->>'engagement')::integer;
  v_attitude integer := (p_feedback->>'attitude')::integer;
  v_performance integer := (p_feedback->>'performance')::integer;
  v_private_note text := nullif(btrim(p_feedback->>'private_note'), '');
  v_player_note text := nullif(btrim(p_feedback->>'player_note'), '');
begin
  select * into v_event from public.club_events where id = p_event_id for update;
  if v_event.id is null then raise exception 'event_not_found'; end if;
  if not exists (select 1 from public.club_members cm where cm.club_id = v_event.club_id
    and cm.user_id = auth.uid() and cm.role = 'manager' and cm.is_active = true) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.club_event_attendees a where a.event_id = p_event_id and a.player_id = p_player_id) then
    raise exception 'unknown_attendee';
  end if;
  if v_event.status = 'cancelled' or coalesce(v_event.ends_at, v_event.starts_at + make_interval(mins => coalesce(v_event.duration_minutes, 0))) > now() then
    raise exception 'event_not_finished';
  end if;
  if p_feedback is null or jsonb_typeof(p_feedback) <> 'object'
    or v_engagement not between 1 and 6 or v_attitude not between 1 and 6 or v_performance not between 1 and 6
    or char_length(coalesce(v_private_note, '')) > 4000 or char_length(coalesce(v_player_note, '')) > 4000 then
    raise exception 'invalid_feedback';
  end if;
  insert into public.club_event_coach_feedback
    (event_id, player_id, coach_id, engagement, attitude, performance, visible_to_player, private_note, player_note)
  values (p_event_id, p_player_id, auth.uid(), v_engagement, v_attitude, v_performance,
    coalesce((p_feedback->>'visible_to_player')::boolean, false), v_private_note, v_player_note)
  on conflict (event_id, player_id, coach_id) do update set
    engagement = excluded.engagement, attitude = excluded.attitude, performance = excluded.performance,
    visible_to_player = excluded.visible_to_player, private_note = excluded.private_note, player_note = excluded.player_note;
end;
$$;
revoke all on function public.save_manager_event_feedback_v1(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_manager_event_feedback_v1(uuid, uuid, jsonb) to authenticated;

drop policy if exists guardian_can_read_child_coach_feedback on public.club_event_coach_feedback;
create policy guardian_can_read_child_coach_feedback on public.club_event_coach_feedback
for select to authenticated using (
  visible_to_player = true and exists (
    select 1 from public.player_guardians pg
    where pg.player_id = club_event_coach_feedback.player_id
      and pg.guardian_user_id = auth.uid() and coalesce(pg.can_view, true)
  )
);
-- Restrictive policy also closes any older permissive staff/owner SELECT rule.
drop policy if exists coach_feedback_read_scope on public.club_event_coach_feedback;
create policy coach_feedback_read_scope on public.club_event_coach_feedback
as restrictive for select to authenticated using (
  public.can_manage_coach_event(event_id, auth.uid())
  or (visible_to_player = true and (
    player_id = auth.uid() or exists (
      select 1 from public.player_guardians pg
      where pg.player_id = club_event_coach_feedback.player_id
        and pg.guardian_user_id = auth.uid() and coalesce(pg.can_view, true)
    )
  ))
);

-- Private derived notes are accessed through authorized service-role APIs only.
revoke all on public.coach_player_private_notes from public, anon, authenticated;
grant all on public.coach_player_private_notes to service_role;
revoke all on public.coach_training_debriefs from public, anon, authenticated;
grant all on public.coach_training_debriefs to service_role;

-- Replace the older assignment-only policies used by direct browser readers.
drop policy if exists group_staff_can_select_club_events on public.club_events;
create policy group_staff_can_select_club_events on public.club_events for select to authenticated
using (public.can_manage_coach_event(id, auth.uid()));
drop policy if exists group_staff_can_select_club_event_coaches on public.club_event_coaches;
create policy group_staff_can_select_club_event_coaches on public.club_event_coaches for select to authenticated
using (public.can_manage_coach_event(event_id, auth.uid()));
drop policy if exists group_staff_can_select_club_event_attendees on public.club_event_attendees;
create policy group_staff_can_select_club_event_attendees on public.club_event_attendees for select to authenticated
using (public.can_manage_coach_event(event_id, auth.uid()));

drop policy if exists participants_can_read_player_structure_items on public.club_event_player_structure_items;
create policy participants_can_read_player_structure_items on public.club_event_player_structure_items for select to authenticated
using (public.can_manage_coach_event(event_id, auth.uid()) or player_id = auth.uid() or exists (
  select 1 from public.player_guardians pg where pg.player_id = club_event_player_structure_items.player_id
    and pg.guardian_user_id = auth.uid() and coalesce(pg.can_view, true)
));
drop policy if exists group_staff_can_manage_player_structure_items on public.club_event_player_structure_items;
create policy group_staff_can_manage_player_structure_items on public.club_event_player_structure_items for all to authenticated
using (public.can_manage_coach_event(event_id, auth.uid())
  and exists (select 1 from public.club_event_attendees a where a.event_id = club_event_player_structure_items.event_id
    and a.player_id = club_event_player_structure_items.player_id))
with check (public.can_manage_coach_event(event_id, auth.uid())
  and exists (select 1 from public.club_event_attendees a where a.event_id = club_event_player_structure_items.event_id
    and a.player_id = club_event_player_structure_items.player_id));

drop policy if exists group_staff_can_insert_club_event_coaches on public.club_event_coaches;
create policy group_staff_can_insert_club_event_coaches on public.club_event_coaches for insert to authenticated
with check (
  exists (select 1 from public.club_events e where e.id = event_id
    and public.can_manage_assigned_group(e.group_id, auth.uid(), 'planning')
    and exists (select 1 from public.club_members cm where cm.club_id = e.club_id
      and cm.user_id = coach_id and cm.role = 'coach' and cm.is_active = true))
);
drop policy if exists group_staff_can_delete_club_event_coaches on public.club_event_coaches;
create policy group_staff_can_delete_club_event_coaches on public.club_event_coaches for delete to authenticated
using (exists (select 1 from public.club_events e where e.id = event_id
  and public.can_manage_assigned_group(e.group_id, auth.uid(), 'planning')));
drop policy if exists group_staff_can_insert_club_event_attendees on public.club_event_attendees;
create policy group_staff_can_insert_club_event_attendees on public.club_event_attendees for insert to authenticated
with check (exists (select 1 from public.club_events e where e.id = event_id
  and public.can_manage_assigned_group(e.group_id, auth.uid(), 'planning')
  and exists (select 1 from public.club_members cm where cm.club_id = e.club_id
    and cm.user_id = player_id and cm.role = 'player' and cm.is_active = true)));

drop policy if exists group_staff_can_select_club_event_series on public.club_event_series;
create policy group_staff_can_select_club_event_series on public.club_event_series for select to authenticated
using (public.is_group_staff_member(group_id, auth.uid()));
drop policy if exists group_staff_can_insert_club_event_series on public.club_event_series;
create policy group_staff_can_insert_club_event_series on public.club_event_series for insert to authenticated
with check (public.can_manage_assigned_group(group_id, auth.uid(), 'planning'));
drop policy if exists group_staff_can_update_club_event_series on public.club_event_series;
create policy group_staff_can_update_club_event_series on public.club_event_series for update to authenticated
using (public.can_manage_assigned_group(group_id, auth.uid(), 'planning'))
with check (public.can_manage_assigned_group(group_id, auth.uid(), 'planning'));
drop policy if exists group_staff_can_delete_club_event_series on public.club_event_series;
create policy group_staff_can_delete_club_event_series on public.club_event_series for delete to authenticated
using (public.can_manage_assigned_group(group_id, auth.uid(), 'planning'));

-- Browser metadata reads follow the same club/player boundary as signed URLs.
create or replace function public.can_staff_access_player_document(p_club_id uuid, p_player_id uuid, p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_coach_player_sensitive(p_club_id, p_player_id)
    or exists (
      select 1 from public.club_events e
      join public.club_event_attendees a on a.event_id = e.id and a.player_id = p_player_id
      where e.id = p_event_id and e.club_id = p_club_id and public.can_manage_coach_event(e.id, auth.uid())
    );
$$;
revoke all on function public.can_staff_access_player_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_staff_access_player_document(uuid, uuid, uuid) to authenticated;

drop policy if exists player_dashboard_documents_select_staff on public.player_dashboard_documents;
create policy player_dashboard_documents_select_staff on public.player_dashboard_documents for select to authenticated
using (public.can_staff_access_player_document(organization_id, player_id, club_event_id));
drop policy if exists player_dashboard_documents_insert_staff on public.player_dashboard_documents;
create policy player_dashboard_documents_insert_staff on public.player_dashboard_documents for insert to authenticated
with check (uploaded_by = auth.uid() and public.can_staff_access_player_document(organization_id, player_id, club_event_id));
drop policy if exists player_dashboard_documents_delete_staff on public.player_dashboard_documents;
create policy player_dashboard_documents_delete_staff on public.player_dashboard_documents for delete to authenticated
using (public.can_staff_access_player_document(organization_id, player_id, club_event_id));

-- Defend against older owner/staff metadata policies as well.
drop policy if exists player_documents_read_scope on public.player_dashboard_documents;
create policy player_documents_read_scope on public.player_dashboard_documents as restrictive for select to authenticated
using (public.can_staff_access_player_document(organization_id, player_id, club_event_id)
  or (not coach_only and (player_id = auth.uid() or exists (
    select 1 from public.player_guardians pg where pg.player_id = player_dashboard_documents.player_id
      and pg.guardian_user_id = auth.uid() and coalesce(pg.can_view, true)
  ))));

create or replace function public.can_staff_access_evaluation_event(p_event_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id and cm.user_id = p_user_id
      and cm.is_active = true and cm.role in ('coach', 'manager')
    where e.id = p_event_id and (cm.role = 'manager'
      or exists (select 1 from public.coach_groups g where g.id = e.group_id and g.club_id = e.club_id
        and public.is_group_staff_member(g.id, p_user_id))
      or exists (select 1 from public.club_event_coaches ec where ec.event_id = e.id and ec.coach_id = p_user_id))
  );
$$;
revoke all on function public.can_staff_access_evaluation_event(uuid, uuid) from public, anon;
grant execute on function public.can_staff_access_evaluation_event(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
