# Remodélisation Clubs / Académies / Fédérations

Branche : `codex/activitee-app-production`. Validation locale : 7 octobre 2026.

## État de livraison

**Les 16 migrations initiales ont été appliquées et contrôlées sur Zurich, avec sauvegardes avant/après. TEST et le déploiement de l’application restent en attente. Les clarifications du 7 octobre sur l’historique personnel exigent une correction du modèle avant la migration TEST.**

Les fixtures étaient dans une base PostgreSQL dédiée sur la boucle locale, avec PostgREST réel. Leur Auth et leurs transports e-mail étaient simulés. La base `org_fixture`, les serveurs locaux et le simulateur iPhone créé pour cette validation ont été retirés/arrêtés. Les captures et comptes rendus ne contiennent que des identités fictives.

## Modèle et compatibilité

- `organizations` est le registre canonique : `club`, `academy`, `federation`.
- `clubs` reste une projection réservée aux vrais clubs. Les anciennes colonnes `club_id` conservent leur nom pour compatibilité, mais leurs clés étrangères pointent vers `organizations`.
- `organization_members` porte les affiliations ; `club_members` est une projection compatible synchronisée et protégée contre les écritures directes du navigateur.
- `organization_relationships` porte le partenariat, les capacités de recherche/demande, l’état et la révision. Les transitions sont auditées.
- `academy_roster_entries` sépare affiliation à l’académie et origine : club ActiviTee, référence externe ou aucun club déclaré.
- `external_club_references` est descriptive et ne donne aucun accès. Une revendication ne rattache aucun joueur automatiquement.
- Un profil, un compte Auth et une relation familiale uniques sont conservés. `player_guardian_scopes` sépare les droits par enfant et organisation.
- Les parcours personnels, activités individuelles et validations appartiennent au joueur et restent sans organisation propriétaire. Les entraînements de club et événements organisés gardent une organisation propriétaire immuable. Le contexte sélectionné contrôle les accès et ne crée aucune propriété.
- La fin d’un partenariat ferme les nouvelles recherches et demandes. Une affiliation déjà active conserve son propre cycle de vie ; elle se suspend ou se termine séparément.

## Parcours et espaces

| Espace | Changements |
| --- | --- |
| Admin | Types distincts, partenaires de l’académie, capacités, historique, préparation juridique, références externes et revue humaine des identités. |
| Manager académie | Roster, badges d’origine, filtres origine/statut/groupe/saison, recherche partenaire minimale, création contrôlée externe, droits parentaux et invitations limités au roster. |
| Manager club | Partenaires et demandes entrantes ; validation du joueur et du périmètre de partage. |
| Coach | Contexte Club/Académie ; groupes, activités et joueurs filtrés et contrôlés côté serveur. Une affectation à une activité ne donne pas un droit général aux notes privées du joueur. |
| Player | Affiliations Club/Académie, historique personnel global, contenus organisés filtrés par organisation. Choix de l’organisation uniquement pour un entraînement de club ou le calcul OM d’une compétition. |
| Parent | Un compte familial, bénéficiaires autorisés, droits et actions juridiques distincts par enfant et organisation. Un blocage du Centre conserve Sion accessible. |

Partage partenaire : recherche minimale → demande → approbation du club source → autorisation parentale du Centre → activation transactionnelle.

Joueur externe : recherche d’identité → création contrôlée ou rapprochement revu → relation familiale unique → accès en attente/invitations → décisions juridiques propres au Centre → activation. La recherche par nom/date de naissance ne fusionne jamais des comptes ; réutiliser une identité exige une validation humaine explicite.

Club externe devenu client : création du vrai club → revendication de sa référence → propositions de profils existants → validation humaine → affiliation du profil existant. Les historiques du Centre restent au Centre.

Les identifiants envoyés par le client ne donnent aucun droit : acteurs, organisation, affectations et révision attendue sont vérifiés dans les routes serveur/RPC. Les anciennes fonctions d’écriture sportive ont aussi des gardes sur leurs lignes enfants.

## Juridique

