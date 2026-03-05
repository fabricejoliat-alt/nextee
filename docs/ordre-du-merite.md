# Ordre du Merite (OM) - Specification v1

## Scope
Classement junior par organisation, avec deux scores:
- `OM Brut`
- `OM Net`

Source des points:
- Points tournois (moyenne des scores si tournoi multi-tours).
- Points bonus (presence, participations, concours internes).

Timezone de reference:
- `Europe/Zurich`

## Regles valides

### 1) Tournois

Si tournoi sur plusieurs tours:
- les scores du tournoi sont moyennes avant calcul (gross/net).
- puis la formule OM est appliquee sur cette moyenne.
Si tournoi sur un seul tour:
- le score du tour est utilise tel quel.

#### Formule Net
- Base Net = `100 + ((CR - score_net) * 5)`
- Puis multiplication par coefficient de niveau de tournoi.
- Puis ajout des bonus applicables.

#### Formule Brut
- Base Brut = `(150 + SR) + ((CR - score_brut) * 5)`
- Puis multiplication par coefficient de niveau de tournoi.
- Puis ajout des bonus applicables.

#### Coefficients de niveau
- `club_internal` (tournoi interne juniors): `0.8`
- `club_official` (tournoi club ouvert): `1.0`
- `regional`: `1.2`
- `national`: `1.4`
- `international`: `1.6`

#### Bonus trous du tournoi
- 36 trous: `+5 Net`, `+10 Brut`
- 54 trous: `+10 Net`, `+20 Brut`
- 72 trous: `+15 Net`, `+30 Brut`

Implementation:
- `om_rounds_18_count` = `1 | 2 | 3 | 4`
- Les bonus ci-dessus s'appliquent pour `2 | 3 | 4`.

#### Match-play (individuel uniquement)
- `+10 points` par match gagne.
- Ajoute aux points de qualification stroke-play.
- Active seulement si `om_competition_format = match_play_individual`.

#### Tournois exceptionnels
- Liste gerable par manager.
- Forfait par tour marque comme exceptionnel:
  - `+150 Brut`
  - `+100 Net`
- Restriction metier UI:
  - option visible uniquement si handicap joueur `< 10`.

### 2) Points bonus

- Presence entrainement club: `+5` (par entrainement club present).
- Presence camp/performance day: `+15` (par jour, camp/stage club).
- Participation competition juniors/club: `+5`.
- Participation competition regionale: `+10`.
- Participation competition nationale: `+20`.
- Participation competition internationale: `+40`.
- Concours internes entrainement:
  - 1er: `+15`
  - 2e: `+10`
  - 3e: `+5`

### 3) Fenetres annuelles

Annee en 3 periodes:
- Periode 1: jusqu'au `31 mai` -> garder les `5` meilleurs resultats tournois.
- Periode 2: jusqu'au `31 juillet` -> garder les `10` meilleurs resultats tournois.
- Periode 3: jusqu'au `31 octobre` (puis fin d'annee) -> garder les `15` meilleurs resultats tournois.

Rappel:
- Le filtrage `top N` concerne les points tournois.
- Les bonus sont cumules normalement sur la periode.

### 4) Deadline de saisie

Pour qu'un tournoi compte:
- Les stats doivent etre saisies au plus tard le dimanche soir de la semaine du tournoi.
- Timezone: `Europe/Zurich`.

## Decisions de modelisation (v1)

### Champs competition sur `golf_rounds`
- `om_organization_id`
- `om_competition_level`
- `om_competition_format`
- `om_rounds_18_count`
- `om_match_play_wins`
- `om_exceptional_tournament_id`
- `om_is_exceptional`
- `om_stats_submitted_at`
- `om_points_net`, `om_points_brut`
- `om_points_bonus_net`, `om_points_bonus_brut`

Note:
- v1 est non disruptive: pas de contrainte bloquante immediate.
- L'obligation "course_rating/slope obligatoire en competition" sera enforcee progressivement cote UI + validation serveur.

### Nouvelles tables
- `om_exceptional_tournaments`
- `om_tournament_scores`
- `om_bonus_entries`
- `om_internal_contests`
- `om_internal_contest_results`

### RLS (v1)
- Lecture: staff org + joueur concerne + guardian lie.
- Ecriture: manager org (owner/admin/manager).

## Prochaines etapes (implementation app)

1. UI saisie rounds competition:
- rendre `course_rating` + `slope_rating` obligatoires si `round_type=competition`.
- ajouter niveau tournoi, format, nombre de tours 18, match wins, exceptionnel.

2. Service calcul OM:
- job/server function de calcul OM avec moyenne multi-tours -> `om_tournament_scores`.
- agregation + top N par periode.

3. Bonus automatiques:
- depuis presence `club_event_attendees` (training/camp).
- depuis competitions selon niveau.

4. Concours internes manager:
- CRUD concours + classement complet.
- attribution podium en `om_bonus_entries`.

5. UI classement:
- rubrique drawer `Ordre du merite`.
- vues `Brut` / `Net`, filtre periode, details sources.
