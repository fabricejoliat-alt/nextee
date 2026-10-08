# Optimisation de l’accueil Player — 8 octobre 2026

## Mesure locale

Compte Player existant sur `localhost:3000/player`, serveur Next.js en développement et base Supabase TEST. Chrome, cache navigateur chaud, aucune limitation réseau. Comparaison de deux rechargements, sans déploiement ni modification de la base TEST/Zurich. Ces chiffres ne constituent pas une mesure de production ou sur réseau mobile.

| Indicateur | Avant | Après |
| --- | ---: | ---: |
| Fin du chargement initial réseau, panneau Network | 28,75 s | 9,51 s |
| Dernière réponse initiale de données, HAR | 28,69 s | 9,13 s |
| Requêtes initiales terminées présentes dans le HAR | 168 | 88 |
| Appels aux API locales | 27 | 13 |
| Lectures Supabase REST/RPC depuis le navigateur | 44 | 8 |
| Appels navigateur à `auth/v1/user` | 11 | 3 |
| Appels aux validations | 5 | 1 |
| Appels au statut juridique au démarrage | 2 | 1 |
| Appels à l’ordre du mérite | 8 | 2 |
| Poids des quatre illustrations de validation | 9 926 922 octets | 27 444 octets |

Fenêtre HAR : requêtes démarrées dans les 30 premières secondes. Les relectures déclenchées ensuite au retour au premier plan sont exclues. Les poids sont les tailles des ressources, y compris celles servies depuis le cache ; ils ne sont pas le trafic transféré pendant ce rechargement. La diminution des lectures navigateur ne représente pas le nombre total de requêtes exécutées par le serveur.

## Changements

- Un seul démarrage de l’accueil, lié au joueur et aux organisations autorisées. Annulation des tâches devenues inutiles et partage des seules lectures identiques simultanées.
- Le contexte autorisé fournit directement le profil, les noms des organisations et le mode Performance. Activités, actualités et marketplace démarrent sans attendre les objectifs FTEM.
- Nouvelle API `/api/player/home-summary` : synthèse des présences, évaluations et données mensuelles côté serveur ; pagination de l’historique et lectures des éléments par lots. Le navigateur ne télécharge plus l’historique complet pour calculer ces cartes.
- Les validations et l’ordre du mérite terminent leur chargement indépendamment des statistiques.
- Suppression de la deuxième lecture identique du statut juridique. Vérifications des versions légales en parallèle ; synthèse des organisations et documents également en parallèle.
- Le proxy valide une fois le credential utilisé par chaque requête. Les handlers conservent leurs propres vérifications. Les composants d’affichage utilisent la session existante sans revalidation distante inutile.
- Chargement différé du graphique de l’accueil et imports ECharts limités aux fonctions utilisées. Miniatures de validation redimensionnées par Next Image ; autorisation limitée au bucket public du projet configuré.

## Accès et données

Aucun cache persistant de permissions n’a été ajouté. Le partage serveur concerne seulement une lecture identique déjà en cours et disparaît à sa résolution. La clé inclut les headers, le projet, le corps et donc le sujet des RPC. Les mutations et les requêtes disposant de leur propre signal d’annulation ne sont pas partagées.

L’API de synthèse utilise le rôle serveur après vérification du compte, du joueur, des organisations, des droits parentaux et des obligations juridiques. Les sessions personnelles sont incluses selon les contrôles existants ; les sessions d’une organisation non autorisée sont exclues. Les événements sont filtrés par les organisations autorisées. Le cache d’affichage existant est désormais séparé par compte, joueur et ensemble d’organisations.

Sur le compte réel local : stage du jour et entraînements visibles, toutes les affiliations affichées, quatre validations illustrées et graphique SVG chargé. Volume affiché : 60 min / 1 920 min. Assiduité : 100 %, soit 6 activités sur 6 ; deux évaluations attendues, cohérentes avec la page Mes activités. Ces deux dernières cartes, auparavant vides sur l’accueil, disposent désormais des données autorisées nécessaires à leur calcul.

## Vérifications

- 39 tests unitaires/régression : partage concurrent, isolation des credentials, annulation, calculs mensuels, évaluations, sécurité Player, fiabilité et accès juridiques.
- 4 scénarios HTTP avec PostgreSQL/PostgREST et Next.js locaux jetables : contexte autorisé, enfant usurpé refusé, historique personnel et club autorisé pour Player/Parent, académie non autorisée exclue, consentement en attente refusé, révocation parent appliquée à la requête suivante, jeton invalide refusé. Toutes les données de ces scénarios sont fictives.
- Quatre anciens échecs des tests juridiques reproduits sur les copies du code d’avant optimisation : mocks encore fondés sur le modèle antérieur. Adaptation des mocks à `organization_members`, aux résumés d’accès et au scope juridique explicite, sans assouplir les règles de l’application.
- TypeScript sans émission : succès. ESLint ciblé : succès. Build de production Webpack dans un dossier distinct du serveur local : succès, 204 pages générées.
- Contrôle visuel desktop et mobile 390 × 844 : design conservé, navigation mobile présente, aucune largeur débordante, quatre miniatures chargées et graphique visible.
- Parcours Parent en navigateur sur le serveur fictif local : connexion, page juridique indiquant Sion accessible et Centre en attente, puis accueil de l’enfant chargé avec Sion seul et graphique FTEM visible. Aucune acceptation de document effectuée.

