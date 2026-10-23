-- Break the notification -> recipient -> notification RLS cycle during INSERT.
-- Keep ownership, organization visibility, session gates and recipient eligibility.
begin;
create or replace function public.can_assign_notification_recipient_v1(p_notification uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and exists(
    select 1 from public.notifications n where n.id=p_notification
      and (n.actor_user_id=auth.uid() or n.created_by=auth.uid() or public.is_app_admin(auth.uid()))
      and public.organization_notification_visible(n.id,auth.uid())
      and public.organization_view_scope(n.club_id)
  );
$$;
revoke all on function public.can_assign_notification_recipient_v1(uuid) from public,anon;
grant execute on function public.can_assign_notification_recipient_v1(uuid) to authenticated,service_role;

drop policy if exists notification_recipients_insert_by_actor on public.notification_recipients;
drop policy if exists notification_recipients_insert_admin_or_creator on public.notification_recipients;
drop policy if exists notification_recipients_insert_authorized_actor on public.notification_recipients;
create policy notification_recipients_insert_authorized_actor on public.notification_recipients
for insert to authenticated
with check(public.can_assign_notification_recipient_v1(notification_id));
notify pgrst, 'reload schema';
commit;
