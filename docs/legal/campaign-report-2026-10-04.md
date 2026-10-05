# Rapport unique — campagne de validation des documents juridiques

Dates : 4–5 octobre 2026, campagne, contrôle des ajustements et complément de couverture sur TEST. Dépôt : `/Users/activitee/Projects/nextee`, branche `test`.

## Conclusion actuelle

**Le correctif SQL déployé fonctionne sur les scénarios retestés. Le module reste inactif et ne doit pas encore être activé.** Les blocages de publication, les cinq RPC internes exposés, la lecture Marketplace interclub et le conflit d’édition d’événement de la première phase sont résolus sur TEST. La publication et les décisions ont maintenant été exercées dans Chrome avec des textes et utilisateurs fictifs, puis relues en base.

- Dernier déploiement TEST vérifié : **`2af721ad29110da2f5502fa883949c66e435b203`**, Vercel **Ready**. Le complément applicatif et le fond blanc de `/legal/my` sont livrés ; **24 états Chrome et huit lectures PostgREST ciblées réussis** le 5 octobre (section 13). Les trois ajustements d’interface sont validés dans Chrome le 5 octobre (section 10). La campagne fonctionnelle du 4 octobre portait sur `5a53f7c` ; son postflight après application comporte **16 lignes**.
- **29 états Chrome** enregistrés, desktop 1280 × 900 et mobile 393 × 852, sur Admin, Player, Parent, Coach, Manager et un Player d’un second club. Aucun débordement horizontal dans ces états.
- **29 contrôles d’intégrité + 7 contrôles finaux réussis** sur les fixtures persistées ; **16 contrôles métier/accès**, édition d’événement avec conflit **PT409**, **94 refus de lecture PostgREST** réussis.
- **58 tests locaux réussis** pendant la campagne, TypeScript et ESLint ciblé sans erreur. Les deux tests de saisie Admin sont rejoués le 5 octobre : **2/2**. Les deux corrections Admin et le libellé parental sont déployés et contrôlés. Le contraste de `/legal/my` et le complément de couverture de la section 11 sont maintenant **déployés dans `2af721a` et contrôlés** (section 13).
- Complément du 5 octobre : **23 tests locaux, 55 contrôles SQL en transaction annulée et 53 contrôles finaux réussis**. Le lot `20261103` a ensuite été **appliqué par l’utilisateur et contrôlé sur TEST** : 50/50 lignes de postflight et quatre scénarios SQL supplémentaires réussis (section 12). Il contient 35 politiques restrictives ajoutées, deux corrigées, quatre résolveurs de portée et trois fonctions corrigées. Les modifications applicatives sont déployées dans `2af721a` ; les limites avant activation sont conservées en section 11.
- Nettoyage vérifié : **garde SQL false, aucun document actif, six comptes fictifs bannis**, appartenances désactivées, rôle Admin fictif retiré et objets privés supprimés. Quatre versions et dix décisions entièrement fictives sont conservées par les protections d’immutabilité.

Aucune donnée personnelle réelle modifiée, aucun vrai courriel, aucun accord réel, aucune activation et aucune opération sur la production. Ces résultats ne constituent aucune attestation de conformité juridique ou Store. La section 14 documente la préparation suivante : périmètre suisse confirmé, règles produit proposées et brouillons FR encore à valider.

## 1. Environnement et méthode

| Élément | Preuve observée |
|---|---|
| Supabase | `golf-juniors-app`, branche **test / PREVIEW**, référence **`wizbeuuvjibmmuxyynly`** ; correspondance avec la configuration locale |
| Application | `https://test.activitee.golf` |
| Vercel | Déploiement `CHY4v1K3XWvPuD6xoZ3eYyEuMedh`, commit `5a53f7c`, branche `test`, état **Ready** |
| Origine Chrome des fixtures | `https://nextee-35d1mrohi-fabrice-joliats-projects.vercel.app`, ce même déploiement ; session fictive distincte de celle de l’utilisateur sur le domaine TEST |
| Variables Vercel | Recherche `LEGAL_`, toutes les catégories d’environnement : **No Results Found** ; aucune variable modifiée ni secret affiché |
| Garde SQL | `legal_enforcement_control.enabled=false`, contrôlé avant, pendant et après les essais |

Les migrations `20261020` à `20261102` **n’ont pas été rejouées** pendant cette reprise. Le postflight 25 a été exécuté en lecture seule dans le projet TEST authentifié. Il confirme notamment les quatre résolutions `extensions.digest`, les cinq helpers fermés aux clients, les cinq conflits applicatifs `PT409` et la politique restrictive Marketplace.

Les requêtes automatisées vers le domaine TEST ont rencontré la protection Vercel (401 avant l’application). La revue automatique a rejeté le recours au mécanisme d’accès de `vercel curl` sans autorisation spécifique. Une question a été adressée à l’utilisateur ; aucune réponse n’était reçue à la clôture. **Aucun bypass n’a été exécuté, aucune protection désactivée.** Les parcours applicatifs ont donc été testés dans Chrome authentifié, et les vérifications de persistance/RPC via le client Supabase TEST autorisé. Les résultats RPC ne sont pas présentés comme des tests HTTP applicatifs.

Preuves : [environnement](evidence/20261004-deployed-environment.json), [postflight, 16 lignes](evidence/20261004-deployed-postflight.json), [états Chrome](evidence/20261004-deployed-browser-results.json).

## 2. Matrice consolidée des scénarios

**CHROME TEST** : interaction dans le déploiement ci-dessus, avec relecture des écritures en base. **RPC TEST** : appel direct du noyau serveur avec fixtures ; ne couvre pas la route HTTP. **LOCAL → TEST** : application locale branchée sur Supabase TEST lors de la première phase. **SQL ANNULÉ** : transaction de preuve de la première phase, intégralement annulée.

| Scénario | Résultat actuel | Preuve et limite |
|---|---|---|
| Création de brouillon, FR/EN/DE/IT, sauvegarde et approbation, résumé, revue de règle, comparaison, publication | **RÉUSSI CHROME TEST** | Document `_ui`, quatre textes explicitement sans valeur juridique, V1 publiée par Admin fictif ; `deployed-ui-draft`, `deployed-ui-publication` |
| Proposition de traduction automatique | **RÉUSSI LOCAL → TEST**, pas retesté sur Vercel | Première phase `extra-results` ; proposition distincte de l’approbation ; qualité juridique non évaluée |
| Parent/optional : préparation des deux autres documents | **RÉUSSI RPC TEST** | `deployed-fixture-publications` ; provisioning de fixtures, pas preuve de leur création UI |
| Décision personnelle Player FR, Parent EN, Coach DE, Manager IT | **RÉUSSI CHROME TEST + persistance** | Acteur, bénéficiaire, version, langue, texte et empreinte conservés ; `deployed-integrity-results`, `deployed-persisted-decisions` |
| Admin : gestion et revue des documents | **RÉUSSI CHROME TEST** | Éditeur sélectionné, quatre langues, publication, revue parentale et résolution du retrait ; desktop/mobile |
| Décision personnelle d’Admin sur document plateforme | **NON VÉRIFIÉ** | Aucun document plateforme actif créé : il aurait été applicable à de vrais comptes Admin |
| V1 ouverte, publication V2, tentative de décision sur V1 | **RÉUSSI CHROME TEST** | Message `Legal version changed`, aucune nouvelle décision V1 ; V2 publiée par provisioning RPC, puis réaffichée dans Chrome |
| V2 exige une nouvelle décision ; refus V2 ; conservation V1 | **RÉUSSI CHROME TEST + persistance** | Nouvelle validation requise, refus conservé, décision V1 et texte inchangés ; contrôles finaux |
| Consentement facultatif, retrait, nouvelle autorisation avant résolution | **RÉUSSI CHROME TEST + persistance** | `consented` → `withdrawn`, conflit vrai ; réautorisation refusée |
| Résolution motivée Admin puis nouveau consentement | **RÉUSSI CHROME TEST + persistance** | Résolution distincte enregistrée, conflit levé, retrait toujours dans l’historique |
| Lien familial seul / représentation vérifiée | **RÉUSSI CHROME TEST**, refus noyau en première phase | Aucun bouton enfant avant revue ; revue Admin fictive, état `verified`, bouton enfant ensuite |
| Code parental incorrect puis correct | **RÉUSSI CHROME TEST + persistance** | Mauvais code rejeté avec une tentative ; succès suivant consomme le défi et consigne l’enfant + `parent_email_confirmed=true`. Deux soumissions au total ; aucun mail envoyé |
| Code consommé, cinq erreurs, expiration, limite de fréquence, représentant révoqué | **RÉUSSI RPC TEST** | Rejets explicites ; dernier défi fictif expiré pour le test ; assertion fictive révoquée |
| Reprise identique des quatre décisions et décision parentale | **RÉUSSI RPC TEST** | Même identifiant retourné ; décision différente avec même clé refusée |
| Deux appels réellement simultanés, même clé | **RÉUSSI RPC TEST** | Deux réponses identiques, une seule ligne de décision ; contrôle final |
| Club B ne voit pas le document A | **RÉUSSI CHROME TEST + RPC TEST** | Liste vide desktop/mobile ; présentation étrangère refusée |
| Faux rôle / langue `es` | **RÉUSSI RPC TEST** | Présentation refusée |
| Ancien client sans aperçu / aperçu périmé de publication | **RÉUSSI RPC TEST** | Rejet du snapshot absent ou ancien ; ancien client d’approbation aussi couvert par tests locaux |
| Langue manquante, traduction non relue, variable inconnue | **RÉUSSI RPC TEST** | Publication refusée ; brouillon fictif restauré après chaque série |
| Immutabilité présentation / décision / version | **RÉUSSI RPC TEST** | Suppression/modification refusée, y compris par le service de test |
| Accès Admin HTTP refusés aux autres rôles | **RÉUSSI LOCAL → TEST**, pas rejoué automatiquement sur Vercel | Six 403 en première phase ; protection Vercel bloquante pour ce lot automatisé |
| Tables privées | **RÉUSSI TEST** | 47 relations × anon/Player : 94 requêtes `limit=0`, toutes refusées ; aucune lecture de données personnelles |
| Cinq helpers internes | **RÉUSSI TEST après correctif** | Refus `42501` aux clients ; usages internes légitimes préservés dans les flux métier testés |
| Groupes, création d’événement et réessai | **RÉUSSI TEST, périmètre ciblé** | Groupe/événement persistés, même événement au réessai, fil créé indirectement, lecture étrangère vide |
| Édition occurrence Manager → corps métier Coach | **RÉUSSI TEST après correctif** | Édition normale persistée ; snapshot périmé renvoie rapidement `PT409 / planning_conflict`, sans ancien timeout |
| Messagerie | **RÉUSSI TEST, périmètre ciblé** | Message entre fixtures persisté ; accès étranger refusé |
| Golf / OM | **RÉUSSI TEST, périmètre ciblé** | Partie/trou/agrégat, édition parentale ; autre club refusé ; visibilité OM selon rôle/club |
| Marketplace | **RÉUSSI TEST après correctif** | Lecture propre club admise, anon et autre club filtrés |
| Storage privé | **RÉUSSI TEST, périmètre ciblé** | Dépôt client direct refusé, accès privé autorisé selon rôle, autre club refusé ; préparation/finalisation applicative déjà testée LOCAL → TEST, pas rejouée sur Vercel |
| Demande relative aux données | **RÉUSSI LOCAL → TEST**, circuit limité | Demande fictive persistée et clôturée ; aucune exécution réelle d’un droit |
| Gardes actifs / arrêt effectif des traitements après refus ou retrait | **NON VÉRIFIÉ, hors autorisation** | Aucun garde activé ; les effets métier sous activation ne sont pas déduits des tests de registre |