La portée organisation complète la compatibilité `club_id`. Les anciens documents plateforme, versions publiées, présentations, décisions, empreintes et instantanés restent intacts. Les variables `{{club_name}}` des preuves anciennes restent interprétables ; les nouveaux modèles utilisent `{{organization_name}}`.

Les modèles d’organisation sont préparés en quatre langues et nécessitent une revue. L’extension de la notice de confidentialité est un **brouillon**, sans publication automatique. L’audit du roster et du partage ne constitue pas une acceptation juridique. Le superadmin ne peut pas décider pour un parent.

Une nouvelle version, un retrait ou un conflit parental sont contrôlés dans le périmètre enfant/organisation. `/legal/my` groupe les actions par organisation.

## Vérifications et preuves

| Contrôle | Résultat | Preuve |
| --- | --- | --- |
| SQL métier/RLS, refus, retrait, conflit, nouvelle version, rattachement externe, retour arrière, preuves anciennes | 14/14 | `evidence/sql-final.log` |
| HTTP réel Next.js → PostgREST/RPC/RLS, tous rôles, identifiants falsifiés, jointures, réutilisation des parents | 12/12 | `evidence/http-final.log` |
| Sécurité Coach, moteur PostgreSQL isolé inclus | 79/79, aucun test ignoré | `evidence/business-final.log` |
| Transaction unique et annulation complète ; sauvegarde chiffrée, mauvais mot de passe et corruption | 2/2 | `evidence/atomic-backup.log` |
| TypeScript | Passage sans diagnostic | `npx tsc --noEmit` |
| Lint ciblé, 195 fichiers | **0 erreur introduite** ; 405 erreurs et 93 avertissements préexistants | `evidence/lint-summary.json`, `evidence/lint-delta-summary.json` |
| Build normal | Passage | `evidence/build-final.log` |
| Preflight/postflight SQL | Passage local ; 0 anomalie sur les projections, FK, droits parentaux et propriétaires | `evidence/postflight-final.log` |

Le build utilise désormais `next build --webpack`. Turbopack de Next 16.1.6 a échoué dans son résolveur des polices Google existantes ; les polices et le design ont été conservés.

Parcours navigateur chargés et vérifiés :

- Manager Sion : demande du Centre et approbation ; Manager Centre : activation refusée avant l’autorisation, puis activation persistante après celle-ci.
- Parent : deux décisions distinctes, Centre initialement bloqué et Sion accessible ; autorisation fictive du Centre puis accueil chargé et filtre du Centre.
- Coach : seul groupe affecté et son junior après activation ; correction de la jointure explicite `coach_groups_club_id_fkey`, devenue ambiguë avec le propriétaire canonique.
- Admin : organisations, paramètres de l’académie, préparation juridique, capacités et historique de partenariat ; références externes et rapprochement.
- Player : compte unique, deux affiliations, contexte sélectionné ; création d’un parcours pour le Centre vérifiée en base.
- Roster : loading, empty, error et success ; FR/EN/DE/IT ; desktop, tablette 1024 × 768 et mobile 390 × 844.
- Nouvel écran Admin externe : quatre langues et absence de débordement à 390 × 844.
- Safari puis PWA installée sur un simulateur dédié iPhone 14 Pro / iOS 27 : connexion et roster chargés, modale sous l’encoche, défilement interne et fermeture accessibles au-dessus de l’indicateur d’accueil. Capture clavier restaurée. **Aucun binaire Capacitor/TestFlight n’a été testé.**

Captures disponibles dans `evidence/` : roster, décisions du parent, écran Admin mobile, parcours créé et modale PWA.

## Exécution Zurich

Le projet cible est fixé : `soivxpdcilgltbjbpimt`, connexion directe `db.soivxpdcilgltbjbpimt.supabase.co`.

**Les fichiers d’environnement locaux ne constituent pas la configuration Zurich.** `.env.production.local` pointe vers l’ancienne production ; le script ne le charge pas. La clé Storage Zurich est demandée explicitement et masquée pour la sauvegarde.

Le runner vérifie les dix gates et l’empreinte SHA256 des sources avant toute opération distante. Une modification du code invalide le reçu `validation.json` et bloque l’exécution.

### 1. Plan local

```sh
cd /Users/activitee/Projects/nextee
bash scripts/organizations/run-zurich-remodel.sh --plan
```

