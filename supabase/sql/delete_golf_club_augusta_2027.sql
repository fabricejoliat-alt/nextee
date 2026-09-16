-- Suppression contrôlée des saisons 2027 de Golf Club Augusta.
--
-- Le script est volontairement terminé par ROLLBACK : il affiche d'abord les
-- saisons concernées et simule la suppression. Après vérification, remplacez
-- uniquement le ROLLBACK final par COMMIT pour rendre la suppression définitive.
--
-- La suppression d'une saison entraîne les enregistrements saisonniers et les
-- groupes qui lui sont rattachés, conformément aux clés étrangères en cascade.

begin;

do $$
declare
  matching_clubs integer;
  matching_seasons integer;
begin
  select count(*)
    into matching_clubs
  from public.clubs
  where lower(trim(name)) = lower('Golf Club Augusta');

  if matching_clubs <> 1 then
    raise exception
      'Suppression annulée : % clubs correspondent à "Golf Club Augusta" (1 attendu).',
      matching_clubs;
  end if;

  select count(*)
    into matching_seasons
  from public.club_seasons seasons
  join public.clubs clubs on clubs.id = seasons.club_id
  where lower(trim(clubs.name)) = lower('Golf Club Augusta')
    and (
      seasons.name ilike '%2027%'
      or seasons.starts_on between date '2027-01-01' and date '2027-12-31'
    );

  if matching_seasons = 0 then
    raise exception
      'Suppression annulée : aucune saison 2027 trouvée pour Golf Club Augusta.';
  end if;
end
$$;

-- Vérifiez attentivement cette liste avant de rendre la suppression définitive.
select
  seasons.id,
  seasons.name,
  seasons.starts_on,
  seasons.ends_on,
  seasons.is_current
from public.club_seasons seasons
join public.clubs clubs on clubs.id = seasons.club_id
where lower(trim(clubs.name)) = lower('Golf Club Augusta')
  and (
    seasons.name ilike '%2027%'
    or seasons.starts_on between date '2027-01-01' and date '2027-12-31'
  )
order by seasons.starts_on, seasons.name;

-- Suppression simulée : les lignes retournées doivent correspondre à la liste
-- ci-dessus. Les relations dépendantes sont supprimées par cascade.
delete from public.club_seasons seasons
using public.clubs clubs
where clubs.id = seasons.club_id
  and lower(trim(clubs.name)) = lower('Golf Club Augusta')
  and (
    seasons.name ilike '%2027%'
    or seasons.starts_on between date '2027-01-01' and date '2027-12-31'
  )
returning seasons.id, seasons.name, seasons.starts_on, seasons.ends_on;

rollback;
-- Pour appliquer réellement la suppression après contrôle, remplacez la ligne
-- ROLLBACK ci-dessus par : commit;
