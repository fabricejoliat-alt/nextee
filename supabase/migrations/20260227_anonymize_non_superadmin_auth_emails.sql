-- Remove real emails for all non-superadmin accounts.
-- Keep a deterministic technical email so username/password login still works.

update auth.users u
set
  email = 'user.' || replace(u.id::text, '-', '') || '@noemail.local',
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  email_change_confirm_status = 0,
  updated_at = now()
where u.id not in (
  select a.user_id
  from public.app_admins a
)
and (
  u.email is null
  or u.email !~* '@noemail\.local$'
);

