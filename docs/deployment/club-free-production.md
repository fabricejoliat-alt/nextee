# Initialisation d'une production sans club

État vérifié le 6 octobre 2026 sur Supabase TEST. Ce document décrit le socle à préparer pour `activitee.app`. Il ne lance aucune création de projet, copie ou suppression.

## Cible

- Un seul compte Auth, `profiles` et `app_admins` correspondant au superadmin.
- Aucun `club`, `organization`, membre de club, groupe, joueur, parent, coach, événement, archive, notification ou historique lié à un club.
- Les schémas, fonctions, politiques RLS, réglages et buckets nécessaires à la création d'un club.
- Trois documents juridiques de plateforme disponibles comme brouillons à revoir, puis à publier et activer après validation des informations propres à Zurich ; trois modèles de club permettent de créer les documents propres au club à son ouverture. Les anciens documents, présentations et décisions de TEST ne sont pas des modèles.
- Les catalogues Règles, Étiquette et Validations, avec les illustrations de Validation dans le bucket de la nouvelle base.
- Les niveaux et objectifs FTEM par défaut disponibles dès la création d'un club, puis modifiables par son Manager.

## Inventaire TEST vérifié

Exécuter `node --env-file=.env.local scripts/bootstrap/check-reference-base.mjs --mode=source` pour actualiser les comptes. Le contrôle n'affiche ni clés, ni noms, ni textes juridiques.

| Élément | TEST le 6 octobre | Destination |
| --- | ---: | --- |
| Clubs / organisations | 7 / 7 | 0 / 0 |
| Comptes `profiles` / superadmins | 24 / 1 | 1 / 1 |
| Documents juridiques de plateforme actifs | 3 | 0 avant revue et publication Zurich ; 3 brouillons importés |
| Documents juridiques de club actifs / fixtures QA | 9 / 6 | 0 / 0 |
| Règles : séries / cartes / questions | 12 / 72 / 216 | À conserver |
| Étiquette : thèmes / cartes | 12 / 36 | À conserver |
| Validations : sections / exercices | 4 / 60 | À conserver |
| Illustrations Validation | 40 URL TEST et 40 objets Storage | 40 objets et URL du nouveau projet |
| FTEM : objectifs liés aux clubs | 30 | 0 avant le premier club |
| `app_translations` | 0 | 0 actuellement ; les traductions intégrées au code restent disponibles |

Le contrôle élargi confirme également sur TEST 21 groupes, 2 saisons, 153 événements, 7 camps, 4 actualités de club, 4 liens parent-enfant, 59 notifications et 1 tentative de quiz. Toutes ces lignes doivent être absentes de la nouvelle base avant ouverture.

## Dépendances qui empêchent un simple `db reset`

1. Les migrations locales commencent après la création des tables fondamentales (`clubs`, `profiles`, `app_admins`). `supabase/config.toml` référence `supabase/seed.sql`, mais ce fichier n'existe pas. Il faut produire et vérifier une base de schéma complète à partir de TEST, puis appliquer seulement les données de référence autorisées.
2. Les trois documents juridiques de plateforme sont des lignes de base publiées sur TEST ; le schéma seul ne les reproduit pas. Les neuf documents de club actifs sont liés à trois clubs et ne peuvent pas être copiés tels quels dans une base sans club. Leurs textes et règles approuvés doivent devenir des modèles indépendants des clubs, puis être instanciés lors de la création du club.
3. Les 40 `validation_exercises.illustration_url` pointent vers le Storage TEST. Les fichiers et les URL doivent être transférés ensemble vers le nouveau projet.
4. FTEM était initialisé lors du premier GET Manager de `/api/manager/clubs/[clubId]/training-volume`. La migration `20261109_seed_ftem_on_new_club.sql` a été appliquée à Zurich : sa table des dix niveaux par défaut et son déclencheur remplissent les réglages et objectifs dans la même transaction que la création du club. Un essai transactionnel a confirmé les dix lignes, puis son annulation a laissé zéro club et zéro objectif de club.
5. `supabase/sql/reset_keep_superadmin.sql` efface `app_translations` et ne couvre pas les nouvelles dépendances. Ne pas l'utiliser pour construire ou nettoyer cette production.

L'export contrôlé [legal-catalog-20261006.json](../../supabase/bootstrap/legal-catalog-20261006.json) contient les textes des trois documents de plateforme actifs sur TEST et de trois modèles de club tirés des versions publiées. Les trois exemplaires de chaque modèle ont été comparés sur leurs textes FR/EN/DE/IT et leur configuration avant export. Le fichier ne contient aucun UUID, identifiant d'utilisateur, identifiant de club, présentation ou décision. Empreinte SHA-256 : `dee7d511da8ecf60e850302bcf3ab78a6c3664da7cadf35a3d0bbb252690664c`. Le script `scripts/bootstrap/seed-legal-drafts.sh` a été exécuté le 6 octobre. Postflight SQL Zurich : trois brouillons de plateforme inactifs, trois modèles de club non approuvés, aucune version publiée, contrôle juridique désactivé, aucun club. Le fichier SQL de création des modèles est dans `supabase/bootstrap`, car sa précondition vise la base Zurich vide et ne convient pas au déploiement automatique des migrations sur TEST. L'Admin juridique propose désormais, seulement si les trois modèles sont installés, une action explicite pour créer les trois brouillons d'un nouveau club. Un essai SQL sur Zurich a vérifié la création des trois brouillons et des dix lignes FTEM dans une sous-transaction annulée ; postflight : zéro club, organisation, document de club et ligne FTEM. La mention erronée de l'Irlande dans la notice de confidentialité a été corrigée dans les quatre brouillons Zurich le 6 octobre ; ils restent à relire et inactifs (voir [relecture juridique](legal-zurich-review.md)). Les mentions d'hébergement Vercel et les autres faits importés de TEST doivent être vérifiés avant publication. **Ne pas ouvrir le domaine public avant la validation fonctionnelle et éditoriale.**

