-- Independent editorial workflow. Existing Rules tables and quiz functions are untouched.
create table if not exists public.etiquette_themes (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  position smallint not null unique check (position between 1 and 12),
  title_i18n jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz
);

create table if not exists public.etiquette_cards (
  id uuid primary key default gen_random_uuid(),
  theme_id uuid not null references public.etiquette_themes(id) on delete restrict,
  stable_key text not null unique,
  position smallint not null check (position between 1 and 3),
  published_version_id uuid,
  unique(theme_id, position)
);

create table if not exists public.etiquette_card_versions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.etiquette_cards(id) on delete restrict,
  version integer not null check (version > 0),
  locale text not null default 'fr',
  title text not null default '',
  situation text not null default '',
  simple_explanation text not null default '',
  action_text text not null default '',
  common_mistake text not null default '',
  mission_text text not null default '',
  coach_tip text not null default '',
  official_reference text not null default '',
  reference_version text not null default '',
  reference_kind text not null default 'good_practice' check (reference_kind in ('rule','code','club_guidance','good_practice')),
  image_url text,
  image_alt text not null default '',
  editorial_status text not null default 'needs_review' check (editorial_status in ('draft','needs_review','approved')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(card_id, version, locale)
);

alter table public.etiquette_cards add constraint etiquette_cards_published_version_fk
  foreign key (published_version_id) references public.etiquette_card_versions(id) on delete restrict;

create index if not exists etiquette_versions_card_idx on public.etiquette_card_versions(card_id, locale, version desc);

alter table public.etiquette_themes enable row level security;
alter table public.etiquette_cards enable row level security;
alter table public.etiquette_card_versions enable row level security;

create policy etiquette_themes_read on public.etiquette_themes for select to authenticated
  using (status='published' or public.is_app_admin(auth.uid()));
create policy etiquette_cards_read on public.etiquette_cards for select to authenticated
  using (public.is_app_admin(auth.uid()) or exists (
    select 1 from public.etiquette_themes t where t.id=theme_id and t.status='published'));

-- A translation is readable only after approval and only for the currently
-- published French version. This helper avoids a recursive versions RLS check.
create or replace function public.etiquette_is_public_version(p_version_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.etiquette_card_versions v
    join public.etiquette_cards c on c.id=v.card_id
    join public.etiquette_themes t on t.id=c.theme_id
    join public.etiquette_card_versions source on source.id=c.published_version_id
    where v.id=p_version_id and t.status='published'
      and source.editorial_status='approved' and source.approved_at is not null
      and (v.id=c.published_version_id or (
        v.locale in ('en','de','it') and v.version=source.version
        and v.editorial_status='approved' and v.approved_at is not null))
  );
$$;
revoke all on function public.etiquette_is_public_version(uuid) from public, anon;
grant execute on function public.etiquette_is_public_version(uuid) to authenticated;

create policy etiquette_versions_read on public.etiquette_card_versions for select to authenticated
  using (public.is_app_admin(auth.uid()) or public.etiquette_is_public_version(id));
revoke all on public.etiquette_themes, public.etiquette_cards, public.etiquette_card_versions from anon;
grant select on public.etiquette_themes, public.etiquette_cards, public.etiquette_card_versions to authenticated;

create or replace function public.etiquette_publish_theme(p_theme_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  if not public.is_app_admin(auth.uid()) then raise exception 'Forbidden'; end if;
  perform 1 from etiquette_cards where theme_id=p_theme_id for update;
  select count(*) into v_count from etiquette_cards c
    join etiquette_card_versions v on v.card_id=c.id
    where c.theme_id=p_theme_id and v.locale='fr' and v.editorial_status='approved'
      and v.approved_at is not null and v.id=(
        select newest.id from etiquette_card_versions newest where newest.card_id=c.id and newest.locale='fr'
        order by newest.version desc limit 1)
      and nullif(trim(v.title),'') is not null and nullif(trim(v.situation),'') is not null
      and nullif(trim(v.simple_explanation),'') is not null and nullif(trim(v.action_text),'') is not null
      and nullif(trim(v.common_mistake),'') is not null and nullif(trim(v.mission_text),'') is not null
      and nullif(trim(v.coach_tip),'') is not null and nullif(trim(v.official_reference),'') is not null
      and nullif(trim(v.reference_version),'') is not null;
  if v_count<>3 then raise exception 'Three complete, approved cards are required'; end if;
  update etiquette_cards c set published_version_id=(
    select v.id from etiquette_card_versions v where v.card_id=c.id and v.locale='fr'
    order by v.version desc limit 1) where c.theme_id=p_theme_id;
  update etiquette_themes set status='published', published_at=now() where id=p_theme_id;
end $$;
revoke all on function public.etiquette_publish_theme(uuid) from public, anon;
grant execute on function public.etiquette_publish_theme(uuid) to authenticated;
