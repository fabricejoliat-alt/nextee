-- Add per-club audience roles to ActiviTee platform news.

alter table public.platform_news_clubs
  add column if not exists target_roles text[] not null
  default array['player', 'coach', 'manager']::text[];

alter table public.platform_news_clubs
  drop constraint if exists platform_news_clubs_target_roles_check;
alter table public.platform_news_clubs
  add constraint platform_news_clubs_target_roles_check check (
    cardinality(target_roles) > 0
    and target_roles <@ array['player', 'coach', 'manager']::text[]
  );

create or replace function public.save_platform_news_v2(
  p_news_id uuid,
  p_actor_id uuid,
  p_status text,
  p_scheduled_for timestamptz,
  p_visible_on_home boolean,
  p_image_url text,
  p_targets jsonb,
  p_translations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_news_id uuid := p_news_id;
  v_target jsonb;
  v_club_id uuid;
  v_roles text[];
begin
  if not exists (select 1 from public.app_admins where user_id = p_actor_id) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  if p_status not in ('draft', 'scheduled', 'published', 'archived')
    or (p_status = 'scheduled' and p_scheduled_for is null)
  then raise exception using errcode = 'P0001', message = 'INVALID_STATUS'; end if;
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception using errcode = 'P0001', message = 'TARGET_REQUIRED';
  end if;
  if jsonb_typeof(p_translations) <> 'object'
    or btrim(coalesce(p_translations #>> '{fr,title}', '')) = ''
  then raise exception using errcode = 'P0001', message = 'FRENCH_TITLE_REQUIRED'; end if;

  -- Validate the complete matrix before changing an existing news item.
  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    begin
      v_club_id := (v_target ->> 'club_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'INVALID_CLUB';
    end;
    if not exists (select 1 from public.clubs where id = v_club_id) then
      raise exception using errcode = 'P0001', message = 'INVALID_CLUB';
    end if;
    if jsonb_typeof(v_target -> 'roles') <> 'array' then
      raise exception using errcode = 'P0001', message = 'INVALID_TARGET_ROLES';
    end if;
    select array_agg(distinct role_value.value order by role_value.value) into v_roles
    from jsonb_array_elements_text(v_target -> 'roles') role_value(value);
    if coalesce(cardinality(v_roles), 0) = 0
      or not (v_roles <@ array['player', 'coach', 'manager']::text[])
    then raise exception using errcode = 'P0001', message = 'INVALID_TARGET_ROLES'; end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_targets))
    <> (select count(distinct value ->> 'club_id') from jsonb_array_elements(p_targets))
  then raise exception using errcode = 'P0001', message = 'DUPLICATE_CLUB_TARGET'; end if;

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

  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    v_club_id := (v_target ->> 'club_id')::uuid;
    select array_agg(distinct role_value.value order by role_value.value) into v_roles
    from jsonb_array_elements_text(v_target -> 'roles') role_value(value);
    insert into public.platform_news_clubs (news_id, club_id, target_roles)
    values (v_news_id, v_club_id, v_roles);
  end loop;

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

revoke all on function public.save_platform_news_v2(uuid, uuid, text, timestamptz, boolean, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_platform_news_v2(uuid, uuid, text, timestamptz, boolean, text, jsonb, jsonb) to service_role;
