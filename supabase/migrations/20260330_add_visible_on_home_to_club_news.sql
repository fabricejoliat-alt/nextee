alter table if exists public.club_news
  add column if not exists visible_on_home boolean not null default false;