Preuves récentes : [29 contrôles d’intégrité](evidence/20261004-deployed-integrity-results.json), [7 contrôles finaux](evidence/20261004-deployed-final-checks.json), [décisions persistées](evidence/20261004-deployed-persisted-decisions.json), [16 contrôles métier](evidence/20261004-deployed-business-results.json), [édition PT409](evidence/20261004-deployed-event-edit.json), [94 refus directs](evidence/20261004-deployed-direct-read-results.json), [compteur après mauvais code](evidence/20261004-deployed-wrong-parent-code.json).

Un premier contrôle du compteur parental attendait à tort une seule tentative après le succès : l’implémentation compte toutes les soumissions, y compris la bonne. L’assertion a été corrigée à deux, après vérification de la tentative incorrecte seule (une) et du code SQL. Ce faux échec du script n’est pas une anomalie produit masquée.

## 3. Contrôle visuel et corrections d’interface

L’éditeur Admin a été utilisé avec le document fictif sélectionné, sur les quatre langues ; la publication, l’historique, la représentation parentale et les retraits ont été manipulés. Les écrans de présentation/décision Player, Parent, Coach et Manager ont été observés dans les deux tailles. L’historique Player non vide a été déplié sur mobile. Les 29 états sauvegardés n’ont pas de débordement horizontal. Cela ne constitue pas une validation native iOS ou une validation d’accessibilité complète.

![Publication fictive dans l’Admin TEST](evidence/deployed-admin-publication-desktop.png)

[Éditeur mobile](evidence/deployed-admin-editor-mobile.png) · [Présentation Player mobile](evidence/deployed-player-presentation-mobile.png) · [Historique Player mobile](evidence/deployed-player-history-mobile.png) · [Parcours Parent mobile](evidence/deployed-parent-authorized-mobile.png).

Trois ajustements ont été préparés après `5a53f7c`, puis déployés par l’utilisateur dans **`90f41d4`** et contrôlés dans Chrome le 5 octobre (section 10) :

| Défaut ou ambiguïté observé | Correction déployée | Vérification |
|---|---|---|
| Saisie du résumé pendant une sauvegarde/relecture, puis perte de cette saisie et erreur `Summary required` | Champs et changements de sélection/langue désactivés pendant l’opération | Test de régression avec réponse différée ; échec avant, succès après ; verrouillage et réouverture constatés dans Chrome desktop/mobile |
| Changer de langue efface un résumé non sauvegardé | Séparer l’initialisation du texte traduit et des propriétés communes du brouillon | Test de régression ; échec avant, succès après ; changements FR/EN/DE/IT contrôlés dans Chrome desktop/mobile |
| Carte d’autorisation parentale affichant encore « validation requise » après une décision pour l’enfant | Ne plus présenter l’état personnel du parent comme celui de l’enfant ; renvoi à l’historique par enfant, état personnel libellé « pour moi » | Cause confirmée dans le code ; libellé corrigé et historique de l’enfant autorisé contrôlés dans Chrome desktop/mobile |

La charte et les styles Admin sont conservés. La protection ajoutée ne promet pas de conserver toutes les modifications non enregistrées lors de toute navigation ou de toute autre sauvegarde.

## 4. Audit des accès directs et indirects


Le [registre de revue](evidence/20261004-access-review.csv) comporte **367 entrées** : 223 fonctions, 138 relations et six buckets. Chaque entrée conserve finalité, rôles/grants, colonnes ou paramètres de portée, qualification, appels indirects repérés et limite de preuve. L’[export SQL](evidence/20261004-test-inventory.json) contient les corps complets, politiques, contraintes et triggers, plus une ligne d’environnement.

La classification du registre sert au triage. Une signature, un grant ou l’absence du mot `legal_required_` n’est pas une faille confirmée. Les conclusions confirmées reposent sur les fixtures et sur les chaînes d’appel inspectées ; les autres restent des points de revue.

| Surface | Qualification actuelle | Travail restant |
|---|---|---|
| 91 fonctions réservées au service/interne | Accès client direct fermé par privilèges | Autorisations des routes et des fonctions privilégiées appelantes à maintenir |
| 39 fonctions avec garde ou prédicats du garde | Garde présent, inactif | Tester son effet métier après une future autorisation d’activation sur environnement jetable |
| 39 fonctions de trigger | Pas de mutation RPC autonome du seul fait d’EXECUTE | Inspecter le droit sur l’écriture déclenchante ; ne pas couper les dépendances internes |
| 41 prédicats d’autorisation booléens | Pas de contournement métier démontré | Certains prennent un UUID arbitraire : revoir finalité, exposition anonyme et divulgation d’appartenance/rôle |
| 7 fonctions de calcul/contexte JWT | Pas de mutation métier persistée | Exemption justifiable, à formaliser |
| 5 helpers internes exposés | Appels non autorisés confirmés | Corrigé sur TEST : refus clients et appels métier indirects vérifiés dans la reprise ; conserver les exemptions internes documentées |
| `staff_seed_group_players_attendees` | Mutation avec contrôles de rôle existants ; absence de frontière juridique propre | Revoir garde de l’événement et activité des membres/coach ; aucune preuve de contournement d’un garde actif n’est revendiquée |
| 47 relations privées | Privilèges fermés et 94 refus HTTP vérifiés | Les traitements serveur restent une surface distincte |
| 11 relations avec RLS sans politique permissive | Lignes directes fermées structurellement | Ne pas interpréter le grant SELECT seul comme accès effectif |
| 12 relations d’identité/initialisation | Profil, clubs, rôles, familles, préférences et contexte nécessaires avant accord | Définir des exemptions minimales ; éviter de bloquer connexion, choix d’enfant et consultation juridique |
| `app_translations` | Catalogue public en lecture, finalité distincte | Conserver sa lecture publique ; toute écriture cliente doit rester interdite |
| 8 relations avec garde restrictif, plus Marketplace | Couche installée, inactive | Formaliser la portée juridique propre à chaque club/bénéficiaire ; frontière Marketplace appliquée et retestée sur TEST |
| 58 autres relations métier avec RLS | Couverture juridique non démontrée | Revue des politiques et des parents appelés ; **ce nombre ne signifie pas 58 failles** |
| 5 buckets publics | URLs publiques intentionnellement servies hors garde d’acceptation | Décider les contenus admissibles, révocation, suppression et caches |
| `player-documents` privé | Parcours signé et refus directs contrôlés | Retrait d’accès après émission d’une URL, expiration, caches et traitements différés à compléter |

### Chaînes et limites significatives

- `create_manager_events_v1` déclenche la création/synchronisation du fil ; la révocation des cinq helpers préserve le propriétaire privilégié des triggers. La mise à jour de l’événement et le recalcul du trou réussissent sur TEST après application du correctif.
- `create_manager_activity_batch_v1` consulte le garde plateforme, puis la création repasse par le groupe et son garde, y compris lorsqu’un groupe technique est créé. L’absence de garde club en première ligne n’est donc pas une preuve de contournement. Le chemin de réessai retournant un résultat antérieur mérite une revue du besoin de validation club.
- Les politiques de certaines tables enfants passent par une table parente déjà filtrée ; d’autres utilisent des helpers `SECURITY DEFINER` qui peuvent contourner la RLS parente. Les dépendances de la colonne `indirect_calls` doivent être suivies avant une extension de politique.
- Golf : plusieurs entrées et politiques ne demandent que les validations plateforme, tandis qu’un appel de trou peut déterminer un club via l’organisation OM. La portée attendue doit être définie puis harmonisée ; elle n’est pas réputée complète.
- Le garde HTTP protège les familles de pages Player/Coach/Manager et des API correspondantes, Parent et messages. L’Admin n’a pas de garde personnel obligatoire équivalent. Les autres familles API et exceptions profil/connexion nécessitent une décision explicite et une revue.
- Les contrôles requis actuels portent surtout sur les documents personnels. Une autorisation parentale pour un bénéficiaire et le retrait d’un consentement facultatif n’entraînent pas encore une suspension démontrée de chaque traitement métier concerné.
- Les médias publics, liens déjà émis, tâches différées et caches ne sont pas protégés par la seule redirection vers `/legal/my`.

## 5. Ce qui reste non vérifié avant activation

