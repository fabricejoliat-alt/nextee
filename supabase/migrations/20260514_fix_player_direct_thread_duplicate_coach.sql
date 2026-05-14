-- Fix a corrupted direct player thread that contains two coaches.
-- Keep only the creator coach, the player, and the parents.

delete from public.thread_participants tp
using public.message_threads t
where t.id = 'd9db02e0-2e63-4e03-8ed0-8d7c0b72fbba'
  and tp.thread_id = t.id
  and tp.user_id <> t.player_id
  and tp.user_id <> t.created_by
  and exists (
    select 1
    from public.club_members cm
    where cm.user_id = tp.user_id
      and cm.club_id = t.organization_id
      and cm.is_active = true
      and cm.role = 'coach'
  );
