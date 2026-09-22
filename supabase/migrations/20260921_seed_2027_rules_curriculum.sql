-- Editorial skeleton for the complete 72-card curriculum. It is deliberately
-- non-publishable until every card and its original questions are reviewed.
-- Defensive hardening: these tables are created and protected by the core
-- migration, but explicitly enabling RLS here also makes a partial/manual
-- migration fail closed rather than exposing seeded rows through PostgREST.
alter table public.rules_seasons enable row level security;
alter table public.rules_series enable row level security;
alter table public.rules_cards enable row level security;
alter table public.rules_card_versions enable row level security;
alter table public.rules_series_cards enable row level security;

insert into public.rules_seasons(slug,title_i18n,status,reference_version)
values('junior-rules-2027','{"fr":"Saison des règles 2027","en":"2027 Rules season"}','draft','R&A Rules of Golf 2023 + Additional Clarifications 2026-07-01')
on conflict(slug) do update set reference_version=excluded.reference_version;

with themes(position,fr,en) as (values
 (1,'Les bases du jeu','The basics'),(2,'La zone de départ','The teeing area'),(3,'Balle déplacée ou déviée','Ball moved or deflected'),
 (4,'Les dégagements gratuits','Free relief'),(5,'Les zones à pénalité','Penalty areas'),(6,'Balle perdue, hors limites et provisoire','Lost, out of bounds and provisional ball'),
 (7,'Le bunker','The bunker'),(8,'Le green','The putting green'),(9,'Balle injouable et procédure de drop','Unplayable ball and dropping'),
 (10,'Matériel, aide et conseil','Equipment, help and advice'),(11,'Compétition et carte de score','Competition and scorecard'),(12,'Esprit du jeu et formes de jeu','Spirit and forms of play')
), season as (select id from public.rules_seasons where slug='junior-rules-2027')
insert into public.rules_series(season_id,position,title_i18n,discovery_starts_at,quiz_opens_at,quiz_closes_at,results_published_at,status)
select season.id,t.position,jsonb_build_object('fr',t.fr,'en',t.en),
 make_timestamptz(2027,t.position,1,0,0,0,'Europe/Zurich'), make_timestamptz(2027,t.position,22,0,0,0,'Europe/Zurich'),
 make_timestamptz(2027,t.position,least(29,extract(day from (date_trunc('month',make_date(2027,t.position,1))+interval '1 month - 1 day'))::int),0,0,0,'Europe/Zurich'),
 make_timestamptz(2027,t.position,least(29,extract(day from (date_trunc('month',make_date(2027,t.position,1))+interval '1 month - 1 day'))::int),0,0,0,'Europe/Zurich'),'draft'
from themes t cross join season
on conflict(season_id,position) do update set title_i18n=excluded.title_i18n;

do $$
declare
  v_n integer;
  v_title text;
  v_ref text;
  v_card_id uuid;
  v_version_id uuid;
  v_series_id uuid;