## Deuxième passe : contrôles serveur et démarrage

Même compte, base TEST, serveur de développement, cache chaud et absence de limitation réseau ; émulation appareil désactivée. Nouveau rechargement de `/player`, sans navigation pendant la capture.

| Indicateur | Première passe | Deuxième passe |
| --- | ---: | ---: |
| Fin du chargement initial réseau | 9,51 s | 6,74 s |
| Dernière réponse initiale de données | 9,13 s | 6,37 s |

Le gain supplémentaire observé est de 29 % sur la fin du chargement réseau, soit 77 % depuis la mesure initiale de 28,75 s. Ce sont des mesures ponctuelles locales, pas une garantie de temps de réponse en production.

### Changements supplémentaires

- Le contexte de l’accueil démarre pendant les vérifications de consentement et de documents, qui sont elles-mêmes parallélisées. L’écran attend leur validation avant d’afficher les données.
- La lecture initiale est liée au credential, à l’enfant et au filtre d’organisation. Elle appartient à un seul montage de l’accueil : les répétitions de React Strict Mode peuvent la partager, mais un retour ultérieur vers la page demande un contexte neuf.
- Les contrôles indépendants d’affiliation, d’autorisation du joueur et de roster sont parallélisés. Les refus et erreurs continuent de bloquer l’accès.
- Dans le proxy, contrôles juridiques et d’organisation se chevauchent. La lecture du contrôle d’activation juridique n’est plus exécutée deux fois ; chaque requête conserve les contrôles et les réponses sans cache.
- L’accueil lit les jours de stage et les événements à venir en parallèle. Les noms de groupes et coachs sont chargés pour les trois rendez-vous affichés. La liste complète des activités demeure disponible pour les rappels de présence ; la lecture inutilisée de la structure des exercices a été retirée de cet endpoint.
- Les actualités réutilisent les affiliations déjà vérifiées et lisent profil et groupes en parallèle.
- Des headers `Server-Timing` sur le contexte et la synthèse distinguent contrôle d’accès, lecture d’historique et détails, sans identifiant ni donnée personnelle.
- Correction des imports ECharts : Heatmap, VisualMap et MarkLine sont aussi enregistrés pour les graphiques existants de « Mon golf ».

### Ce que les timings montrent

Une capture instrumentée avant cette passe donnait 1 803 ms dans le handler de synthèse, dont 828 ms pour le contexte d’accès et 519 ms pour l’accès à l’historique personnel. La capture finale donne 1 711 ms, dont 592 ms et 547 ms pour ces deux phases. Les lectures d’historique et détails prennent respectivement 301 ms et 271 ms. Ces phases cumulent plusieurs requêtes ; elles ne mesurent pas le temps SQL seul.

Le gain de bout en bout vient surtout du démarrage plus tôt des appels : la synthèse commence à 3,82 s dans la capture finale, contre 6,58 s dans la capture instrumentée intermédiaire. La durée HTTP de cette API est encore de 2,55 s, dont environ 0,84 s hors du handler mesuré (proxy, framework et transport). Un cache durable de permissions n’a pas été introduit pour obtenir ce gain.

### Vérifications de cette passe

- 43 tests unitaires/régression réussis, dont isolation de la lecture initiale, retour vers la page, timings et rendu SVG réel des heatmaps et lignes d’objectif.
- Les 4 scénarios HTTP Player/Parent ont été rejoués avec succès sur PostgreSQL/PostgREST et Next.js locaux fictifs, notamment le refus immédiat après révocation des droits parentaux.
- TypeScript et ESLint ciblé : succès. Build de production isolé : succès, 204 pages générées.
- Navigateur réel local : stage et entraînements visibles, 100 % / 6 activités sur 6, 2 évaluations et 60 / 1 920 min conservés. Le graphique de régularité de « Mon golf » contient bien son SVG et ses cellules, sans erreur console.
- Parcours Parent fictif : page juridique avec Sion disponible et Centre en attente, accueil limité à Sion, passage à « Mon golf » puis retour à l’accueil réussi. Aucun document accepté.

## Marge restante

La mesure complète est maintenant de 6,7 s en développement. L’objectif de 3 à 5 s n’est pas encore démontré. Les API métier restent autour de 2 à 3 s, avec une part importante dans les vérifications d’accès. La prochaine mesure utile sera sur le build déployé, puis sur les requêtes SQL de ces contrôles, pour décider d’un regroupement ou d’index à partir des plans réels.

Les fichiers sont préparés et vérifiés localement. Aucun commit, push, déploiement ou migration distante n’a été effectué pour cette optimisation.