- **Activation et effets métier** : fermeture de tous les accès requis, exemptions d’initialisation/support/Admin, arrêt des traitements liés à un retrait, périmètre plateforme/club/enfant. La campagne interdit l’activation ; les résultats du registre ne prouvent pas ces effets.
- **Couverture métier complète** : grilles golf 9/18 trous, Miss cut, toutes les surcharges OM ; éditions de séries, présences/évaluations existantes, archivages, camps, compétitions, quiz, publication Étiquette et toutes les mutations du lot 20261101. Les tests métier ciblés réussis ne couvrent pas chaque variante ni tous leurs écrans Chrome.
- **Clients et concurrence** : ancienne application/PWA réellement installée, cache hors ligne, changement de rôle/club/enfant ; concurrence publication/décision et traduction FR/IA. Le double appel de décision identique a été testé, pas toutes les interleavings.
- **Cas parentaux supplémentaires** : deux représentants en désaccord, changement d’e-mail, code lié à un autre enfant ; profils sans nom et variable `child_name` pour un adulte. Les comptes fictifs n’ont pas servi à prétendre valider une véritable autorité légale.
- **Ergonomie complète** : navigation clavier, lecteur d’écran, safe area/native iOS, noms lisibles à la place des UUID abrégés, traduction des libellés d’interface (les documents eux-mêmes ont quatre langues), historique enfant après changement de focus. Les trois ajustements d’interface ont été contrôlés après déploiement (section 10). Le correctif de contraste trouvé ensuite reste local.
- **API Vercel hors navigateur** : lot automatisé applicatif bloqué par la protection d’accès ; aucun bypass exécuté. La preuve Chrome des mutations citées reste valable et distincte.
- **Mail** : transport/délivrabilité réels non testés volontairement. Le défi parental a été provisionné via Supabase, puis sa saisie/validation a été testée dans Chrome.
- **Rétention et droits** : restauration des preuves, purge à échéance, suppression de compte, sauvegardes, journaux, exports et traitements différés. Aucun effacement d’une preuve immuable n’a été tenté en contournant ses protections.

Ces limites sont explicites ; aucune n’est comptée comme réussite de bout en bout.

## 6. SQL, fichiers et tests

### SQL

Le lot unique [`20261102_legal_campaign_repairs.sql`](../../supabase/migrations/20261102_legal_campaign_repairs.sql) a été appliqué par l’utilisateur et son résultat vérifié par le [postflight 25](25-campaign-fix-postflight.sql). **Ne pas le rejouer. Aucun nouveau lot SQL à appliquer n’est proposé par cette reprise.** Les migrations déjà appliquées restent intactes.

Le [préflight 24](24-campaign-fix-preflight.sql) et la [transaction 26](26-campaign-candidate-rollback.sql) documentent la phase antérieure. Le fichier 26 contient un candidat et d’anciennes fixtures : **ne pas le réexécuter sur l’état actuel**.

### Fichiers modifiés dans cette reprise

Le checkout était propre au départ, HEAD `5a53f7c`. Les corrections de la première phase avaient été committées et déployées par l’utilisateur.

- `components/legal/LegalAdminWorkspace.tsx` : protection pendant les sauvegardes et préservation du résumé au changement de langue.
- `app/legal/my/page.tsx` : distinction de l’état personnel et de la décision pour l’enfant.
- `tests/legal-admin-workspace.test.ts` : deux régressions de saisie Admin.
- `scripts/legal-campaign/context.mjs` : phase de reprise, chemins de preuves/manifeste isolés et origines autorisées.
- `business.mjs`, `event-edit.mjs`, `direct-read-checks.mjs`, `http-extra.mjs` : preuves distinctes de reprise, cinquième helper testé, restauration du score fictif après son test.
- `fixture-documents.mjs`, `deployed-integrity.mjs`, `deployed-final-checks.mjs` : provisionnement et tests explicitement distingués des routes HTTP.
- `cleanup.mjs` : contrôle de propriété des documents, désactivation et conservation des preuves fictives immuables.
- Ce rapport, les pointeurs README/readiness/matrice et les preuves `evidence/20261004-deployed-*` / captures `deployed-*`.

Aucun commit, push ou déploiement effectué par l’agent. Les deux fichiers applicatifs de la reprise du 4 octobre ont depuis été déployés par l’utilisateur dans `90f41d4`. Le contrôle du 5 octobre est détaillé en section 10.

### Contrôles locaux exécutés

```sh
node --experimental-strip-types --test tests/legal-*.test.ts tests/player-transactions.test.ts tests/coach-permissions.test.ts tests/manager-event-editor.test.ts tests/manager-groups.test.ts tests/golf-round-metrics.test.ts tests/manager-parents.test.ts tests/manager-camp-conflict.test.ts
npx tsc --noEmit --incremental false
npx eslint components/legal/LegalAdminWorkspace.tsx app/legal/my/page.tsx tests/legal-admin-workspace.test.ts scripts/legal-campaign/*.mjs
```

Résultat : **58/58 tests, TypeScript 0, ESLint 0**. [Journal des tests](evidence/20261004-deployed-local-tests.txt), [relevé des contrôles](evidence/20261004-deployed-local-checks.json). Pas de nouveau build de production : les changements locaux sont contrôlés par ces vérifications ciblées et ne sont pas présentés comme déployés.

## 7. Nettoyage final

Run `legalqa_20261004_9a282f` : clubs `efa61978-72ac-47f0-b0e4-0b692191c2bb` (A) et `e4e6fffc-7d98-4a32-a5aa-22b2e18f2c4a` (B), six comptes `example.invalid`, trois documents marqués sans valeur juridique. Les trois documents ont été activés uniquement pour les fixtures du club A pendant les essais, puis désactivés.

Les six comptes sont bannis, les appartenances inactives, le rôle Admin retiré, la représentation révoquée et le lien familial désactivé. Événement annulé, groupe/organisations inactifs, Marketplace inactive, objet privé supprimé. La session Chrome fictive a été déconnectée ; le viewport normal a été restauré ; la session réelle du domaine TEST n’a pas été utilisée pour les décisions. Les mots de passe/JWT temporaires ont été effacés du manifeste privé.

**État final relu :** `enabled=false`, **0 document actif**, 0 appartenance fictive active, 0 Admin fictif, 0 annonce fictive active, 0 ligne/objet privé restant ; **4 versions et 10 décisions fictives conservées**. Ces preuves sont identifiables par leurs documents et comptes jetables. Les protections d’immutabilité n’ont pas été désactivées pour les purger.

[Preuve du nettoyage](evidence/20261004-deployed-cleanup.json).

## 8. Décisions humaines et prochaine étape

1. Les ajustements Admin et parental sont maintenant validés sur TEST. Un correctif local supplémentaire ajoute un fond blanc à `/legal/my` pour lire les textes au-dessus de la photo globale ; le déployer lors du prochain envoi TEST. Le contrôle UI ne nécessitait aucun SQL ; le complément de couverture ultérieur prépare le lot unique `20261103` (section 11).
2. Faire approuver les textes/traductions et règles par rôle, âge, territoire, club et représentant ; distinguer contrat, notice et consentement facultatif.
3. Définir les effets du refus/retrait, les conflits entre représentants et les traitements qui doivent cesser ; achever leur couverture d’accès direct/indirect et leurs scénarios métier.
4. Arrêter conservation, purge, sauvegardes, preuves et demandes de droits, y compris le traitement ultérieur des traces fictives.
5. Autoriser séparément une future campagne d’activation isolée une fois ces choix implémentés ; garder les deux gardes désactivés jusque-là.
6. Traiter séparément App Store/Google Play et production. **Les résultats ci-dessus concernent TEST exclusivement.**

## 9. Historique de la première phase, conservé pour traçabilité

Avant l’application utilisateur du lot, le run `legalqa_20261004_673faa` avait produit 56 tests locaux réussis, 42 assertions SQL dans une transaction annulée, 94 refus de lecture privée et 20 états Chrome sans version active. Les échecs persistés étaient la résolution `digest`, l’exposition de cinq helpers, la lecture Marketplace étrangère/anonyme et le timeout d’un conflit d’événement. **Ces échecs décrivent l’ancien état de TEST ; ils sont résolus dans les scénarios de reprise ci-dessus.**

Les corrections déjà déployées incluent aussi la sérialisation JSON PostgREST des traductions, la comparaison du texte réellement relu, le filtrage d’applicabilité avant validation et la compatibilité des conflits `PT409`/`40001`.

Preuves historiques : [HTTP](evidence/20261004-http-results.json), [métier](evidence/20261004-business-results.json), [compléments](evidence/20261004-extra-results.json), [timeout événement](evidence/20261004-event-edit.json), [42 contrôles SQL annulés](evidence/20261004-candidate-rollback-results.json), [20 états Chrome](evidence/20261004-browser-results.json), [nettoyage initial](evidence/20261004-cleanup.json). La première clôture avait zéro version/décision ; la clôture actuelle en conserve quatre/dix, entièrement fictives.

## 10. Contrôle du déploiement des ajustements — 5 octobre 2026

**Périmètre limité aux trois corrections livrées.** Le checkout était propre, HEAD `90f41d46af688f4489d8ba74e00d4b50944db207`. Dans Chrome, Vercel affichait **Ready**, branche `test`, déploiement `DdB72FdcGYC8YYHC3tZDuzJSW1zV`, origine `https://nextee-2u5qfnis3-fabrice-joliats-projects.vercel.app`. Cette origine a permis une connexion fictive indépendante de la session réelle sur `test.activitee.golf`.

| Contrôle | Résultat |
|---|---|
| Résumé non sauvegardé conservé après FR → EN → DE → IT → FR, desktop | RÉUSSI |
| Champs et onglets désactivés pendant la sauvegarde, desktop | RÉUSSI, état transitoire capturé dans le DOM |
| Résumé conservé, champs de nouveau modifiables après sauvegarde, desktop | RÉUSSI |
| Même séquence de conservation sur mobile 393 × 852 | RÉUSSI |
| Verrouillage pendant sauvegarde sur mobile | RÉUSSI, état transitoire capturé |
| Réouverture des champs et résumé sauvegardé sur mobile | RÉUSSI, valeur relue dans Supabase |
| Carte parentale : état par enfant, distinct de « État pour moi », mobile | RÉUSSI |
| Même libellé et historique de l’enfant contenant l’autorisation fictive existante, desktop | RÉUSSI |
| Historique de l’enfant sur mobile | RÉUSSI |

