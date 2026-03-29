alter table if exists public.club_news
  add column if not exists linked_club_event_id uuid null references public.club_events(id) on delete set null;

alter table if exists public.club_news
  add column if not exists linked_camp_id uuid null references public.club_camps(id) on delete set null;

alter table if exists public.club_news
  drop constraint if exists club_news_single_linked_content_check;

alter table if exists public.club_news
  add constraint club_news_single_linked_content_check
  check (
    (case when linked_club_event_id is null then 0 else 1 end) +
    (case when linked_camp_id is null then 0 else 1 end) <= 1
  );

create index if not exists club_news_linked_event_idx
  on public.club_news (linked_club_event_id)
  where linked_club_event_id is not null;

create index if not exists club_news_linked_camp_idx
  on public.club_news (linked_camp_id)
  where linked_camp_id is not null;