### 2. Contrôle Zurich en lecture seule

```sh
bash scripts/organizations/run-zurich-remodel.sh --check
```

Saisir le mot de passe PostgreSQL **Zurich** dans le terminal. Il est masqué et n’est écrit ni dans un fichier ni dans l’historique. Ne pas le transmettre dans le chat.

Le contrôle exige exactement le superadmin existant, aucune organisation/donnée métier/fixture, les catalogues Rules/Étiquette/Validation/FTEM, les modèles juridiques, les documents plateforme actifs et au moins 40 liens d’illustrations Zurich. Il ne supprime aucune donnée. Si une organisation ou un utilisateur réel a été créé depuis, il s’arrête et demande une revue.

### 3. Migration et sauvegardes

Après un contrôle réussi :

```sh
bash scripts/organizations/run-zurich-remodel.sh --apply
```

Entrées masquées : mot de passe PostgreSQL Zurich ; phrase de chiffrement d’au moins 16 caractères à conserver ; clé `service_role` de ce même projet Zurich.

Le runner effectue : contrôle initial → sauvegarde chiffrée avant migration → **une seule transaction pour les 17 migrations sur une base neuve** → contrôles de base vide et de conservation des empreintes → postflight strict → commit → sauvegarde chiffrée de la base propre. Un contrôle SQL en échec annule toute la transaction. Si la sauvegarde après commit échoue, le schéma reste migré et la sauvegarde préalable existe ; résoudre l’erreur et relancer `--backup`.

Les sauvegardes `.enc` sont dans `backups/organizations/`, ignorées par Git, avec permissions privées. Elles contiennent le dump PostgreSQL `public/auth/storage`, les configurations des buckets et les fichiers d’illustrations avec leurs SHA256. Chiffrement AES-256-GCM, clé dérivée avec scrypt. Déchiffrement et empreintes sont contrôlés avant d’annoncer l’intégrité.

La connexion PostgreSQL impose TLS `verify-full` et utilise automatiquement le certificat public Supabase livré dans `scripts/organizations/certificates/`. La vérification de la chaîne et du nom du serveur Zurich a été testée avec succès sans authentification ni requête SQL (`evidence/zurich-tls-verification.log`). Le magasin de certificats système et la configuration SSL du serveur restent inchangés. Un certificat vérifié peut être fourni explicitement via `PGSSLROOTCERT`.

**L’intégrité du fichier ne prouve pas sa restauration dans Supabase.** Le runner inscrit `restore_verified: false`. Un essai de restauration dans un projet séparé, avec les dépendances/permissions Supabase et les objets Storage, reste nécessaire avant de présenter cette sauvegarde comme un point de retour testé.

La publication juridique et le déploiement de l’application se font ensuite comme étapes distinctes, après revue du diff et du postflight. Aucun déploiement n’est lancé par ce script.

## Rejouer les tests

Les migrations historiques seules ne reconstruisent pas TEST : utiliser un export **schéma uniquement**.

```sh
ACTIVITEE_ORG_BASELINE=/private/tmp/activitee-test-public-schema-20261006.sql node --test tests/organization-personal-history.test.mjs tests/organization-integration.test.mjs tests/organization-atomic-batch.test.mjs tests/organization-backup.test.mjs
COACH_SECURITY_PGLITE_PATH=/Users/activitee/Projects/nextee/node_modules/@electric-sql/pglite/dist/index.js npm run test:coach-security
npx tsc --noEmit
ACTIVITEE_ORGANIZATION_FIXTURE=build npm run build
```

Pour le HTTP, `tests/helpers/organizationFixtureServer.mjs` initialise une base **locale vide** `org_fixture` sur le port 55439, PostgREST 4009 et un proxy Auth fictif 4008. Paramètres : `ACTIVITEE_ORG_FIXTURE_DIR`, `ACTIVITEE_ORG_BASELINE`, `ACTIVITEE_ORG_POSTGREST_BINARY`. Lancer ensuite le `launch-next.mjs` généré, puis :

```sh
ACTIVITEE_ORG_FIXTURE_STATE=/private/tmp/activitee-organization-qa/fixture-state.json node --test tests/organization-postgrest.test.mjs
```

