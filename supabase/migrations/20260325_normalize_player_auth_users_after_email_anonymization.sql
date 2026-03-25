-- Normalize auth.users state for player accounts after direct SQL email updates.
-- This keeps the anonymized email but clears any stale email-change workflow state
-- that can block email/password authentication.

update auth.users u
set
  email_change = '',
  email_change_token_new = '',
  email_change_token_current = '',
  email_change_confirm_status = 0,
  updated_at = now()
from public.club_members cm
where cm.user_id = u.id
  and cm.role = 'player'
  and cm.is_active = true
  and u.email is not null
  and u.email ~* '@noemail\.local$';
