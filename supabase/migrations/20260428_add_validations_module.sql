create table if not exists public.validation_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.validation_exercises (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.validation_sections(id) on delete cascade,
  external_code text,
  sequence_no integer not null,
  level integer,
  name text not null,
  objective text,
  short_description text,
  detailed_description text,
  equipment text,
  validation_rule_text text,
  illustration_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint validation_exercises_sequence_positive check (sequence_no > 0),
  constraint validation_exercises_unique_section_sequence unique (section_id, sequence_no)
);

create table if not exists public.player_validation_attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id uuid not null references public.validation_exercises(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  result text not null,
  created_by_user_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  constraint player_validation_attempts_result_check check (result in ('success', 'failure'))
);

create index if not exists idx_validation_sections_sort_order
  on public.validation_sections (sort_order);

create index if not exists idx_validation_exercises_section_sequence
  on public.validation_exercises (section_id, sequence_no);

create index if not exists idx_player_validation_attempts_player_exercise_attempted
  on public.player_validation_attempts (player_id, exercise_id, attempted_at desc);

create index if not exists idx_player_validation_attempts_exercise_attempted
  on public.player_validation_attempts (exercise_id, attempted_at desc);

drop trigger if exists trg_validation_sections_updated_at on public.validation_sections;
create trigger trg_validation_sections_updated_at
before update on public.validation_sections
for each row execute function public.set_timestamp_updated_at();

drop trigger if exists trg_validation_exercises_updated_at on public.validation_exercises;
create trigger trg_validation_exercises_updated_at
before update on public.validation_exercises
for each row execute function public.set_timestamp_updated_at();

insert into public.validation_sections (slug, name, sort_order, is_active)
values
  ('putting', 'Putting', 1, true),
  ('petit_jeu', 'Petit jeu', 2, true),
  ('scrambling', 'Scrambling', 3, true),
  ('wedging', 'Wedging', 4, true)
on conflict (slug) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