**9 contrôles Chrome réussis**, sans débordement horizontal dans les états enregistrés. Les deux tests ciblés `tests/legal-admin-workspace.test.ts` passent sur le commit déployé. ESLint et `git diff --check` passent pour les changements du contrôle. Aucun nouveau test SQL de structure ni migration n’a été exécuté : les changements vérifiés sont applicatifs.

L’ouverture initiale a rencontré `ERR_NETWORK_CHANGED`. Quelques attentes de navigation ont expiré pendant le chargement ; les pages finales ont ensuite été chargées, les actions recontrôlées et leurs résultats capturés. Ces incidents de session ne sont pas transformés en défaut produit confirmé.

### Défaut visuel supplémentaire et correctif local

La capture mobile de `/legal/my` montre le texte superposé à la photo globale : le libellé est correct mais peu lisible. Un fond blanc a été ajouté **uniquement au conteneur principal de cette page**, dans `app/legal/my/page.tsx`. Vérification locale à 393 × 852 : fond calculé `rgb(255, 255, 255)`, aucun débordement ; capture inspectée. L’écran local ne contenait pas de document actif, les fixtures étant déjà nettoyées. **Ce correctif n’est pas déployé dans `90f41d4`.** Aucun autre code applicatif n’a été modifié pendant ce contrôle.

### Fixtures et retour à l’état initial

Seuls les anciens comptes fictifs Admin/Parent ont reçu des identifiants temporaires de test ; le compte enfant est resté banni. Les appartenances Parent/enfant, le lien fictif et l’assertion ont été temporairement rétablis pour consulter l’historique existant. Deux documents du club jetable A ont été temporairement actifs. Aucun document plateforme actif, nouvelle version, nouvelle décision ou courriel.

Après contrôle : documents inactifs, appartenance Parent/enfant inactive, assertion révoquée, lien désactivé, rôle Admin retiré, comptes réutilisés bannis, secrets effacés, sessions Chrome fictives déconnectées et viewport réinitialisé. Le résumé du brouillon a été restauré à sa valeur initiale. Deux écritures de revue de représentation fictive restent dans l’audit normal (réouverture/clôture), sans contournement d’immutabilité.

**État final : garde SQL false, zéro document actif ; toujours quatre versions et dix décisions fictives.** Le drapeau d’enforcement applicatif n’a pas été modifié. Aucune conclusion supplémentaire sur l’activation ou la production.

Preuves : [environnement et tests](evidence/20261005-ui-recheck-environment.json), [9 états Chrome](evidence/20261005-ui-recheck-browser.json), [persistance](evidence/20261005-ui-recheck-persistence.json), [nettoyage](evidence/20261005-ui-recheck-cleanup.json), [contraste local](evidence/20261005-ui-recheck-local-readability.json).

[Admin desktop](evidence/ui-recheck-admin-desktop.png) · [Admin mobile](evidence/ui-recheck-admin-mobile.png) · [Parent desktop](evidence/ui-recheck-parent-desktop.png) · [Parent mobile sur TEST](evidence/ui-recheck-parent-mobile.png) · [Fond de lecture corrigé localement](evidence/ui-recheck-local-readable-mobile.png).

Fichiers de cette vérification : `app/legal/my/page.tsx` (fond blanc local), `scripts/legal-campaign/ui-recheck.mjs` (provision/relecture/nettoyage bornés aux fixtures existantes), rapport et pointeurs README/readiness/matrice, preuves `20261005-ui-recheck-*` et captures `ui-recheck-*`. Aucun commit, push ou déploiement par l’agent.


## 11. Complément de couverture technique — 5 octobre 2026

### Environnement et limites d’intervention

Checkout `test`, base de code `90f41d46af688f4489d8ba74e00d4b50944db207`. Les changements de la section 10 étaient déjà présents avant cette phase. Dans Chrome, le projet a été recontrôlé comme **golf-juniors-app / test Preview / `wizbeuuvjibmmuxyynly`**. L’inventaire SQL en lecture seule du 5 octobre à 09:56:44 UTC contient 368 lignes : 223 fonctions, 138 relations, six buckets et l’état de contrôle. Il confirme quatre versions et dix décisions fictives, aucun document actif, garde false. Aucun déploiement plus récent que celui de la section 10 n’est revendiqué.

Aucune migration déjà appliquée n’a été rejouée. Le nouveau lot a été installé **uniquement à l’intérieur de transactions terminées par `ROLLBACK`**, avec les fixtures existantes du club A et l’identité fictive du club B. Le garde SQL est resté false même pendant ces essais ; aucun fichier de configuration ou drapeau réel n’a été activé. Aucun compte n’a été débanni, aucune connexion fictive supplémentaire nécessaire, aucun courriel, aucune publication ou décision juridique créée. La vérification finale retrouve les trois définitions originales et l’absence des quatre nouveaux helpers : **le lot reste à appliquer durablement**.

### Défauts, corrections et portée des preuves

| Cas | Constat et résultat |
|---|---|
| Ancienne RPC `staff_seed_group_players_attendees` | **Défaut reproduit en SQL TEST** : un head coach dont l’appartenance est inactive peut atteindre la mutation. Le correctif ajoute l’appartenance active Coach/Manager du club de l’événement, conserve les conditions de groupe existantes, ferme l’appel anonyme et ajoute le garde événement. Dans la transaction : inactif refusé, actif autorisé, répétition sans doublon, acteur du club B refusé. Contexte JWT fictif en SQL sous fonction definer ; ce n’est pas un nouvel essai de connexion PostgREST d’un utilisateur banni. Aucun appel à cette RPC trouvé dans le code applicatif actuel ; l’entrée reste pertinente pour un ancien client. |
| Métadonnées changées après publication | **Écart de logique démontré** : les RPC de présentation/décision vérifient déjà `legal_version_matches_document`, mais les gardes SQL/HTTP pouvaient encore satisfaire une ancienne acceptation. Les deux gardes vérifient maintenant la correspondance de la dernière version. Test HTTP serveur simulé : acceptation courante valide autorisée, métadonnées différentes refusées. La définition SQL est contrôlée, sans activer son branchement sur TEST. |
| Messagerie, documents joueur, événements, groupes, entraînements historiques, rapports et activités personnelles | **Lacunes de couverture structurelles**, pas des fuites interclubs automatiquement confirmées : certaines politiques permissives utilisent des propriétaires ou helpers definer et n’héritent donc pas du garde du parent. Le lot ajoute des conditions restrictives avec la portée réelle de la ligne, de l’événement, du groupe, du fil ou de l’entraînement. Elles ne confèrent aucun droit métier. |
| Golf/OM | Les sauvegardes RPC vérifient déjà `om_organization_id` ; création et tables directes utilisaient seulement la portée plateforme. Création, parties et trous sont alignés sur la même portée OM. `golf_rounds.club_id` n’est pas utilisé comme appartenance : c’est la référence de parcours. Les organisations historiques non assimilables à un club demandent encore une règle explicite. |
| API Règles, Étiquette, champs de profil de club | Les routes sont authentifiées et utilisent le service, mais étaient absentes du matcher et du filtre juridique. Elles sont ajoutées dans `proxy.ts` et `lib/legalRouteCoverage.ts`. Le garde reste conditionné au drapeau existant. Huit familles d’API sont exercées avec un ancien client simulé : 403 `LEGAL_ACTION_REQUIRED`, identité Bearer prioritaire sur le cookie, 401 sans identité valide, 503 si le contrôle échoue. |
| Cache HTTP et récupération d’accès | Réponses autorisées, refus et redirections du garde portent `no-store`. Les documents juridiques, décisions, demandes de droits, connexion et récupération restent hors du blocage. Le mode désactivé ne consulte pas l’état juridique. Ceci ne purge pas les données déjà affichées ou enregistrées sur un appareil. |
| Refus/retrait | Tests locaux : une décision requise refusée, retirée, en conflit ou sur une ancienne version ne suffit pas ; une décision facultative refusée/retirée/en conflit ne bloque pas globalement le compte. **L’arrêt effectif d’un traitement facultatif n’est pas implémenté sans sa correspondance à une finalité.** |

### Qualification des accès restants

La [revue actualisée des 367 objets](evidence/20261005-access-review.csv) conserve finalité, rôles, portée et appels indirects. Le [manifeste du lot](evidence/20261005-coverage-batch-manifest.json) nomme chacune des 37 politiques et sa portée. Les recherches textuelles servent à repérer les dépendances ; leur absence ne suffit pas à confirmer une faille.

- **58 relations métier de la revue initiale** : 35 reçoivent un garde dans le lot ; neuf héritent d’un parent contrôlé dans leurs branches non Admin ; dix exposent des catalogues pédagogiques publiés ; deux ne disposent que de politiques Admin ; deux concernent les notifications et restent ouvertes à une décision de finalité. Les deux politiques golf déjà présentes sont corrigées en plus de ces 35 ajouts.
- **Héritage qualifié** : feedback et rappels via événements, cibles d’actualité via actualités club, dossiers de saison via saisons, images Marketplace via annonces, actualités plateforme/traductions via ciblage club, groupes de participation et gagnants via leurs parents. Plusieurs parents reçoivent le nouveau garde seulement dans le lot candidat. Les branches Admin de Rules restent un choix d’applicabilité séparé.
- **Helpers indirects** : les prédicats de permissions qui lisent en definer ne sont pas traités comme des RPC de mutation ; les gardes sont placés sur les lignes et résolvent leur parent sans dépendre d’une lecture filtrée par RLS. Les cinq helpers internes fermés par `20261102` le sont toujours. Les triggers/traitements exécutés par le service ne sont pas couverts par une politique client restrictive.
- **Storage** : `storage.objects` a RLS mais aucune politique permissive dans l’inventaire ; les essais de la campagne ont refusé lecture/envoi directs privés. Les appels de signature de documents repérés sont dans les API Player/Coach couvertes. Les liens privés signés expirent après **15 minutes** (`PLAYER_DOCUMENT_SIGNED_URL_TTL_SECONDS`) ; un lien déjà distribué n’est pas revalidé à chaque téléchargement. Le fallback de documents historiques dans `marketplace` public doit être inventorié/migré avant de promettre la révocation de leur accès. Les cinq buckets publics ne deviennent pas privés grâce au garde. Aucune conversion de fichiers réels n’a été effectuée.
- **Anciens clients** : le service worker ne possède ni gestionnaire `fetch` ni cache de documents hors ligne. Le contrôle des API et des RPC ne dépend pas des nouveaux boutons ; les tests de refus HTTP sont toutefois **locaux avec états simulés**. Cache mémoire d’un onglet déjà ouvert, retour au premier plan, navigateur hors ligne et Capacitor avec document requis actif restent **non vérifiés**.

