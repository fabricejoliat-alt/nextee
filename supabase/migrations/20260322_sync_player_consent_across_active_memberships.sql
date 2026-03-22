with consent_by_user as (
  select
    user_id,
    case
      when bool_or(player_consent_status = 'granted') then 'granted'
      when bool_or(player_consent_status = 'adult') then 'adult'
      when bool_or(player_consent_status = 'pending') then 'pending'
      else null
    end as normalized_status
  from public.club_members
  where role = 'player'
    and is_active = true
  group by user_id
)
update public.club_members cm
set player_consent_status = c.normalized_status
from consent_by_user c
where cm.user_id = c.user_id
  and cm.role = 'player'
  and cm.is_active = true
  and c.normalized_status is not null
  and cm.player_consent_status is distinct from c.normalized_status;