with seeded(section_slug, external_code, sequence_no, level, name, objective, short_description, detailed_description, equipment, validation_rule_text) as (
  values
  ('putting', '1', 1, 1, 'Putt court progressif 1-1.30m', 'Régularité putts courts', '3 distances progressives', 'Placez 3 tees à 1 m, 1,20 m et 1,30 m du trou. Enchaînez les putts dans l’ordre avec une routine constante et sans interruption.', '3 balles', 'Rentrer 18 putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('putting', '2', 2, 1, 'Cercle 1m (6 positions)', 'Solidité courte distance', '6 putts autour du trou', 'Placez 6 balles en cercle à 1 m du trou. Réalisez 3 tours complets sans rater en gardant la même routine.', '6 balles', 'Rentrer 18 putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('putting', '3', 3, 2, 'Putt court étendu 1.5-2.5m', 'Précision distances courtes', '3 distances intermédiaires', 'Placez 3 tees à 1,50 m, 2 m et 2,50 m du trou. Enchaînez les putts sans erreur en augmentant la distance.', '3 balles', 'Rentrer 9 putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('putting', '4', 4, 2, 'Cercle 2m (9 positions)', 'Performance à 2m', '9 putts cercle', 'Placez 9 balles en cercle à 2 m du trou et réalisez tous les putts sans interruption.', '9 balles', 'Rentrer 9 putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('putting', '5', 5, 2, 'Mix 1m / 2m', 'Adaptation distance', 'Alternance distances', 'Placez 4 balles à 1 m et 4 à 2 m autour du trou. Alternez chaque putt.', '8 balles', 'Rentrer 8 putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('putting', '6', 6, 3, 'Putt court & moyen 1-4m', 'Progression distance', '4 distances', 'Placez 4 tees à 1 m, 2 m, 3 m et 4 m du trou. Enchaînez les putts dans l’ordre.', '4 balles', 'Rentrer 4 putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('putting', '7', 7, 3, 'Intermédiaire 1 position', 'Dosage long', '5-10m', 'Placez un tee entre 5 et 10 m du trou. Chaque putt doit dépasser légèrement le trou et être terminé en 2 putts maximum.', '1 balle', '18 séquences de 2 putts consécutives. Si 3 putts ou putt court, recommencer à 0.'),
  ('putting', '8', 8, 3, 'Intermédiaire 3 distances', 'Gestion distances', '5m 7m 9m', 'Placez 3 tees à 5 m, 7 m et 9 m du trou. Enchaînez les distances avec objectif 2 putts maximum.', '1 balle', '18 séquences de 2 putts consécutives. Si erreur, recommencer à 0.'),
  ('putting', '9', 9, 4, 'Long 1 position', 'Contrôle longs putts', '10-20m', 'Placez un tee entre 10 et 20 m du trou. Travaillez le dosage pour éviter les 3 putts.', '1 balle', '18 séquences de 2 putts consécutives. Si 3 putts, recommencer à 0.'),
  ('putting', '10', 10, 4, 'Long 3 distances', 'Régularité longues distances', '10m 15m 20m', 'Placez 3 tees à 10 m, 15 m et 20 m du trou et enchaînez avec 2 putts maximum.', '1 balle', '18 séquences de 2 putts consécutives. Si 3 putts, recommencer à 0.'),
  ('putting', '11', 11, 4, 'Putting pression mix distances 1m-3m-5m', 'Enchaînement sous pression', '3 distances progressives', 'Placez 3 tees à 1 m, 3 m et 5 m du trou. Commencez à 1 m, puis enchaînez à 3 m et 5 m. Le putt à 1 m doit être rentré, celui à 3 m en 2 putts max, et celui à 5 m en 2 putts max. Chaque série doit être réussie sans erreur.', '1 balle', '18 séquences consécutives (1m + 3m + 5m). Si erreur, recommencer à 0.'),
  ('putting', '12', 12, 4, 'Cercle 2m avec sortie obligatoire', 'Solidité sous contrainte', 'Cercle avec pénalité', 'Placez 9 balles en cercle à 2 m autour du trou. Vous devez rentrer tous les putts. En cas d’erreur, sortez du cercle, réussissez un putt à 3 m, puis recommencez depuis le début.', '9 balles', 'Rentrer 9 putts consécutifs. En cas d’erreur, sortie obligatoire puis recommencer à 0.'),
  ('putting', '13', 13, 5, 'Long putt + finition 10m-1.5m', 'Simulation parcours', 'Long + finition', 'Placez un tee à 10 m du trou. Jouez un premier putt pour approcher, puis placez une balle à 1,5 m pour simuler la finition. Vous devez rentrer le putt de 1,5 m. Chaque séquence simule un trou.', '2 balles', '18 séquences consécutives (2 putts max + finition réussie). Si erreur, recommencer à 0.'),
  ('putting', '14', 14, 5, 'Long 3 distances avec dépassement', 'Dosage agressif', '10m 15m 20m', 'Placez 3 tees à 10 m, 15 m et 20 m du trou. Le premier putt doit dépasser le trou à chaque distance, puis le second doit être rentré. Si le premier putt est court ou si vous faites 3 putts, la série est perdue.', '1 balle', '18 séquences consécutives. Si putt court ou 3 putts, recommencer à 0.'),
  ('putting', '15', 15, 5, 'Elite 10/10 à 2m', 'Performance maximale', '10 putts consécutifs', 'Placez 10 balles à 2 m autour du trou avec angles variés. Vous devez rentrer les 10 putts consécutivement avec une routine complète.', '10 balles', '10/10 consécutifs. En cas d’erreur, recommencer à 0.'),
  ('petit_jeu', '1', 1, 1, 'Chip court fairway 7-15m', 'Contrôle distance chip court', '10 m - zone 1 m', 'Placez-vous entre 7 et 15 m du trou depuis le fairway. Jouez 10 balles en visant un point de chute précis et en contrôlant le roulement pour finir proche du trou. Travaillez la qualité de contact et la régularité.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '2', 2, 1, 'Chip long fairway 15-25m', 'Contrôle distance chip long', '20 m - zone 1 m', 'Placez-vous entre 15 et 25 m du trou depuis le fairway. Jouez 10 balles en adaptant l’amplitude du geste pour contrôler la distance et viser une zone proche du trou.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '3', 3, 2, 'Chip court rough 7-15m', 'Gestion lies rough court', '10 m - zone 1 m', 'Placez-vous entre 7 et 15 m du trou dans le rough. Jouez 10 balles en adaptant votre contact pour sortir proprement la balle et contrôler la distance.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '4', 4, 2, 'Chip long rough 15-25m', 'Gestion lies rough long', '20 m - zone 1 m', 'Placez-vous entre 15 et 25 m dans le rough. Jouez 10 balles en contrôlant la sortie de balle et le dosage pour approcher le trou.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '5', 5, 3, 'Lob court fairway 7-15m', 'Maîtrise trajectoire haute', '10 m - zone 1 m', 'Placez-vous entre 7 et 15 m sur fairway. Réalisez 10 lobs en contrôlant la hauteur et la distance pour arrêter la balle rapidement près du trou.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '6', 6, 3, 'Lob court rough 7-15m', 'Gestion lob rough', '10 m - zone 1 m', 'Depuis le rough entre 7 et 15 m, jouez 10 lobs en contrôlant le contact et la sortie de balle pour obtenir un arrêt rapide.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '7', 7, 4, 'Lob long fairway 15-25m', 'Précision lob long', '20 m - zone 1.5 m', 'Depuis le fairway entre 15 et 25 m, réalisez 10 lobs en contrôlant la trajectoire et la distance pour viser une zone proche du trou.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1.5 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '8', 8, 4, 'Lob long rough 15-25m', 'Contrôle lob rough long', '20 m - zone 1.5 m', 'Depuis le rough entre 15 et 25 m, jouez 10 lobs en adaptant votre geste pour sortir la balle et contrôler la distance.', '10 balles', 'Obtenir 10 points en 10 balles. Balle <1.5 m = 1 pt ; trou = 2 pts.'),
  ('petit_jeu', '9', 9, 4, 'Bunker court 7-15m', 'Sortie bunker précision', '8 m - zones 1m/2m', 'Depuis un bunker à 7-15 m, jouez 10 balles en contrôlant la sortie et la distance pour viser le trou.', '10 balles', 'Hors 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts. Obtenir 10 points.'),
  ('petit_jeu', '10', 10, 5, 'Bunker long 15-25m', 'Sortie bunker longue', '20 m - zones 1m/2m', 'Depuis un bunker entre 15 et 25 m, jouez 10 balles en maîtrisant le dosage pour rapprocher la balle du trou.', '10 balles', 'Hors 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts. Obtenir 10 points.'),
  ('petit_jeu', '11', 11, 5, 'Chip précision 3 zones 10-20m', 'Contrôle distance avancé', '3 zones de précision', 'Placez-vous entre 10 et 20 m. Définissez 3 zones autour du trou (1 m, 2 m, 3 m). Jouez 10 balles en visant la zone la plus proche.', '10 balles', '<1 m = 3 pts ; <2 m = 2 pts ; <3 m = 1 pt. Objectif ≥15 pts.'),
  ('petit_jeu', '12', 12, 5, 'Chip pression 10/10 15m', 'Performance sous pression', '10 chips consécutifs', 'Depuis 15 m fairway, placez 10 balles et tentez de toutes les rapprocher à moins de 1,5 m sans échec.', '10 balles', '10/10 balles à <1.5 m. Sinon recommencer à 0.'),
  ('petit_jeu', '13', 13, 5, 'Lob précision haute 20m', 'Maîtrise trajectoire', 'Lob longue distance', 'Depuis 20 m, jouez 10 lobs en cherchant à faire arrêter la balle rapidement dans une zone de 2 m.', '10 balles', '<1 m = 2 pts ; <2 m = 1 pt ; objectif ≥12 pts.'),
  ('petit_jeu', '14', 14, 5, 'Bunker pression 5/5', 'Sortie bunker sous pression', '5 sorties consécutives', 'Depuis bunker à 10-15 m, placez 5 balles et devez toutes les sortir à moins de 2 m du trou.', '5 balles', '5/5 réussies (<2 m). Sinon recommencer à 0.'),
  ('petit_jeu', '15', 15, 5, 'Up & Down élite', 'Simulation parcours', 'Chip + putt', 'Depuis différentes positions autour du green, réalisez un chip puis rentrez le putt suivant. 10 situations différentes.', '1 balle', '10 up & down consécutifs. Sinon recommencer à 0.'),
  ('scrambling', '1', 1, 1, 'Chip/Putt court fairway 7-15m', 'Enchaînement approche + putt', 'Approche + putt fairway', 'Placez une balle entre 7 et 15 m du trou sur fairway. Réalisez une approche suivie d’un putt. Répétez en cherchant à enchaîner sans erreur.', '1 balle', 'Réaliser 18 approches + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '2', 2, 1, 'Chip/Putt court rough 7-15m', 'Gestion rough + finition', 'Approche + putt rough', 'Droppez une balle entre 7 et 15 m dans le rough. Réalisez une approche puis un putt en cherchant la régularité.', '1 balle', 'Réaliser 18 approches + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '3', 3, 2, 'Chip/Putt long fairway 15-25m', 'Contrôle distance + finition', 'Approche longue + putt', 'Placez une balle entre 15 et 25 m sur fairway. Réalisez une approche longue puis terminez avec un putt.', '1 balle', 'Réaliser 18 approches + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '4', 4, 2, 'Chip/Putt long rough 15-25m', 'Gestion rough long', 'Approche rough + putt', 'Droppez une balle entre 15 et 25 m dans le rough. Travaillez la sortie de balle puis le putt.', '1 balle', 'Réaliser 18 approches + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '5', 5, 3, 'Lob/Putt court fairway 7-15m', 'Trajectoire haute + finition', 'Lob + putt avec obstacle', 'Placez une balle entre 7 et 15 m sur fairway avec un obstacle. Réalisez un lob puis un putt.', '1 balle', 'Réaliser 9 lob + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '6', 6, 3, 'Lob/Putt court rough 7-15m', 'Gestion obstacle rough', 'Lob rough + putt', 'Droppez une balle entre 7 et 15 m dans le rough avec obstacle. Réalisez un lob puis un putt.', '1 balle', 'Réaliser 9 lob + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '7', 7, 4, 'Lob/Putt long fairway 15-25m', 'Contrôle lob long', 'Lob long + putt', 'Placez une balle entre 15 et 25 m sur fairway avec obstacle. Réalisez un lob puis un putt.', '1 balle', 'Réaliser 9 lob + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '8', 8, 4, 'Lob/Putt long rough 15-25m', 'Gestion rough + hauteur', 'Lob rough long + putt', 'Droppez une balle entre 15 et 25 m dans le rough avec obstacle. Réalisez un lob puis un putt.', '1 balle', 'Réaliser 9 lob + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '9', 9, 4, 'Bunker/Putt court 7-15m', 'Sortie bunker + finition', 'Bunker + putt court', 'Placez une balle dans un bunker entre 7 et 15 m. Réalisez une sortie de bunker puis un putt.', '1 balle', 'Réaliser 9 bunker + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '10', 10, 5, 'Bunker/Putt long 15-25m', 'Sortie bunker longue + finition', 'Bunker long + putt', 'Placez une balle dans un bunker entre 15 et 25 m. Réalisez une sortie puis un putt.', '1 balle', 'Réaliser 9 bunker + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '11', 11, 5, 'Up & Down élite 10 positions', 'Performance parcours', '10 situations différentes', 'Placez 10 balles autour du green dans des lies variés (fairway, rough, bunker). Pour chaque balle, réalisez une approche puis rentrez le putt.', '1 balle', '10 up & down consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '12', 12, 5, 'Scrambling pression mix lies', 'Adaptation totale', 'Fairway + rough + bunker', 'Alternez 3 situations : fairway, rough et bunker entre 10 et 20 m. Enchaînez approche + putt sur chaque situation.', '1 balle', '18 séquences consécutives. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '13', 13, 5, 'Lob + putt précision 15m', 'Contrôle lob + finition', 'Obstacle + finition', 'Placez une balle à 15 m avec obstacle. Réalisez un lob pour passer l’obstacle puis rentrez le putt.', '1 balle', '9 lob + putts consécutifs. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '14', 14, 5, 'Bunker + putt pression 5/5', 'Sortie bunker sous pression', '5 situations bunker', 'Placez 5 balles dans bunker à distances variées. Réalisez sortie + putt sur chaque balle.', '5 balles', '5/5 réussies. En cas d’erreur, recommencer à 0.'),
  ('scrambling', '15', 15, 5, 'Scrambling parcours simulation', 'Simulation réelle', 'Situations aléatoires', 'Choisissez 10 positions aléatoires autour du green. Pour chaque balle, réalisez approche + putt comme en parcours.', '1 balle', '10 réussites consécutives. En cas d’erreur, recommencer à 0.'),
  ('wedging', '1', 1, 1, 'Pitching 25m', 'Contrôle distance courte', '25 m - zone 2 m', 'Placez-vous à 25 m du trou. Jouez 10 balles en contrôlant la distance et la trajectoire pour approcher au plus près du drapeau.', '10 balles', 'Obtenir 10 points. Hors zone 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts.'),
  ('wedging', '2', 2, 1, 'Pitching 35m', 'Régularité distance', '35 m - zone 2 m', 'Placez-vous à 35 m du trou. Réalisez 10 coups en contrôlant la longueur de swing et le dosage.', '10 balles', 'Obtenir 10 points. Hors zone 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts.'),
  ('wedging', '3', 3, 2, 'Pitching 45m', 'Précision distance', '45 m - zone 2 m', 'Placez-vous à 45 m. Travaillez la précision et la répétabilité du geste sur 10 balles.', '10 balles', 'Obtenir 10 points. Hors zone 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts.'),
  ('wedging', '4', 4, 2, 'Wedging 55m', 'Contrôle intermédiaire', '55 m - zone 2 m', 'Depuis 55 m, jouez 10 balles en adaptant votre amplitude pour contrôler la distance.', '10 balles', 'Obtenir 10 points. Hors zone 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts.'),
  ('wedging', '5', 5, 3, 'Wedging 65m', 'Gestion distance moyenne', '65 m - zone 2 m', 'Depuis 65 m, travaillez le contrôle de distance et la précision avec 10 balles.', '10 balles', 'Obtenir 10 points. Hors zone 2 m = 0 pt ; 1-2 m = 1 pt ; <1 m = 2 pts ; trou = 3 pts.'),
  ('wedging', '6', 6, 3, 'Wedging 75m', 'Précision avancée', '75 m - zones 1-3 m', 'Depuis 75 m, jouez 10 balles en visant différentes zones de précision autour du trou.', '10 balles', 'Obtenir 10 points. Hors 3 m = 0 pt ; 2-3 m = 1 pt ; 1-2 m = 2 pts ; <1 m = 3 pts ; trou = 4 pts.'),
  ('wedging', '7', 7, 4, 'Wedging 85m', 'Contrôle longue distance', '85 m - zones 1-3 m', 'Depuis 85 m, travaillez le dosage et la trajectoire pour approcher le drapeau.', '10 balles', 'Obtenir 10 points. Hors 3 m = 0 pt ; 2-3 m = 1 pt ; 1-2 m = 2 pts ; <1 m = 3 pts ; trou = 4 pts.'),
  ('wedging', '8', 8, 4, 'Wedging 95m', 'Précision longue distance', '95 m - zones 1-3 m', 'Depuis 95 m, réalisez 10 coups en cherchant la précision maximale autour du trou.', '10 balles', 'Obtenir 10 points. Hors 3 m = 0 pt ; 2-3 m = 1 pt ; 1-2 m = 2 pts ; <1 m = 3 pts ; trou = 4 pts.'),
  ('wedging', '9', 9, 3, 'Wedging précision 40m zones', 'Contrôle distance', '40 m - zones multiples', 'Depuis 40 m, définissez 3 zones autour du trou (1 m, 2 m, 3 m). Jouez 10 balles en visant la zone la plus proche.', '10 balles', '<1 m = 3 pts ; 1-2 m = 2 pts ; 2-3 m = 1 pt ; objectif ≥15 pts.'),
  ('wedging', '10', 10, 4, 'Wedging 60m pression 10/10', 'Performance sous pression', '60 m précision', 'Depuis 60 m, jouez 10 balles et tentez de toutes les placer à moins de 2 m du trou.', '10 balles', '10/10 balles à <2 m. Sinon recommencer à 0.'),
  ('wedging', '11', 11, 4, 'Wedging 70m cible réduite', 'Précision avancée', '70 m - zone 1.5 m', 'Depuis 70 m, réduisez la zone cible à 1,5 m et jouez 10 balles en visant cette zone.', '10 balles', '<1.5 m = 2 pts ; <3 m = 1 pt ; objectif ≥14 pts.'),
  ('wedging', '12', 12, 4, 'Wedging 80m enchaînement distances', 'Adaptation', '70-80-90 m', 'Enchaînez 3 distances : 70 m, 80 m et 90 m. Jouez une balle à chaque distance en adaptant votre amplitude.', '3 balles', 'Réaliser 10 séquences consécutives. Si erreur recommencer à 0.'),
  ('wedging', '13', 13, 5, 'Wedging 50m + 75m alterné', 'Changement de distance', 'Alternance distances', 'Alternez entre 50 m et 75 m à chaque coup. Travaillez la capacité à ajuster rapidement le dosage.', '10 balles', '<2 m = 2 pts ; <4 m = 1 pt ; objectif ≥14 pts.'),
  ('wedging', '14', 14, 5, 'Wedging montée/descente 65m', 'Adaptation lie', 'Pente montée/descente', 'Depuis 65 m, jouez 5 balles en montée et 5 en descente. Ajustez votre trajectoire et votre dosage.', '10 balles', '<2 m = 2 pts ; <4 m = 1 pt ; objectif ≥14 pts.'),
  ('wedging', '15', 15, 5, 'Wedging élite 10/10 à 80m', 'Performance maximale', '80 m précision totale', 'Depuis 80 m, placez 10 balles et tentez de toutes les placer à moins de 3 m du trou.', '10 balles', '10/10 balles <3 m. Sinon recommencer à 0.')
)
insert into public.validation_exercises (
  section_id,
  external_code,
  sequence_no,
  level,
  name,
  objective,
  short_description,
  detailed_description,
  equipment,
  validation_rule_text,
  illustration_url,
  is_active
)
select
  s.id,
  seeded.external_code,
  seeded.sequence_no,
  seeded.level,
  seeded.name,
  seeded.objective,
  seeded.short_description,
  seeded.detailed_description,
  seeded.equipment,
  seeded.validation_rule_text,
  null,
  true
from seeded
join public.validation_sections s
  on s.slug = seeded.section_slug
on conflict (section_id, sequence_no) do update
set
  external_code = excluded.external_code,
  level = excluded.level,
  name = excluded.name,
  objective = excluded.objective,
  short_description = excluded.short_description,
  detailed_description = excluded.detailed_description,
  equipment = excluded.equipment,
  validation_rule_text = excluded.validation_rule_text,
  is_active = excluded.is_active,
  updated_at = now();
