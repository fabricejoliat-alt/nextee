-- Read-only checks to run in the target environment after applying both migrations.
with theme_counts as (
  select t.id, t.stable_key, t.position, t.status, count(distinct c.id) as cards,
    count(v.id) filter (where v.locale='fr' and v.version=1) as french_versions,
    count(v.id) filter (where v.locale='fr' and v.version=1 and
      nullif(trim(v.title),'') is not null and nullif(trim(v.situation),'') is not null and
      nullif(trim(v.simple_explanation),'') is not null and nullif(trim(v.action_text),'') is not null and
      nullif(trim(v.common_mistake),'') is not null and nullif(trim(v.mission_text),'') is not null and
      nullif(trim(v.coach_tip),'') is not null and nullif(trim(v.official_reference),'') is not null and
      nullif(trim(v.reference_version),'') is not null) as complete_french_versions
  from public.etiquette_themes t
  left join public.etiquette_cards c on c.theme_id=t.id
  left join public.etiquette_card_versions v on v.card_id=c.id
  group by t.id
)
select stable_key, position, status, cards, french_versions, complete_french_versions,
  (cards=3 and french_versions=3 and complete_french_versions=3) as ok
from theme_counts order by position;

select count(*) as themes, count(*) filter (where status='published') as published_themes
from public.etiquette_themes;
select count(*) as cards, count(*) filter (where published_version_id is not null) as published_cards
from public.etiquette_cards;
select count(*) as french_versions, count(*) filter (where approved_at is not null) as approved_versions
from public.etiquette_card_versions where locale='fr';

select relname, relrowsecurity from pg_class
where relname in ('etiquette_themes','etiquette_cards','etiquette_card_versions') order by relname;
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('etiquette_themes','etiquette_cards','etiquette_card_versions')
  and grantee in ('anon','authenticated') order by table_name, grantee, privilege_type;
