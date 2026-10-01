-- Platform-level news managed by ActiviTee and distributed to selected clubs.
-- Content is stored once, with one translation per supported locale.

create table if not exists public.platform_news (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'archived')),
  scheduled_for timestamptz,
  published_at timestamptz,
  visible_on_home boolean not null default false,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_news_schedule_check check (status <> 'scheduled' or scheduled_for is not null)
);

create table if not exists public.platform_news_clubs (
  news_id uuid not null references public.platform_news(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (news_id, club_id)
);

create table if not exists public.platform_news_translations (
  news_id uuid not null references public.platform_news(id) on delete cascade,
  locale text not null check (locale in ('fr', 'en', 'de', 'it')),
  title text not null,
  summary text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (news_id, locale),
  constraint platform_news_translation_title_check check (btrim(title) <> '')
);

create index if not exists platform_news_publication_idx
  on public.platform_news (status, coalesce(published_at, scheduled_for, created_at) desc);
create index if not exists platform_news_clubs_club_idx
  on public.platform_news_clubs (club_id, news_id);

create or replace function public.touch_platform_news_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_platform_news_updated_at on public.platform_news;
create trigger trg_touch_platform_news_updated_at
before update on public.platform_news
for each row execute function public.touch_platform_news_updated_at();

drop trigger if exists trg_touch_platform_news_translation_updated_at on public.platform_news_translations;
create trigger trg_touch_platform_news_translation_updated_at
before update on public.platform_news_translations
for each row execute function public.touch_platform_news_updated_at();

alter table public.platform_news enable row level security;
alter table public.platform_news_clubs enable row level security;
alter table public.platform_news_translations enable row level security;

-- Active members can read published content assigned to one of their clubs.
drop policy if exists "platform_news_select_for_selected_clubs" on public.platform_news;
create policy "platform_news_select_for_selected_clubs" on public.platform_news
for select to authenticated using (
  (status in ('published', 'archived') or (status = 'scheduled' and scheduled_for <= now()))
  and
  exists (
    select 1 from public.platform_news_clubs pnc
    join public.club_members cm on cm.club_id = pnc.club_id
    where pnc.news_id = platform_news.id
      and cm.user_id = auth.uid() and cm.is_active = true
  )
);

drop policy if exists "platform_news_clubs_select_for_members" on public.platform_news_clubs;
create policy "platform_news_clubs_select_for_members" on public.platform_news_clubs
for select to authenticated using (
  exists (select 1 from public.club_members cm where cm.club_id = platform_news_clubs.club_id and cm.user_id = auth.uid() and cm.is_active = true)
);

drop policy if exists "platform_news_translations_select_for_members" on public.platform_news_translations;
create policy "platform_news_translations_select_for_members" on public.platform_news_translations
for select to authenticated using (
  exists (
    select 1 from public.platform_news_clubs pnc
    join public.platform_news pn on pn.id = pnc.news_id
    join public.club_members cm on cm.club_id = pnc.club_id
    where pnc.news_id = platform_news_translations.news_id
      and cm.user_id = auth.uid() and cm.is_active = true
      and (pn.status in ('published', 'archived') or (pn.status = 'scheduled' and pn.scheduled_for <= now()))
  )
);

-- Platform writes go through server-side Admin APIs. Keep direct client writes closed.
revoke insert, update, delete on public.platform_news from anon, authenticated;
revoke insert, update, delete on public.platform_news_clubs from anon, authenticated;
revoke insert, update, delete on public.platform_news_translations from anon, authenticated;

-- Save the news, its clubs and all translations atomically.
create or replace function public.save_platform_news_v1(
  p_news_id uuid,
  p_actor_id uuid,
  p_status text,
  p_scheduled_for timestamptz,
  p_visible_on_home boolean,
  p_image_url text,
  p_club_ids jsonb,
  p_translations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_news_id uuid := p_news_id;
  v_club_count integer;
  v_input_club_count integer;
begin
  if not exists (select 1 from public.app_admins where user_id = p_actor_id) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_status not in ('draft', 'scheduled', 'published', 'archived')
    or (p_status = 'scheduled' and p_scheduled_for is null)
  then raise exception using errcode = 'P0001', message = 'INVALID_STATUS'; end if;
  if jsonb_typeof(p_club_ids) <> 'array' or jsonb_array_length(p_club_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'CLUB_REQUIRED';
  end if;
  if jsonb_typeof(p_translations) <> 'object'
    or btrim(coalesce(p_translations #>> '{fr,title}', '')) = ''
  then raise exception using errcode = 'P0001', message = 'FRENCH_TITLE_REQUIRED'; end if;

  select count(distinct selected_club.value), count(*) into v_club_count, v_input_club_count
  from jsonb_array_elements_text(p_club_ids) selected_club(value)
  join public.clubs on clubs.id = selected_club.value::uuid;
  if v_club_count = 0 or v_club_count <> v_input_club_count then
    raise exception using errcode = 'P0001', message = 'INVALID_CLUB';
  end if;

  if v_news_id is null then
    insert into public.platform_news (created_by, updated_by, status, scheduled_for, published_at, visible_on_home, image_url)
    values (p_actor_id, p_actor_id, p_status,
      case when p_status = 'scheduled' then p_scheduled_for else null end,
      case when p_status = 'published' then now() else null end,
      coalesce(p_visible_on_home, false), nullif(btrim(coalesce(p_image_url, '')), ''))
    returning id into v_news_id;
  else
    update public.platform_news
    set updated_by = p_actor_id,
        status = p_status,
        scheduled_for = case when p_status = 'scheduled' then p_scheduled_for else null end,
        published_at = case when p_status = 'published' then coalesce(published_at, now()) else null end,
        visible_on_home = coalesce(p_visible_on_home, false),
        image_url = nullif(btrim(coalesce(p_image_url, '')), '')
    where id = v_news_id;
    if not found then raise exception using errcode = 'P0001', message = 'NEWS_NOT_FOUND'; end if;
    delete from public.platform_news_clubs where news_id = v_news_id;
    delete from public.platform_news_translations where news_id = v_news_id;
  end if;

  insert into public.platform_news_clubs (news_id, club_id)
  select v_news_id, value::uuid from jsonb_array_elements_text(p_club_ids);

  insert into public.platform_news_translations (news_id, locale, title, summary, body)
  select v_news_id, entry.key, btrim(entry.value ->> 'title'),
    nullif(btrim(coalesce(entry.value ->> 'summary', '')), ''),
    btrim(coalesce(entry.value ->> 'body', ''))
  from jsonb_each(p_translations) entry
  where entry.key in ('fr', 'en', 'de', 'it')
    and btrim(coalesce(entry.value ->> 'title', '')) <> '';

  return v_news_id;
end;
$$;

revoke all on function public.save_platform_news_v1(uuid, uuid, text, timestamptz, boolean, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_platform_news_v1(uuid, uuid, text, timestamptz, boolean, text, jsonb, jsonb) to service_role;