Cette suite est restreinte à localhost et doit partir de fixtures neuves. Retirer ensuite la seule base dédiée et arrêter ses serveurs.

## État Zurich vérifié le 7 octobre 2026

Les 16 migrations sont appliquées au projet `soivxpdcilgltbjbpimt`. Une requête indépendante en lecture seule dans le SQL Editor Supabase confirme le postflight strict et la base propre : un superadmin/Auth/profil, zéro organisation ou club et aucune donnée métier. Les quatre versions juridiques ont la même empreinte qu’avant la migration ; présentations et décisions restent vides.

Références disponibles : 3 modèles juridiques d’organisation, 72 cartes Rules, 36 cartes Étiquette, 60 exercices, 10 valeurs FTEM et 40 illustrations Storage. Preuves : `evidence/zurich-postflight.json`, `evidence/zurich-postflight-browser.txt`, `evidence/zurich-catalogs-browser.txt` et captures associées.

Deux sauvegardes chiffrées sont présentes : `zurich-before-remodel-1791392552387.enc` et `zurich-clean-after-remodel-1791392587353.enc`. Leurs SHA256 ont été revérifiées après écriture. La création par le runner inclut le contrôle du déchiffrement et des empreintes du dump et des illustrations. La restauration dans un projet Supabase séparé reste à tester. L’application remodélisée n’a pas encore été déployée.

## Clarification : progression personnelle de validation

Clarification utilisateur du 7 octobre : `player_validation_attempts` contient les tentatives d’un joueur pour un exercice du catalogue de validation. Leur propriétaire est `player_id`, leur exercice est `exercise_id` et leur auteur est `created_by_user_id`. Elles ne doivent pas être attribuées à un club ou à une académie. La progression suit le joueur, indépendamment de l’organisation sélectionnée.

Le modèle initial impose à tort `organization_id NOT NULL` et filtre ces tentatives par organisation. Cette contrainte et ces filtres doivent être corrigés ensemble avec les contrôles API/RLS : les droits d’accès au joueur et les consentements restent obligatoires ; l’absence d’organisation propriétaire ne doit pas ouvrir les données à des tiers. Les versions juridiques publiées et leurs preuves restent intactes. Aucun correctif SQL n’a encore été appliqué à TEST ou Zurich.

Toutes les lignes sans club sont confirmées personnelles par l’utilisateur : 4 entraînements individuels, 14 parcours (dont 13 de Milo), 10 activités et 2 tentatives de validation, soit 30 lignes. Aucune ne sera attribuée automatiquement à Sion ou au Centre, y compris lorsque le parcours porte une organisation de calcul OM.

## Correctif personnel et migration TEST

`20261126_personal_player_history.sql` permet les propriétaires nuls pour l’historique personnel, retire la propriété d’organisation des validations, adapte RLS, enfants et RPC golf. Il prépare en quatre langues le partage d’historique personnel dans les modèles et le brouillon de confidentialité, sans publier de version. Les comptes, liens familiaux, historiques et preuves publiées sont conservés.

Les 16 sources initiales restent identiques à celles déjà appliquées sur Zurich. Pour une base peuplée non migrée, `migration-bundle.mjs` retire explicitement les deux étapes obsolètes d’inférence/obligation du propriétaire des migrations 20 et 22, puis applique le correctif 26 dans la même transaction. **Ne pas exécuter les 16 fichiers originaux séparément sur TEST.**

Validation corrigée : 20 tests SQL (dont import d’historiques personnels antérieurs avec deux affiliations), 15 tests HTTP Next → PostgREST, TypeScript sans diagnostic. Preuves `evidence/personal-history-sql.log`, `evidence/personal-history-http.log`, `evidence/personal-history-typescript.log`. Les contrôles navigateur/build de la version initiale ne sont pas une nouvelle validation de déploiement de ce correctif.

La migration TEST nécessite le mot de passe PostgreSQL TEST, absent de la session de l’agent. Commande dédiée :

```sh
cd /Users/activitee/Projects/nextee
bash scripts/organizations/run-test-remodel.sh --apply
```