### Points encore ouverts avant toute activation

1. Associer chaque consentement facultatif/autorisation parentale à ses traitements : photos, IA, communications, etc. Définir refus/retrait, conflits de représentants, arrêt des tâches différées et sort des données déjà produites. Les tâches de notifications/push, rappels et rapports tournent avec le rôle de service : elles ne consultent pas automatiquement la projection juridique du destinataire.
2. Qualifier `notifications` / `notification_recipients`, les API avatar/push, les douze tables d’identité/bootstrap et les catalogues publiés. Les alertes de compte et de récupération doivent rester distinguées des communications facultatives ; aucune exemption juridique globale n’est déclarée approuvée.
3. Fixer le comportement d’un utilisateur appartenant à plusieurs clubs : le filtre HTTP actuel considère tous ses documents applicables, alors que le garde SQL vérifie plateforme + club de la ligne. Un refus propre à B peut donc bloquer l’interface globale d’un utilisateur aussi membre de A. Le cas déjà testé « utilisateur uniquement A, document uniquement B » passe ; le choix de navigation isolée A/B reste à implémenter après décision.
4. Aligner l’applicabilité personnelle Admin entre HTTP, RPC et tables ; définir la correspondance des organisations OM historiques (club, académie, canton, fédération). Les contrôles métier existants ne remplacent pas cette matrice juridique.
5. Décider de la durée acceptable d’accès aux URL signées, traiter les fichiers publics historiques et les données conservées sur un appareil. Ni un retrait ni une redirection n’effacent un contenu déjà reçu.
6. Après ces décisions et corrections, autoriser séparément une campagne d’enforcement sur un environnement isolé. Les **refus actifs de bout en bout en Chrome / PostgREST / Storage sur toutes les familles ne sont pas validés** par les tests actuels, puisque les deux gardes sont restés désactivés.

### Tests et preuves de cette phase

| Contrôle | Résultat |
|---|---|
| Préflight initial en lecture seule | **43/43** ; la version finale comprend 46 contrôles, rejoués dans les 53 contrôles finaux |
| Première transaction annulée | **52/52** ; conservée pour traçabilité, avant ajout des deux tables d’entraînements historiques |
| Transaction finale annulée | **55/55** : 50 contrôles de structure du lot + cinq scénarios/contrôles de fixtures |
| Retour à l’état initial et préflight final | **53/53** : définitions initiales, quatre helpers absents, garde false, zéro actif, six comptes bannis, appartenances inactives, groupe inactif, événement annulé, quatre versions/dix décisions |
| `node --experimental-strip-types --test tests/legal-*.test.ts` | **23/23**, sans accès réseau ; les états « garde actif » sont des objets de test et un environnement injecté dans le chargeur de modules |
| `npx tsc --noEmit`, ESLint ciblé, `git diff --check` | **RÉUSSIS** |
| Rejeu Chrome desktop/mobile avec le nouveau code déployé | **NON VÉRIFIÉ** : ce lot est local ; la section 10 reste la preuve du dernier déploiement UI |
| Activation / production / conformité juridique | **NON VÉRIFIÉES et non effectuées** |

Preuves : [inventaire TEST](evidence/20261005-coverage-inventory.json), [préflight initial](evidence/20261005-coverage-preflight.json), [premier essai annulé](evidence/20261005-coverage-rollback-initial.json), [55 contrôles finaux du lot annulé](evidence/20261005-coverage-rollback-final.json), [retour à l’état initial](evidence/20261005-coverage-final-state.json), [tests locaux et empreintes des fichiers](evidence/20261005-coverage-local-tests.json).

### Fichiers et livraison

**Code de cette phase** : `proxy.ts`, `lib/legalRouteCoverage.ts`, `lib/server/legalRequirements.ts` ; tests `legal-access-coverage.test.ts`, `legal-requirements.test.ts` et paramètre d’environnement isolé dans `tests/helpers/managerRouteHarness.ts`. Aucun composant Admin modifié dans cette phase. Le fond blanc de `/legal/my` appartient au contrôle précédent et reste à livrer avec le prochain déploiement.

**Lot SQL unique** : `supabase/migrations/20261103_legal_access_coverage.sql`. Préflight **26** et postflight **27** en lecture seule ; script **28** de reproduction intégralement annulée sur les anciennes fixtures ; contrôle final **29** en lecture seule. Le script 28 est une preuve de campagne avec IDs fictifs fixes, **pas une migration à appliquer**. Rapport, pointeurs et preuves actualisés.

**Prochaine livraison TEST** : exécuter 26, appliquer uniquement `20261103`, exécuter 27 (50 résultats vrais), puis déployer les changements applicatifs et rejouer les parcours touchés sur fixtures. Ne pas rejouer `20261020` à `20261102`, ni activer les gardes. Aucun commit, push ou déploiement n’a été fait par l’agent. Les décisions et travaux encore ouverts ci-dessus restent des prérequis à l’activation ; ce lot ne clôt pas à lui seul la préparation juridique.


## 12. Confirmation de l’application de `20261103` sur TEST

Après le retour utilisateur « les 50 résultats sont à true », l’éditeur SQL Chrome a été contrôlé sur **`wizbeuuvjibmmuxyynly`**, `golf-juniors-app / test Preview`. L’export complet confirme **50/50 résultats vrais** du postflight 27, dont garde désactivé, contrainte d’inactivité présente, zéro document actif, portées des 37 politiques, quatre résolveurs et contrôles de la RPC corrigée. **La migration n’a pas été rejouée par l’agent.**

Le script `30-applied-coverage-fixture-test.sql` exerce les fonctions désormais installées, sans embarquer de migration. Dans une transaction entièrement annulée, uniquement sur les anciens IDs `legalqa_20261004_9a282f` :

| Contrôle SQL, avec identité JWT fictive | Résultat |
|---|---|
| Coach inactif refusé par `staff_seed_group_players_attendees` | RÉUSSI |
| Coach actif autorisé, deuxième appel sans doublon | RÉUSSI |
| Acteur du club B refusé sur l’événement A | RÉUSSI |
| Quatre résolveurs de portée n’ajoutent aucun filtrage lorsque le garde est désactivé | RÉUSSI |

Les libellés `candidate_*` conservés dans l’export proviennent des mêmes scénarios de comparaison que la section 11 ; ils ont bien été rejoués ici sur les **fonctions installées**, sans remplacement de leur définition. Il s’agit de tests SQL de la fonction definer, pas de nouveaux parcours de connexion Chrome ou d’enforcement actif.

La relecture finale combine le postflight 27 et sept assertions de nettoyage : **57/57 résultats vrais**. Comptes fictifs toujours bannis, appartenances et groupe inactifs, événement annulé, rôle Admin fictif retiré ; toujours quatre versions et dix décisions fictives, aucun document actif, garde false. Aucun nouveau texte, décision, courriel, déblocage de compte ou modification durable de fixture.

Preuves : [50 résultats du lot appliqué](evidence/20261005-coverage-applied-postflight.json), [quatre scénarios sur les fonctions installées](evidence/20261005-coverage-applied-fixtures.json), [57 contrôles finaux](evidence/20261005-coverage-applied-final.json).

**Suite : déployer les modifications applicatives sur TEST.** Le checkout est encore sur `90f41d4` avec les modifications du lot non commitées ; aucun nouveau déploiement applicatif n’est validé dans cette phase. Les 23 tests locaux et le contrôle de types/lint de la section 11 restent la preuve du code préparé. Après le déploiement, contrôler les parcours concernés dans Chrome sur la version livrée. Ne plus appliquer `20261103`, ni les migrations précédentes. Ne pas exécuter les scripts historiques 28/29 conçus pour comparer au schéma avant application. Les choix et limites d’activation de la section 11 restent ouverts ; aucune conclusion sur la production.

## 13. Contrôle après déploiement de `2af721a` — 5 octobre 2026

### Déploiement identifié

Après la confirmation utilisateur du déploiement, Chrome authentifié affiche **Ready**, branche **test**, commit **`2af721ad29110da2f5502fa883949c66e435b203`**, déploiement **`8TsD6QEq7DyxRyg8g3cwbk7oZ1mc`**. Le checkout correspond et était propre au début du contrôle. Les essais utilisent son origine unique `https://nextee-or71byo11-fabrice-joliats-projects.vercel.app`, afin de séparer les comptes fictifs de la session utilisateur sur `test.activitee.golf`. Supabase est toujours **`wizbeuuvjibmmuxyynly`**. Aucune migration rejouée, aucun déploiement réalisé par l’agent.

### Résultats ciblés sur le code livré

**24 états chargés enregistrés dans Chrome**, desktop 1280 × 900 et mobile 393 × 852. Aucun débordement horizontal dans ces états. Il s’agit d’un contrôle de non-régression en lecture : les publications et décisions de la campagne précédente ne sont pas répétées.

| Parcours contrôlé | Résultat et portée |
|---|---|
| Player | Accueil desktop, Règles desktop/mobile (six fiches chargées), Étiquette mobile (trois fiches), profil mobile et historique juridique desktop/mobile : **RÉUSSIS**. Le club fictif ne comporte pas de champs personnalisés : leur écriture n’est pas retestée. |
| Parent | Accueil de l’enfant fictif desktop et historique personnel mobile : **RÉUSSIS**. Le lien familial autorise de nouveau temporairement la lecture ; l’assertion de représentation reste révoquée. Aucune nouvelle autorisation parentale ni émission de code. |
| Coach | Accueil mobile (groupe et junior fictifs), Règles mobile, Étiquette mobile/desktop, historique juridique desktop : **RÉUSSIS**. |
| Manager | Accueil desktop (club, quatre utilisateurs et groupe fictifs), Règles desktop/mobile, Étiquette mobile, historique juridique mobile : **RÉUSSIS**. |
| Admin | Document fictif `_ui` sélectionné ; éditeur et contenu FR/EN/DE/IT chargés sur desktop, retour FR et contrôle mobile : **RÉUSSIS**. Onglets, champs, marges et actions restent dans la présentation Admin existante. Aucun clic de sauvegarde, approbation ou publication. |
| Contraste de `/legal/my` | Fond calculé **`rgb(255, 255, 255)`**, historique fictif non vide lisible sur mobile et desktop : **CORRECTIF DÉPLOYÉ CONFIRMÉ**. |