## Projet Supabase et coût

La nouvelle production exige un projet Supabase séparé. Sur une organisation Pro, chaque projet actif ajoute des frais de calcul ; la documentation Supabase donne environ 10 USD par mois pour un projet Micro supplémentaire, facturé à l'heure, hors consommation et options. Relever le montant affiché avant de confirmer sa création. Une restauration de TEST dans un nouveau projet copie aussi les comptes Auth et les données personnelles ; la nouvelle instance doit rester isolée et inaccessible publiquement jusqu'à la purge vérifiée. La restauration ne transfère pas les objets Storage, les Edge Functions ni tous les réglages Auth/Realtime, à traiter séparément.

Le projet `activitee-app-production` (`soivxpdcilgltbjbpimt`) a été créé par le propriétaire le 6 octobre 2026 en région Zurich (`eu-central-2`), avec une instance Small affichée à 15 USD par mois au moment de la création. Le schéma `public` a été importé depuis un export sans données le 6 octobre : postflight SQL Zurich = 139 tables, 235 fonctions, 342 politiques. Les catalogues Règles, Étiquette, Validations et FTEM ont ensuite été installés et vérifiés : 12 séries/72 cartes/216 questions, 12 thèmes/36 cartes, 4 sections/60 exercices, 10 niveaux FTEM. L'unique compte Auth a été créé par le propriétaire, puis lié à un profil et au rôle `app_admins` avec son accord explicite : postflight = 1/1/1, 0 club et 0 cible FTEM de club. Les données juridiques sont importées comme brouillons inactifs. Le bucket public `validation-exercise-images` a été créé avec limite de 5 Mo et MIME JPEG/PNG/WebP. Les 40 objets ont été copiés le 6 octobre ; postflight SQL Zurich : 40 objets, 40 URL Zurich, 0 URL étrangère, 40 liens correspondant à un objet, 0 club. Les secrets applicatifs et le DNS Infomaniak d'`activitee.app` restent à réaliser. Le domaine est acquis, mais ses enregistrements DNS ne sont pas encore configurés. Aucun nettoyage de TEST ne doit précéder la validation de la nouvelle production.

## Ordre d'exécution

1. Figer le commit `test` choisi, après intégration des corrections locales et recette juridique finale.
2. Sauvegarder TEST, relever sa structure complète et inventorier les fonctions/tâches externes avant toute restauration ou copie. Pour exporter seulement le schéma `public`, exécuter localement `bash scripts/bootstrap/dump-test-schema.sh` ; le script demande le mot de passe TEST dans le terminal, sans écho, et écrit `/private/tmp/activitee-test-public-schema-20261006.sql` avec des permissions privées. Examiner le SQL avant toute application. Les déclencheurs/politiques éventuels des schémas `auth` et `storage` exigent un contrôle séparé.
3. Construire la nouvelle base **isolée**, sans domaine public ni tâches d'envoi actives. Le schéma complet est installé. Installer ensuite le superadmin et les seules données de référence ci-dessus. `scripts/bootstrap/seed-reference-catalogs.sh` prépare Règles, Étiquette, Validations et FTEM dans une transaction unique, avec un contrôle préalable de la base cible vide ; il ne traite pas les documents juridiques ni les illustrations Storage.
4. Vérifier les documents juridiques de plateforme, constituer les modèles de club et leur instanciation, transférer les 40 illustrations, puis tester FTEM sur un club temporaire. Supprimer ce club et vérifier qu'aucune donnée de test ne reste.
5. Exécuter `check-reference-base.mjs --mode=target` avec les variables du **nouveau** projet. Tous les contrôles doivent réussir ; le script est un contrôle de structure et de volume, pas une preuve de validité éditoriale ou juridique.
6. Brancher le nouveau projet Vercel et `activitee.app` à cette base uniquement après les essais de connexion, création de club, documents, Règles, Étiquette, Validations et FTEM.
7. Nettoyer TEST séparément, avec sauvegarde et postflight, une fois la nouvelle production vérifiée.

Le projet actuel sur `main` et `activitee.golf` conserve sa propre base pendant toute cette séquence. Aucune synchronisation des deux applications n'est prévue puisque la nouvelle production démarre sans les données de l'ancienne.

Pour les illustrations, `bash scripts/bootstrap/run-validation-image-transfer.sh` demande sans écho la clé `service_role` du projet Zurich, lit les identifiants TEST dans `.env.local` et affiche un plan sans écriture. Après inspection du plan, le même script avec `--apply` copie les objets puis remplace les URL dans les 40 exercices correspondants. Il refuse d'écraser un objet dont le contenu diffère. Ne pas coller la clé dans le chat ou dans une commande visible dans l'historique du shell.
