-- Auto-unarchive discussions on new messages.
-- Business rule:
-- - sender: if they post in an archived thread, unarchive it for them
-- - recipients: if they receive a new message in an archived thread, unarchive it for them
--
-- Implementation: on each inserted thread message, unarchive the thread for all participants.

create or replace function public.unarchive_thread_participants_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.thread_participants
  set
    is_archived = false,
    updated_at = now()
  where thread_id = new.thread_id
    and is_archived = true;

  return new;
end;
$$;

drop trigger if exists trg_unarchive_thread_participants_on_new_message on public.thread_messages;
create trigger trg_unarchive_thread_participants_on_new_message
after insert on public.thread_messages
for each row execute function public.unarchive_thread_participants_on_new_message();

