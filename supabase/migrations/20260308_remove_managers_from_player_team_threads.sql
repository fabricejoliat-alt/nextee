-- Team player threads are coach-only: remove manager participants.

delete from public.thread_participants tp
using public.message_threads t,
      public.club_members cm
where tp.thread_id = t.id
  and t.thread_type = 'player'
  and coalesce(t.player_thread_scope, 'direct') = 'team'
  and cm.club_id = t.organization_id
  and cm.user_id = tp.user_id
  and cm.role = 'manager';
