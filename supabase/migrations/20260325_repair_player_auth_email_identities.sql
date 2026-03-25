-- Repair player email identities after direct SQL updates on auth.users.email.
-- For provider='email', provider_id must track the identity "sub" (user id),
-- while identity_data.email must track the current auth.users.email.

update auth.identities i
set
  provider_id = u.id::text,
  identity_data = jsonb_set(
    jsonb_set(
      coalesce(i.identity_data, '{}'::jsonb),
      '{sub}',
      to_jsonb(u.id::text),
      true
    ),
    '{email}',
    to_jsonb(u.email::text),
    true
  ),
  updated_at = now()
from auth.users u
join public.club_members cm
  on cm.user_id = u.id
 and cm.role = 'player'
 and cm.is_active = true
where i.user_id = u.id
  and i.provider = 'email'
  and u.email is not null;