begin
for v_n, v_title, v_ref in
select * from (values
(1,'Jouer la balle comme elle repose','Règle 9.1'),(2,'Reconnaître les cinq zones du parcours','Définitions; Règle 2.2'),(3,'Nombre maximum de clubs autorisés','Règle 4.1b'),(4,'Identifier correctement sa balle','Règle 7.2'),(5,'Durée maximale de recherche d’une balle','Définition Balle perdue; Règle 18.2a'),(6,'Balle déplacée accidentellement pendant la recherche','Règle 7.4'),
(7,'Reconnaître les limites de la zone de départ','Définition Zone de départ; Règle 6.2b'),(8,'Balle placée devant les marques','Règle 6.1b'),(9,'Possibilité de jouer directement depuis le sol','Règle 6.2b(2)'),(10,'Balle tombant du tee avant le coup','Règle 6.2b(5)'),(11,'Ordre de jeu en stroke play et Ready Golf','Règle 6.4b'),(12,'Jouer une balle provisoire depuis le départ','Règle 18.3'),
(13,'Balle déplacée accidentellement par le joueur','Règle 9.4'),(14,'Balle déplacée par un autre joueur','Règle 9.5'),(15,'Balle déplacée par un animal','Règle 9.6'),(16,'Balle déplacée naturellement par le vent','Règle 9.3'),(17,'Balle en mouvement touchant le joueur ou son matériel','Règle 11.1'),(18,'Balle déviée accidentellement par une autre balle','Règle 11.1'),
(19,'Balle sur un chemin artificiel','Règle 16.1'),(20,'Eau temporaire autour de la balle','Règles 16.1 et 16.1e'),(21,'Terrain en réparation','Règle 16.1'),(22,'Trou ou monticule d’un animal','Règle 16.1'),(23,'Balle enfoncée dans son propre impact','Règle 16.3'),(24,'Déterminer le point le plus proche de dégagement complet','Définition Point le plus proche de dégagement complet'),
(25,'Reconnaître une zone jaune et une zone rouge','Définition Zone à pénalité; Règle 17'),(26,'Jouer une balle directement dans la zone','Règle 17.1b'),(27,'Déterminer le point d’entrée dans la zone','Règle 17.1d'),(28,'Options de dégagement d’une zone jaune','Règle 17.1d(1)-(2)'),(29,'Option latérale supplémentaire d’une zone rouge','Règle 17.1d(3)'),(30,'Déplacer un détritus dans une zone à pénalité','Règles 15.1 et 17.1b'),
(31,'Reconnaître qu’une balle est hors limites','Définition Hors limites'),(32,'Position des piquets blancs par rapport à la limite','Définition Hors limites'),(33,'Procédure coup et distance','Règle 18.1'),(34,'Moment où annoncer une balle provisoire','Règle 18.3b'),(35,'Quand la balle provisoire devient la balle en jeu','Règle 18.3c'),(36,'Retrouver la balle d’origine après avoir joué une provisoire','Règle 18.3c'),
(37,'Retirer des détritus dans un bunker','Règles 12.2a et 15.1'),(38,'Toucher accidentellement le sable','Règle 12.2b'),(39,'Tester volontairement l’état du sable','Règle 12.2b(1)'),(40,'Balle injouable dans un bunker','Règle 19.3a'),(41,'Sortir du bunker avec deux coups de pénalité','Règle 19.3b'),(42,'Eau temporaire dans un bunker','Règle 16.1c'),
(43,'Marquer la balle avant de la relever','Règle 14.1'),(44,'Nettoyer la balle sur le green','Règle 14.1c'),(45,'Réparer les dommages sur le green','Règle 13.1c'),(46,'Balle déplacée accidentellement sur le green','Règle 13.1d'),(47,'Balle replacée puis déplacée par le vent','Règle 13.1d(2)'),(48,'Balle frappant le drapeau laissé dans le trou','Règle 13.2a'),
(49,'Qui peut déclarer une balle injouable','Règle 19.1'),(50,'Dégagement coup et distance','Règle 19.2a'),(51,'Dégagement en arrière sur la ligne','Règle 19.2b'),(52,'Dégagement latéral à deux longueurs de club','Règle 19.2c'),(53,'Lâcher la balle à hauteur du genou','Règle 14.3b'),(54,'Balle roulant hors de la zone de dégagement','Règle 14.3c'),
(55,'Dépasser la limite de 14 clubs','Règle 4.1b'),(56,'Club endommagé pendant le tour','Règle 4.1a(2); règles locales éventuelles'),(57,'Utiliser un appareil de mesure de distance','Règle 4.3a(1)'),(58,'Demander un conseil à un autre joueur','Règle 10.2a'),(59,'Indiquer une ligne de jeu','Règle 10.2b'),(60,'Position du cadet pendant la préparation du coup','Règle 10.2b(4)'),
(61,'Responsabilité du joueur concernant son score','Règle 3.3b'),(62,'Score inscrit trop élevé sur un trou','Règle 3.3b(3)'),(63,'Score inscrit trop bas sur un trou','Règle 3.3b(3)'),(64,'Obligation de terminer le trou en stroke play','Règle 3.3c'),(65,'Concession d’un coup ou d’un trou en match play','Règle 3.2b'),(66,'Commencer son tour à l’heure','Règle 5.3a'),
(67,'Jouer à une cadence raisonnable','Règle 5.6b'),(68,'Assurer la sécurité avant de jouer','Règle 1.2a'),(69,'Prendre soin du parcours','Règle 1.2a'),(70,'Alternance des coups en foursome','Règle 22.3'),(71,'Fonctionnement du quatre balles','Règle 23'),(72,'Respecter une règle locale publiée par le club','Règle 1.3a; Procédures du Comité, règles locales')
) as seed(n,title,official_reference)
loop
  insert into public.rules_cards(
    stable_key,
    difficulty,
    recommended_age_min,
    recommended_age_max,
    editorial_status
  ) values (
    'junior-rule-' || lpad(v_n::text,2,'0'),
    case when v_n <= 24 then 'beginner' when v_n <= 54 then 'intermediate' else 'advanced' end,
    8,
    18,
    'needs_review'
  )
  on conflict(stable_key) do update set
    difficulty = excluded.difficulty,
    recommended_age_min = excluded.recommended_age_min,
    recommended_age_max = excluded.recommended_age_max
  returning id into v_card_id;

  insert into public.rules_card_versions(
    card_id,
    version,
    locale,
    title,
    situation,
    simple_explanation,
    action_text,
    common_mistake,
    coach_tip,
    official_reference,
    reference_version,
    illustration_prompt,
    image_alt,
    image_status,
    human_review_required
  ) values (
    v_card_id,
    1,
    'fr',
    v_title,
    'Une situation de jeu junior doit illustrer clairement : ' || lower(v_title) || '.',
    'Contenu éditorial initial à compléter et valider par un arbitre avant publication.',
    'Je m’arrête, j’identifie la zone et je vérifie la procédure avant de jouer.',
    'Appliquer une procédure mémorisée sans vérifier les faits précis de la situation.',
    'Faire rejouer la situation sur le terrain et demander au joueur d’expliquer chaque étape.',
    v_ref,
    'R&A Rules of Golf 2023 + Additional Clarifications 2026-07-01',
    'Illustration ActiviTee originale, vue claire du parcours, jeune golfeur en sécurité, sans texte ni logo tiers : ' || lower(v_title) || '.',
    'Illustration pédagogique de la situation « ' || v_title || ' ».',
    'pending',
    true
  )
  on conflict(card_id,version,locale) do update set
    title = excluded.title,
    official_reference = excluded.official_reference,
    reference_version = excluded.reference_version
  returning id into v_version_id;

  select series.id into v_series_id
  from public.rules_series series
  join public.rules_seasons season on season.id = series.season_id
  where season.slug = 'junior-rules-2027'
    and series.position = ((v_n - 1) / 6) + 1;

  insert into public.rules_series_cards(series_id,card_version_id,position)
  values(v_series_id,v_version_id,((v_n - 1) % 6) + 1)
  on conflict(series_id,position) do update set card_version_id = excluded.card_version_id;
end loop;
end;
$$;