**Huit lectures directes PostgREST réussies**, avec authentification ordinaire des comptes fictifs :

| Rôle / lecture précisément filtrée sur une fixture | Résultat |
|---|---|
| Manager → groupe A ; Coach → événement A | Une ligne chacun, aucune erreur |
| Player → message de son fil ; Player et Parent → partie de l’enfant | Une ligne chacun, aucune erreur |
| Player du club B → événement A et message du fil A | Zéro ligne, aucune donnée divulguée |
| Player du club B → annonce Marketplace A | Zéro ligne ; annonce demeurée inactive, ce cas seul ne prouve pas l’isolation d’une annonce active |

Ces lectures confirment le fonctionnement de ces accès avec le garde désactivé. Les contrôles SQL de la section 12 restent les preuves des RPC installées. Les mutations métier, Storage, publication/versionnement, refus/retrait et idempotence de la campagne complète conservent leurs preuves des sections précédentes ; elles n’ont pas toutes été rejouées sur ce commit. Aucun nouveau défaut applicatif confirmé dans ce contrôle ciblé.

### Nettoyage vérifié

Seuls les six comptes et relations de `legalqa_20261004_9a282f` ont été temporairement réouverts. Les sessions UI ont été déconnectées. Le nettoyage relit les appartenances, organisations, groupe, droits du lien parental et comptes : état initial restauré, aucune appartenance active, Admin fictif retiré, **six comptes bannis** et mots de passe temporaires remplacés. Le manifeste privé temporaire ne contient plus d’identifiants de connexion.

État final : **garde SQL false, zéro document actif, quatre versions et dix décisions fictives**, identiques au début du contrôle. Aucun texte juridique publié ou accepté, aucun courriel, aucune donnée personnelle réelle modifiée et aucun drapeau d’activation modifié pendant cette phase. Le compte-rendu ne prétend pas avoir purgé instantanément les JWT déjà émis ; la déconnexion, le retrait des droits et le bannissement ferment les fixtures sans changer la configuration d’authentification du projet.

### Preuves, fichiers et suite

Preuves : [déploiement](evidence/20261005-deployment-recheck-environment.json), [état initial](evidence/20261005-deployment-recheck-setup.json), [24 états Chrome](evidence/20261005-deployment-recheck-browser.json), [huit lectures directes](evidence/20261005-deployment-recheck-direct.json), [nettoyage et état final](evidence/20261005-deployment-recheck-cleanup.json).

Captures inspectées : [éditeur Admin desktop](evidence/deployment-recheck-admin-desktop.png), [éditeur Admin mobile](evidence/deployment-recheck-admin-mobile.png), [historique juridique mobile](evidence/deployment-recheck-legal-mobile.png).

Fichiers de cette phase : `scripts/legal-campaign/deployment-recheck.mjs`, ce rapport, les pointeurs README/readiness/matrice et les huit fichiers de preuves ci-dessus. **Aucun code applicatif ni SQL modifié ; aucun nouveau lot SQL à appliquer.** Le script cible exclusivement les anciennes fixtures vérifiées et refuse tout autre projet. Les modes `setup`, `direct` et `cleanup` ont terminé sans erreur ; les huit résultats sont vrais. Vérification syntaxique Node, ESLint ciblé et `git diff --check` exécutés après nettoyage. Les 23 tests applicatifs précédents ne sont pas relancés pour ces seuls ajouts de preuves et de documentation.

**La livraison technique de ce lot sur TEST est contrôlée.** La prochaine étape est de trancher les six points de la section 11 : finalités et effets des refus/retraits, notifications et exemptions, utilisateurs multi-clubs, applicabilité Admin/OM, fichiers publics/URL signées/cache, puis campagne avec blocage actif sur une base isolée explicitement autorisée. Textes, traductions, règles d’applicabilité et conservation demandent une revue humaine. Le blocage juridique actif de bout en bout, la conformité juridique/Store et la production restent **NON VÉRIFIÉS** ; aucune activation n’est recommandée à ce stade.

## 14. Préparation des arbitrages et textes — 5 octobre 2026

### Informations confirmées et propositions

À la suite du contrôle de déploiement, l’utilisateur a demandé de poursuivre la préparation. Il confirme **clubs suisses uniquement au lancement**, et **ActiviTee — Fabrice Joliat** comme exploitant déclaré. À cette étape, l’adresse, le pays d’établissement, la forme juridique et le contact pour les données restaient à confirmer ; la réponse ultérieure est consignée en section 17. La répartition des responsabilités entre exploitant et clubs ne découle pas de ce seul nom.

Les documents existants ont été complétés, sans créer un deuxième rapport de campagne :

