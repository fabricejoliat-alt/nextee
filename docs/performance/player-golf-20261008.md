# Chargement Player / Mon golf — 8 octobre 2026

## Mesures locales

Chrome, même session Player, localhost:3000 en développement, base Supabase TEST,
cache navigateur activé, aucun ralentissement réseau simulé. Rechargements après
compilation des modules. Les relevés pollués par Fast Refresh sont exclus.

La durée correspond à la fin des requêtes initiales (DevTools Network Finish),
pas uniquement au chargement du HTML. Un relevé avant/après par route : ces valeurs
varient avec le réseau, la base et le mode développement ; elles ne mesurent pas Zurich.

| Route | Avant | Après | Réduction | Requêtes API/REST initiales avant → après |
| --- | ---: | ---: | ---: | ---: |
| `/player/golf/trainings/to-complete` | 13,24 s | 7,27 s | 45 % | 21 → 11 |
| `/player/golf` | 13,82 s | 8,24 s | 40 % | 34 → 12 |
| `/player/golf?section=rounds` | 16,99 s | 7,74 s | 54 % | 38 → 11 |

Sur Mon golf, les statistiques sont reçues vers 6,94 s ; les documents récents
terminent le chargement à 8,24 s. Ils restent affichés sur la vue d'ensemble.

Les en-têtes Server-Timing de la nouvelle lecture indiquent :

| Vue | Traitement serveur total | Autorisation | Accès historique personnel | Lecture des données |
| --- | ---: | ---: | ---: | ---: |
| Évaluations | 1 260 ms | 310 ms | 295 ms | 537 ms + noms 118 ms |
| Tableau de bord | 1 287 ms | 331 ms | 289 ms | 667 ms |
| Parcours | 750 ms | 323 ms | 251 ms | 177 ms |

Les durées HTTP incluent également le passage par Next.js et son middleware.
L'authentification et les contrôles juridiques communs prennent encore environ
2 à 3 secondes après le chargement initial du document. La première compilation
locale peut ajouter du délai.

## Causes et changements

- Lectures navigateur en cascade : contexte, Performance, séances, contenu,
  présences, noms des groupes ; certaines étaient doublées en développement.
- Mon golf relançait le contexte et les objectifs FTEM, lisait plusieurs fois
  les séances et les trous, et chargeait aussi entraînements/documents dans Parcours.
- Nouvelle lecture GET `/api/player/golf-data`, spécialisée par vue. Les lectures
  indépendantes sont parallèles côté serveur. Le navigateur partage uniquement
  les requêtes concurrentes identiques ; aucune réponse terminée n'est conservée
  dans un cache d'autorisation.
- Parcours ne déclenche plus les lectures du tableau de bord ni des documents.
- Les filtres de période de Mon golf utilisent le jeu de données chargé. Les
  comparaisons de dates utilisent des timestamps, y compris aux limites de période.
- Pagination des historiques et lots d'identifiants pour éviter la troncature
  PostgREST ou une URL contenant trop d'identifiants. Une erreur de page fait
  échouer la lecture au lieu de présenter des statistiques partielles.

## Accès et fonctionnel

La lecture serveur utilise le contrôle Player/Parent existant, puis vérifie
l'accès à l'historique personnel. Les affiliations, séances et événements sont
limités aux organisations autorisées. Les trous et contenus sont lus uniquement
pour les parties/séances sélectionnées. Les réponses sont `private, no-store`.

La page À évaluer affichait zéro activité malgré deux rappels dans Mon golf.
Le relevé navigateur montrait aucune lecture des événements après celle des
présences. La nouvelle lecture autorisée et le calcul partagé avec l'accueil
affichent les deux évaluations attendues. Les stages annulés ou non publiés,
activités en cours, absences excusées et évaluations complètes sont exclus.

Vérifications navigateur sur les données TEST, sans modification :

- Mon golf : objectif FTEM 38 % (6 140 / 16 080 min), assiduité 65 %,
  dernier score 87, deux évaluations, trois documents récents.
- Filtre Ce mois : 60 / 2 400 min, aucune partie ; aucune nouvelle requête
  d'historique n'est déclenchée par ce changement de période.
- Parcours : 13 parties, score moyen 86,1, GIR 38 %, fairways 58 % ;
  scorecard de 18 trous dépliée et filtre Sion vérifiés (3 parties, moyenne 83).
- Les composants, styles, liens d'ajout et champs métier existants sont conservés.

## Vérification technique

- TypeScript sans erreur ; ESLint ciblé sans erreur ni avertissement.
- 18 tests unitaires passés : calculs golf, historique paginé au-delà de 1 000
  lignes, erreurs intermédiaires, lectures concurrentes et rappels d'évaluation.
- 4 tests HTTP passés sur PostgreSQL/PostgREST et Next.js locaux jetables :
  acteur invalide, enfant tiers, académie non autorisée, Player/Parent,
  historique personnel, handicap du bon enfant, révocation immédiate et états
  des évaluations/stages. Aucun enregistrement métier TEST/Zurich modifié.
- Compilation de production réussie : 205 pages générées, dossier isolé
  `.next-organization-build` ; serveur localhost:3000 conservé.

## Portée

Changements locaux uniquement : aucune migration distante, aucun déploiement.
L'historique complet est paginé côté base puis transmis au client pour rendre
les filtres rapides. Pour des volumes beaucoup plus importants, une pagination
visible ou des agrégats serveur par période pourront réduire davantage le poids
des réponses. Une mesure sur le déploiement réel sera nécessaire pour confirmer
les temps en production.