Le script demande deux entrées masquées : mot de passe PostgreSQL **TEST** puis phrase de sauvegarde d’au moins 16 caractères. Il fixe le projet `wizbeuuvjibmmuxyynly`, vérifie le certificat et l’empreinte du lot testé, crée un dump chiffré `public/auth/storage` et vérifie son déchiffrement avant l’écriture. Les fichiers Storage eux-mêmes restent sur place et ne sont pas inclus dans ce dump ; cette migration ne les modifie pas. Une restauration réelle n’a pas été testée.

Les tables historiques sont verrouillées pendant la transaction, leurs colonnes d’origine sont comparées intégralement avant/après. Toute différence sur les comptes, liens familiaux ou données sportives, toute altération des catalogues/preuves juridiques ou tout échec du postflight annule le lot complet. Les contrôles ne remplacent pas les données par des fixtures et ne nettoient pas TEST.

À ce stade la migration TEST et le correctif 26 sur Zurich ne sont **pas appliqués**. Le code remodélisé n’est pas déployé sur `activitee.app`.

### Prérequis absents sur TEST (arrêt du 7 octobre, 20:23)

La tentative s’est arrêtée pendant le calcul des empreintes, avant la sauvegarde et toute écriture SQL. TEST ne possède ni `training_volume_default_targets` ni `legal_club_templates`, créés séparément pendant le bootstrap Zurich. Les fixtures précédentes ajoutaient ces prérequis implicitement ; elles ne reproduisaient donc pas cet état de TEST.

Le runner inventorie maintenant les tables protégées. Seuls ces deux catalogues connus peuvent être absents ; l’absence d’une autre table protégée bloque le lot. Après vérification de la sauvegarde chiffrée, la transaction crée uniquement les catalogues manquants : 10 niveaux FTEM et 3 modèles juridiques FR/EN/DE/IT issus du catalogue de référence dont le SHA-256 est vérifié. Aucun document de plateforme n’est importé ou publié. Les modèles créés sont non approuvés ; les brouillons d’organisation issus du remodelage nécessitent une relecture.

Les catalogues déjà présents ne sont ni réensemencés ni remplacés. Les réglages et objectifs FTEM existants des clubs rejoignent les tables historiques verrouillées et comparées intégralement. La fonction de création des objectifs FTEM est ajoutée uniquement si elle manque. Toute erreur annule la préparation et les 17 migrations ensemble.

Validation : 23 tests SQL réussis, dont restauration du schéma TEST brut sans les deux prérequis, conservation d’objectifs personnalisés et de versions/présentations/décisions juridiques, création des objectifs d’un nouveau club et annulation transactionnelle sur modification détectée. TypeScript sans diagnostic. Preuves : `evidence/test-prerequisites-sql.log`, `evidence/test-prerequisites-typescript.log`. Les 15 tests HTTP précédents restent les preuves des parcours API dont le code n’a pas changé dans ce correctif de préparation ; ils n’ont pas été relancés ici. La commande TEST reste identique, et son application distante attend une nouvelle exécution avec saisie masquée du mot de passe.

### Application TEST confirmée le 7 octobre à 20:35 (Zurich)

L’utilisateur a exécuté le runner avec succès : les 17 migrations et les deux catalogues manquants sont validés et committés. Sauvegarde préalable : `backups/organizations/test-before-personal-remodel-1791398089229.enc`. Les 23 tables historiques et les catalogues/preuves juridiques ont passé leurs contrôles de conservation ; les 19 versions, 49 présentations et 27 décisions ont les mêmes empreintes avant/après. Les 30 enregistrements personnels restent sans organisation propriétaire. Tous les compteurs de violations du postflight valent zéro.

Vérification indépendante après commit : les GET REST de `player_guardian_scopes`, `academy_roster_entries`, `legal_organization_templates` et `training_volume_default_targets` répondent HTTP 200. Le cache de schéma TEST connaît les nouvelles tables. Localhost affiche la page de connexion ; une connexion utilisateur réelle reste à retester. Preuves : `evidence/test-remodel-result.json`, `evidence/test-schema-cache-postflight.json`. Le correctif 26 de Zurich et le déploiement de l’application remodélisée restent en attente.