- [Décisions D1–D6, parcours, finalités, conservation et onze scénarios de recette](decisions.md#proposition-concrète-du-5-octobre-2026--à-arbitrer). Proposition : CGU selon capacité, notices informatives, accompagnement des mineurs, options séparées, refus par club et retraits par finalité. **Arbitrage produit demandé à l’utilisateur, en attente à la rédaction.** Aucune de ces propositions n’est réputée approuvée juridiquement.
- [Brouillons FR adaptés au lancement suisse](drafts.md#version-de-travail-fr-du-5-octobre--lancement-suisse) : autorisation parentale, notice junior, fiche d’information et libellés. Les inconnues sont indiquées et empêchent une publication en l’état ; les traductions seront préparées après stabilisation du texte source.
- [Relecture des exigences Store](stores.md#relecture-officielle-du-5-octobre-2026--lancement-suisse), avec sources officielles actuelles. La préparation ne remplace ni l’inventaire du binaire ni une procédure effective de suppression.

### Écarts précisés par lecture du code

Le moteur exécutable actuel ne distingue pas encore la capacité ou le pays ; l’option facultative n’arrête pas un traitement par sa seule clé de finalité ; le HTTP et SQL n’ont pas la même portée multi-clubs ; l’autorisation parentale et le consentement historique restent deux mécanismes à raccorder explicitement. Le parcours utilisateur n’expose le bouton de retrait que pour les consentements spécifiques. Ces points sont désormais associés à des comportements proposés et des critères de recette, sans les présenter comme développés.

L’appel IA individuel transmet l’identifiant, le nom et le commentaire source du joueur ; il contrôle une option club/coach, sans prouver un accord du bénéficiaire. Les rapports revalident les liens et le statut historique, sans projection juridique versionnée. Les URL privées restent valables quinze minutes ; le fallback de documents publics doit être traité selon la politique choisie.

**Candidat d’accès à traiter en priorité dans la revue notifications** : le chemin de `/api/push/dispatch` reçoit ses destinataires du client et la vérification d’une notification est conditionnelle. La politique historique d’ajout de destinataires repose sur l’auteur de la notification. Il faut terminer la qualification des sources et droits métier, reproduire sans transport réseau puis corriger de façon cohérente API et écritures directes si l’écart est confirmé. Aucun véritable envoi ni test d’exploitation sur TEST n’a été effectué ; cela ne devient pas un scénario de sécurité réussi.

### Vérification et état de livraison

Cette phase modifie seulement `docs/legal/decisions.md`, `drafts.md`, `stores.md`, ce rapport et les pointeurs README/readiness/matrice. La préparation s’appuie sur les fichiers du commit `2af721a`, les preuves de campagne déjà enregistrées et les sources officielles PFPDT, SECO, Commission européenne, CNIL, Apple et Google citées dans les documents. Pas de nouvelle lecture de données personnelles, connexion de fixture, requête TEST, publication, courriel, migration ou activation.

Les modifications et preuves non commitées de la section 13 étaient déjà présentes et ont été préservées. Vérifications de cette phase : cohérence des liens locaux et `git diff --check`. Aucun test applicatif relancé pour ces modifications documentaires. **Aucun nouveau lot SQL à appliquer maintenant.** Une fois les choix produit arbitrés, préparer le lot cohérent décrit dans decisions.md ; les textes, responsabilités, capacité et durées exigent toujours leur revue humaine avant activation. Aucune conclusion nouvelle sur la production.


## 15. Comptes créés par le club — précision utilisateur et alignement local

**Règle confirmée par l’utilisateur : seul le club crée les comptes Junior, Parent et Coach.** Aucun de ces utilisateurs ne s’inscrit librement après téléchargement. L’invitation donne accès à un compte déjà créé. Cette précision ne vaut pas validation globale des autres arbitrages D1–D6.

`decisions.md`, `drafts.md` et `stores.md` intègrent ce modèle. Les textes parlent de première connexion au compte attribué ; la création par le club ne génère aucune acceptation juridique au nom d’une autre personne. L’information doit aussi couvrir la collecte préalable par le club. L’obligation de suppression propre aux Stores reste à qualifier sur les surfaces réellement accessibles, dont les fonctions Manager, sans déduire une exemption de la seule absence d’inscription Junior/Parent/Coach.

### Vérification ciblée

- Le chemin de création club utilise `auth.admin.createUser` après `requireManagerClub` ; la création d’un Manager dans l’administration plateforme vérifie `app_admins`. Le reset d’invitation modifie le compte existant via `updateUserById`.
- L’ancien écran `app/auth-test/page.tsx` contenait un formulaire client appelant `auth.signUp`. Il est remplacé **localement** par une redirection serveur vers `/`. Le renvoi textuel de `app/clubs/page.tsx` est aligné.
- `supabase/config.toml` autorisait les inscriptions locales au niveau Auth et e-mail ; les deux options sont maintenant false. Ce fichier ne modifie pas les réglages du projet hébergé.
- Une lecture de `/auth/v1/settings`, après vérification stricte du domaine TEST `wizbeuuvjibmmuxyynly.supabase.co`, a retourné **`disable_signup=false`**. Le fournisseur Auth autorise donc encore l’inscription publique dans sa configuration distante. Aucun compte n’a été créé pour essayer, aucune appartenance ou lecture de données de club n’est démontrée par ce seul réglage.

Preuve minimale sans secret : [contrôle du provisioning](evidence/20261005-club-provisioning-review.json). **Réglage distant à corriger : désactiver Allow new users to sign up sur TEST** ; il concerne le projet entier, hors fixtures, et n’a pas été changé pendant cette vérification. Aucun réglage de production consulté ou modifié.

### Livraison et limites

Fichiers applicatifs/configuration changés : `app/auth-test/page.tsx`, `app/clubs/page.tsx`, `supabase/config.toml`. Documents changés dans cette phase : règles, brouillons, Stores, rapport, pointeur README et preuve ci-dessus. Aucun SQL ni drapeau juridique modifié.

`npx tsc --noEmit`, ESLint des deux pages et `git diff --check` : **réussis**. Aucun appel `auth.signUp` ne subsiste dans les sources app/lib/components examinées. Ces vérifications ne prouvent pas encore le refus d’inscription distante, la redirection dans le déploiement ni une création Manager après fermeture du réglage distant. Les corrections sont non commitées et non déployées ; les changements préexistants ont été préservés.


## 16. Fermeture des inscriptions publiques sur TEST — 5 octobre 2026

Autorisation explicite reçue : **Oui, fermer les inscriptions publiques sur TEST**. Projet revérifié dans Chrome : `golf-juniors-app`, branche `test Preview`, référence `wizbeuuvjibmmuxyynly`.

Dans **Authentication → Sign In / Providers → User Signups**, seul **Allow new users to sign up** a été désactivé puis enregistré. La navigation vers la liste des utilisateurs a été refusée par la revue automatique car inutile à ce réglage ; le contrôle a continué directement dans les paramètres Auth, sans consulter la liste de comptes.

Vérifications réussies :

- Interrupteur désactivé après sauvegarde, puis après rechargement de la page.
- Relecture indépendante de `GET /auth/v1/settings` : **`disable_signup=true`**.
- Aucun compte créé, aucune tentative d’inscription, aucun courriel, aucune modification des drapeaux juridiques, aucune opération sur la production.

Preuves : [réglage relu par API](evidence/20261005-test-signups-disabled.json), [capture du tableau de bord TEST](evidence/test-signups-disabled.png). L’onglet de contrôle a été fermé ; l’éditeur SQL utilisateur et ses requêtes n’ont pas été modifiés.

**Le réglage distant demandé est effectif.** Les corrections locales `/auth-test`, `/clubs` et `supabase/config.toml` de la section 15 restent non commitées/non déployées. Cette phase ne prétend pas retester une connexion existante, la création Manager ou une tentative réelle d’inscription : elle prouve le réglage enregistré. Aucun lot SQL à appliquer. Rapport et pointeurs corrigés ; `git diff --check` réussi.

## 17. Accord éditorial et suite — 5 octobre 2026

L’utilisateur indique que les brouillons proposés lui conviennent. Cet accord est enregistré dans `drafts.md` et `decisions.md` comme choix de la base rédactionnelle, sans acceptation juridique dans l’application, publication ni activation. Il ne clôt pas les arbitrages D1–D6 et les écarts techniques de la section 14.

Ordre de travail proposé :

1. Intégrer l’identité et les coordonnées de l’exploitant (réponse reçue et intégrée ci-dessous), finaliser les CGU et la notice sur les pratiques effectives, puis stabiliser la source FR avec revue humaine.
2. Arrêter les règles produit restantes et développer les effets manquants : applicabilité selon l’âge et le rôle, portée par club, autorisation parentale, refus/retrait et arrêt des usages facultatifs concernés. Préparer un lot SQL cohérent seulement si nécessaire.
3. Préparer EN/DE/IT depuis la source FR stabilisée et faire relire les quatre versions liées à la même révision source.
4. Exécuter la recette des parcours et effets de bout en bout avec fixtures sur un environnement isolé autorisé. L’activation sur TEST puis toute opération de production feront l’objet de décisions distinctes.

**Réponse reçue le 5 octobre et intégrée :** Fabrice Joliat exploite ActiviTee **en nom propre**, à **Chemin de la Pavya 22, 1965 Savièse, Suisse**. Le contact confirmé pour les demandes concernant les données personnelles est **info@activitee.golf**. Ces informations remplacent les champs correspondants dans les brouillons et le registre des décisions. Le contact relatif aux données n’est pas présenté comme un service de modération ou un délégué à la protection des données. Les autres inconnues (responsabilités, prestataires, conservation notamment) restent répertoriées dans les documents existants.

Cette étape modifie uniquement ces trois documents locaux. Aucun nouveau contrôle distant ni test applicatif ; vérification documentaire par `git diff --check`. Les résultats TEST précédents et leurs limites restent inchangés ; aucune conclusion de conformité ou de production.

## 18. Rédaction FR r2, responsabilités et conservation — 5 octobre 2026

L’utilisateur demande de poursuivre la rédaction et confirme **le club paie, aucun abonnement individuel au lancement**. La révision documentaire `FR-2026-10-05-r2` est préparée dans `drafts.md` : notice en dix rubriques et CGU en dix rubriques, coordonnées confirmées, séparation contrat club/utilisateur/autorisation parentale, rôles, usages IA, stockage local, demandes de droits et gestion des versions. Cette révision n’est pas une version du registre en base ; les clauses nouvellement rédigées ne sont pas couvertes automatiquement par l’accord éditorial antérieur.

`decisions.md`, section 7, contient la répartition proposée des responsabilités, les éléments de l’annexe contractuelle à convenir avec chaque club, un inventaire des usages techniques avec leurs fichiers sources, une grille de conservation et un circuit de traitement des demandes. Les délais chiffrés de travail sont identifiés comme **propositions non adoptées**. Les preuves juridiques, demandes et sauvegardes conservent des points ouverts explicites plutôt qu’un délai légal universel inventé.

### Vérifications de contenu et limites

- Relus dans le code : création par Admin API sous contrôle de club, accès parent, rapports, assistance coach, traduction administrative, transports de courriel et de notification, Marketplace, sessions/caches, documents et formulaire de droits.
- La rédaction explique les notes privées et identifiants transmis aux fonctions IA ; elle ne promet ni anonymisation ni absence contractuelle de conservation sur la seule base de `store:false`.
- Correction d’une formulation trop large : la traduction reçoit le gabarit non rendu, mais aussi les coordonnées de l’exploitant qu’il contient. Aucune requête de traduction n’a été envoyée dans cette préparation.
- Durées techniques distinguées des purges : code parental 10 min au maximum, présentation 30 min, lien signé 15 min, invitation 7 jours, validité du cache Hero 10 min. L’expiration d’un accès ou d’une vue ne prouve pas l’effacement physique de ses données.
- Les clés Hero ne figurent pas dans le nettoyage explicite de `AuthSessionBoundary`. Ce constat justifie un contrôle ciblé de stockage local dans la recette ; il n’est pas présenté comme une divulgation intercomptes reproduite.
- Les sources officielles PFPDT (information, sous-traitance, transferts, accès et droits) et SECO (CGU et contrats) ont été relues. La répartition effective des responsabilités, les règles applicables aux mineurs, les clauses, durées et traitements sensibles demandent leur revue humaine.

**Fichiers modifiés dans cette phase :** `docs/legal/drafts.md`, `decisions.md`, `README.md`, `batch-readiness.md` et ce rapport. Les autres changements locaux ont été préservés. Pas de modification applicative/SQL/configuration, migration, accès à des données personnelles en base, courriel, acceptation, publication ou activation dans cette phase. Les deux drapeaux juridiques n’ont pas été modifiés ; aucun nouveau contrôle distant de leur état n’est revendiqué.

**Vérifications :** `git diff --check`, liens locaux/ancres et chemins du code cités, unicité des rubriques, variables de gabarit et taille des deux textes au regard du plafond de la route de traduction. Ce sont des vérifications documentaires, pas de nouveaux scénarios métier réussis sur TEST. Les tests applicatifs ne sont pas relancés pour cette rédaction. Aucun lot SQL nouveau à appliquer, aucun commit ou déploiement.

**Suite :** relecture de la révision r2 et arbitrage des propositions ; collecte des contrats/paramètres propres aux prestataires (entités, pays, garanties, journaux et sauvegardes) ; finalisation FR avec revue juridique, puis traduction/relecture EN/DE/IT et développement des écarts identifiés. Aucune conclusion nouvelle sur les Stores ou la production.

## 19. Finalisation FR r3 et lecture des réglages fournisseurs — 5 octobre 2026

### Mandat et réponses intégrées

L’utilisateur confie la finalisation des annotations rédactionnelles. Il confirme que **Fabrice Joliat suit l’assistance et les signalements à info@activitee.golf**, que la Marketplace assure une **mise en relation sans paiement dans l’application ni commission, avec intervention d’un représentant pour un mineur**, et que le lancement prévoit **l’IA facultative, sans marketing ni publication publique de photos de personnes**.

Après demande motivée, il autorise expressément la **lecture seule des réglages d’hébergement et de conservation de Supabase et Vercel en production**, puis ouvre OpenAI et Brevo pour lire leurs réglages manquants. Cette extension ne permet ni lecture des données de membres, ni modification des comptes fournisseurs, ni validation de parcours en production.

### Résultats et preuves

| Vérification | Résultat | Preuve / portée |
|---|---|---|
| Annotations éditoriales FR | Remplacées dans `FR-2026-10-05-r3` ; variables serveur conservées | [Textes](drafts.md) : autorisation enfant/club, notice junior, notice complète, CGU et option IA. Préparation locale pour revue, pas publication. |
| Supabase TEST et production | Région primaire Irlande, `eu-west-1`, sur les deux projets | [Relevé des réglages](evidence/20261005-hosting-settings-readonly.json) ; références et branches consignées. |
| Sauvegardes production | Dates visibles du 28 septembre au 5 octobre ; PITR non activé ; objets Storage exclus des sauvegardes de base | Écran de réglages seulement ; durée de toutes les copies non démontrée. |
| Vercel `nextee` | Fonction région `iad1` sélectionnée, États-Unis ; aucun Log Drain associé | Réglage du projet ; pas preuve de chaque déploiement ni d’absence de logs. |
| OpenAI projet `ActiviTee` | `Global`, `Standard Retention` | **Prérequis Zero Data Retention non satisfait sur le projet observé** ; association avec les clés déployées non vérifiée. Aucun prompt ni secret consulté. |
| Brevo `ActiviTee` | Logs pour tous les expéditeurs : un mois ; nouveaux aperçus non conservés | Réglages sélectionnés lus sans sauvegarde ; anciens aperçus non inspectés. |
| Contrats et pays de tous les accès/sous-traitants | Non vérifiés pour les comptes | Les sources publiques et la région primaire ne prouvent pas les accords conclus ni toute la chaîne de traitement. |
| Mise en œuvre des nouvelles clauses | Non vérifiée / développement restant | Aucun nouvel essai métier dans cette phase ; conservation, droits, âge, portée, refus/retrait et IA demeurent des cibles à implémenter ou compléter. |

### Rédaction et limites précises

Les annotations entre crochets ne subsistent plus dans les textes utilisateurs. L’identité, les rôles, les frais, les contacts, le fonctionnement Marketplace et les usages facultatifs sont renseignés. Le retrait est décrit par demande au club ou à l’exploitant, sans promettre un bouton parental autonome. La politique C7 retient des durées de travail sous la délégation rédactionnelle ; elles ne sont pas présentées comme des délais légaux universels ou des purges déjà actives. Les preuves utilisent un critère de conservation justifiée et réexaminée, à qualifier juridiquement par catégorie.

L’information C6 indique les configurations observées et distingue hébergement de base, exécution applicative, courriels et IA. La liste complète des pays d’accès et des garanties contractuelles doit encore être établie avant publication ; elle n’est pas inventée pour faire disparaître une annotation. Les prérequis sont visibles à la fin du brouillon et dans [decisions.md, section 8](decisions.md#8-finalisation-fr-r3-et-réglages-vérifiés--5-octobre-2026).

**Point IA prioritaire :** la documentation officielle exige Zero Data Retention pour les données personnelles des enfants sous 13 ans ou sous l’âge applicable de consentement numérique visé. Le projet ActiviTee observé affiche Standard Retention. Avant tout usage sur les enfants concernés, résoudre ce dispositif ou empêcher ces envois, puis contrôler les décisions et leur retrait avant l’appel. `store:false`, l’action d’un coach adulte et une autorisation parentale ne remplacent pas ce prérequis. [Documentation OpenAI](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance). Aucun réglage ou contrôle IA n’a été modifié ici ; ce rapport n’atteste pas un blocage technique effectif.

### Livraison et contrôles

Fichiers modifiés dans cette phase : `docs/legal/drafts.md`, `decisions.md`, `README.md`, `batch-readiness.md`, ce rapport et le nouveau relevé `evidence/20261005-hosting-settings-readonly.json`. Les modifications applicatives et preuves antérieures sont préservées.

Contrôles documentaires réussis : `git diff --check`, JSON du relevé valide, **84 liens locaux/ancres valides**, **zéro annotation éditoriale entre crochets**, variables limitées à `child_name` et `club_name`. Longueurs UTF-16 des sections A/B/C/D/IA : 2 216 / 2 104 / 15 867 / 10 046 / 1 765 caractères. Leur projection dans une enveloppe JSON de traduction (titre, corps, action, révision et statut) reste sous 20 000 caractères ; ce n’est pas un import ni un appel de traduction. Les résultats de ce contrôle ne constituent pas des scénarios métier TEST supplémentaires. Aucun test applicatif, transport réel, traduction externe, migration, modification SQL/configuration distante, commit ou déploiement dans cette phase. Les drapeaux juridiques sont laissés inchangés ; leur état n’est pas relu ni réaffirmé comme un nouveau constat.

**Aucun lot SQL à appliquer maintenant.** Prochaine étape : résoudre le dispositif IA et les accords fournisseurs, préparer le lot applicatif cohérent pour les effets encore manquants, faire revoir le droit/capacité et les durées, puis traduire et tester les quatre langues. Publication et activation restent des étapes séparées. Les résultats TEST précédents restent ceux des sections 11–13 ; les lectures de configuration en production ne permettent aucune conclusion sur ses parcours juridiques ni une déclaration de conformité juridique ou Store.

## 20. Correctif local des usages IA — 5 octobre 2026

L’utilisateur demande de poursuivre. Le lot traite l’écart confirmé dans les deux chemins d’appel OpenAI du coaching : l’option club/coach suffisait, sans décision juridique du bénéficiaire. La traduction administrative et les autres fonctions ne sont pas assimilées à ce traitement. **Modifications locales uniquement, non commitées/non déployées.** Aucune consultation ou mutation distante, acceptation réelle ou activation pendant cette étape.

### Corrections

- Nouveau contrôle `lib/server/coachAiAuthorization.ts` : âge calculé à partir de `profiles.birth_date` selon le calendrier suisse ; dates inconnues/invalides et moins de 18 ans refusés temporairement. Un adulte nécessite une adhésion Player active et une décision personnelle pour le document facultatif `coaching.ai` du club. La dernière version, les métadonnées publiées, l’absence de conflit, la source de preuve et la majorité lors de la décision sont contrôlées. Aucun document, plusieurs documents ambigus, état ancien, retrait, import historique ou erreur de base n’autorisent un envoi.
- Les deux routes IA recontrôlent événement, club/groupe, accès coach, option individuelle, participant et décision avant transport puis avant restitution. Les préparations recontrôlent aussi avant écriture du cache. Le changement de décision pendant l’appel entraîne le rejet du résultat.
- L’empreinte du cache et des accusés de lecture inclut la décision et sa version. Les anciens caches sont inéligibles ; un réaccord ne récupère pas les résultats liés à une ancienne décision. Le calcul du calendrier n’affiche pas une préparation à faire pour un joueur sans accord ; une indisponibilité du registre facultatif ne doit pas casser le calendrier manuel.
- Requêtes minimisées : suppression du nom de profil, des UUID, identifiants de notes/événements et horodatages ajoutés automatiquement. Le serveur conserve le rattachement au joueur ; le fournisseur reçoit le texte sélectionné et, pour la préparation, l’ordre des séances. **Le texte libre n’est pas anonymisé.** Les erreurs du fournisseur ne sont plus retransmises brutes.
- Message d’indisponibilité IA en FR/EN/DE/IT et distinction entre joueur exclu de l’IA et absence de note exploitable. Les routes de saisie manuelle restent indépendantes de cette autorisation facultative.

Le refus des moins de 18 ans est une mesure conservatoire de ce lot, pas une règle universelle de droit suisse ni une affirmation que la politique OpenAI vise tous les mineurs de la même manière. Le dispositif fournisseur et le parcours parental restent à résoudre avant leur ouverture. La fiabilité de l’âge enregistré n’est pas une vérification d’identité ou de capacité démontrée.

### Tests et portée des preuves

La suite ciblée exécute **64 tests réussis**, dont les scénarios de refus, retrait, changement de version, séparation de clubs, ancien accord parental, métadonnées modifiées, erreur du registre, absence de transport, retour après retrait, cache et accusés de lecture. Bases et transport sont simulés avec données fictives ; aucune requête OpenAI n’est envoyée. Commande :

```sh
node --experimental-strip-types --test tests/coach-ai-authorization.test.ts tests/coachAiAssistance.test.ts tests/coachPreparationInsights.test.ts tests/coach-activity-workflow.test.ts tests/coachDebrief.test.ts
```

`npx tsc --noEmit` : réussi. ESLint ciblé serveur/lib/tests : sans erreur ni avertissement. La page Coach modifiée conserve quatorze avertissements préexistants (symboles inutilisés, image et dépendance de hook), sans erreur. `git diff --check` : réussi. Les fixtures des anciennes préparations ont été enrichies avec l’accord adulte explicite ; deux assertions UI obsolètes sur du français codé en dur et l’assertion d’UUID envoyé au fournisseur ont été alignées sur les traductions et la minimisation.

**Non vérifiés dans ce lot :** build Vercel, déploiement, Chrome desktop/mobile et états persistés sur TEST ; transport fournisseur réel ; validation juridique ; consentement ou ZDR pour mineurs. Aucun résultat de cette suite ne doit être présenté comme une nouvelle recette distante. Les requêtes déjà parties et les copies déjà reçues ne peuvent pas être rappelées ; les relectures avant/après transport ne constituent pas une transaction atomique avec le fournisseur. Une ancienne copie de cache peut encore rester en base sans être retournée : sa purge relève du lot conservation.

### Accès directs, fichiers et suite

Les migrations `20260926_add_coach_training_preparation_insights.sql` et `20261007_coach_preparation_reads.sql` révoquent les droits clients et réservent ces tables au service ; aucune permission directe n’est ajoutée par ce lot. La relecture des migrations ne remplace pas un postflight de privilèges du déploiement. Les autres candidats notifications/fichiers publics et écarts de portée recensés auparavant restent ouverts. **Aucun nouveau lot SQL à appliquer.**

Fichiers applicatifs du lot : `lib/server/coachAiAuthorization.ts` (nouveau), `coachPreparationSources.ts`, `coachPreparationStatus.ts`, les routes `debrief/analyze-player`, `preparation-insights`, `preparation-seen`, la page Coach d’activité, `lib/coachUiErrors.ts` et `lib/i18n/coachMessages.ts`. Tests : nouveau `coach-ai-authorization.test.ts`, adaptations `coach-activity-workflow.test.ts`, `coachAiAssistance.test.ts`, `coachDebrief.test.ts`. Documentation : ce rapport, `decisions.md`, `drafts.md` r4, README et readiness. Les autres changements déjà présents sont préservés.

Suite concrète : déployer ce code sur **TEST**, vérifier que les aides IA sont refusées sans document/décision valables et que la saisie manuelle reste utilisable, puis poursuivre retraits, droits et conservation. Le registre étant sans document actif lors du dernier contrôle, le refus général du coaching IA serait le comportement attendu après déploiement si cet état demeure. Aucun des deux drapeaux juridiques ne doit être activé pour essayer ce lot. Les textes réels restent non publiés ; aucune conclusion sur la production.
