# Décisions et matrice de traitements à valider

**État courant : voir les sections 8–9, source FR-2026-10-05-r4 et recette IA TEST du rapport, section 21.** Les sections 1–7 conservent la préparation et ses arbitrages antérieurs. Les informations établies, les choix rédactionnels confiés par l’utilisateur et les limites encore ouvertes sont distingués des corrections non déployées ; ils ne constituent pas une validation juridique. La matrice initiale ci-dessous reste un inventaire historique, sans base juridique certifiée.

| Finalité repérée dans le code | Données | Acteurs/destinataires à confirmer | Base envisagée à arbitrer | Conservation/transfert à renseigner |
|---|---|---|---|---|
| Compte, authentification, famille, clubs | Identité, coordonnées, liens familiaux, identifiants | Exploitant, club, fournisseur Auth | Contrat/obligation/intérêt/consentement selon relation et juridiction | **À renseigner** |
| Activités et suivi sportif | Inscriptions, présence, scores, évaluations | Club, coach, représentant, exploitant selon rôle | **À arbitrer** | **À renseigner** |
| Messagerie et notifications | Contenu, destinataires, jetons de notification | Utilisateurs autorisés, prestataires d'envoi | **À arbitrer** ; permission système distincte | **À renseigner** |
| Photos, avatars et documents | Image, fichiers et métadonnées | Club, membres autorisés, hébergeur | Diffusion externe à traiter séparément ; autres bases **à arbitrer** | **À renseigner** |
| Santé ou besoins particuliers éventuels | Champs personnalisés et pièces potentiellement sensibles | Club/coach autorisés **à vérifier** | Traitement sensible **à examiner spécifiquement** | **À renseigner** |
| Assistance IA | Prompts et contexte transmis par les fonctions effectives | Fournisseur IA et exploitant **à inventorier** | **À arbitrer** ; minimisation et destinataires à vérifier | **À renseigner** |
| Mesure d'usage et SDK | Traceurs, diagnostics et identifiants éventuels | Prestataires SDK **à inventorier** | **À arbitrer** avec règles ePrivacy/plateformes | **À renseigner** |
| Preuves juridiques et demandes de droits | Texte présenté, décisions, acteur/bénéficiaire, e-mail haché du défi | Personnel autorisé, hébergeur | Obligation/intérêt de preuve **à valider** | **À définir**, pas d'illimité automatique |

Décisions restant requises avant activation : répartition des responsabilités par finalité avec les clubs ; règles versionnées de capacité contractuelle et de représentation pour le lancement auprès des clubs suisses ; conditions d'article 8 RGPD si la base est le consentement ; capacité de discernement en Suisse ; données sensibles ; prestataires, sous-traitance et transferts ; durées/purge ; procédure de droits et vérification d'identité ; analyse d'impact si nécessaire ; gestion des retraits et des parents en conflit ; formulation FR/EN/DE/IT et approbation humaine. L’identité, les coordonnées de l’exploitant et le périmètre de lancement sont confirmés ci-dessous.

Sources officielles consultées le 4 octobre 2026 : [PFPDT](https://www.edoeb.admin.ch/fr/devoir-dinformer), [Commission européenne](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_fr), [CNIL](https://www.cnil.fr/fr/les-bases-legales/consentement), [CEPD](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_fr). Une revue juridique reste nécessaire.

## Proposition concrète du 5 octobre 2026 — à arbitrer

**Statut historique de la première proposition : accord éditorial sur les brouillons FR ; propositions produit D1–D6 encore à arbitrer, aucune décision juridique approuvée.** L’utilisateur a ensuite confié la finalisation des textes : la section 8 précise ce qui a été retenu pour la rédaction r3 et ce qui reste à développer/revoir. Aucune publication ou activation des gardes n’est autorisée par cet accord. Le déploiement `2af721a` et le bilan TEST sont décrits dans le [rapport unique, section 13](campaign-report-2026-10-04.md#13-contrôle-après-déploiement-de-2af721a--5-octobre-2026).

Renseignements confirmés par l’utilisateur le 5 octobre : **clubs suisses uniquement au lancement** ; **ActiviTee exploité par Fabrice Joliat en nom propre** ; adresse **Chemin de la Pavya 22, 1965 Savièse, Suisse** ; contact pour les demandes concernant les données personnelles **info@activitee.golf**. Cette déclaration ne permet pas d’inventer une société constituée, une inscription au registre du commerce ou de conclure au partage des responsabilités avec les clubs. Une limitation commerciale à la Suisse ne suffit pas, à elle seule, à conclure que le RGPD est inapplicable : la qualification doit porter sur les activités et personnes effectivement concernées.

**Modèle commercial confirmé dans la même préparation : le club paie ; aucun abonnement individuel au lancement.** Le contrat commercial du club, les CGU des utilisateurs et les autorisations/choix relatifs aux enfants sont des documents distincts. Aucun prix, engagement de durée ou commission Marketplace n’est déduit de cette réponse.

### 0. Création des comptes — règle métier confirmée

L’utilisateur précise que **seul le club crée les comptes Junior, Parent et Coach**. Télécharger l’application ne permet pas de s’inscrire, de choisir librement un club ou de se donner un rôle. Les personnes utilisent un compte existant attribué par le club. L’administration plateforme dispose de son propre circuit privilégié, notamment pour les Managers ; ce circuit ne constitue pas une inscription publique.

Parcours cible : **création par le club → accès attribué/invitation → première connexion → présentation des documents et décisions applicables → accès aux fonctions autorisées**. L’invitation et le choix du mot de passe activent un compte déjà créé. Une création par le club ne vaut jamais acceptation des CGU par l’utilisateur, autorisation du représentant ou accord aux usages facultatifs.

L’information sur les données doit aussi couvrir la collecte et la préparation du compte par le club, avant la première connexion ; ne pas reporter toute information au premier écran de l’application. Le club doit disposer d’une justification adaptée pour cette collecte préalable et informer les personnes concernées. La répartition contractuelle club/exploitant reste à qualifier par finalité. [PFPDT, collecte directe ou indirecte](https://www.edoeb.admin.ch/fr/devoir-dinformer).

Contrôles techniques : inscription publique désactivée chez le fournisseur Auth, création réservée aux fonctions serveur et acteurs autorisés du club, rôle/club validés côté serveur, aucune inscription via un ancien écran technique, pas de décision juridique fabriquée lors de l’import/création. La sortie du club et la suppression du compte restent des opérations distinctes.

**Constat du 5 octobre :** le parcours principal utilise `auth.admin.createUser` après contrôle Manager/club ; `invitation-reset` modifie le mot de passe d’un compte existant. Une ancienne page `/auth-test` appelait encore `auth.signUp` : remplacée localement par la redirection vers la connexion normale. La configuration Supabase locale est alignée avec l’inscription fermée. La première lecture publique de `/auth/v1/settings` du projet TEST `wizbeuuvjibmmuxyynly` retournait `disable_signup=false`. Après accord explicite de l’utilisateur, le réglage distant a été fermé : **`disable_signup=true`**, confirmé par l’API et après rechargement du tableau de bord. Aucun compte créé pour essayer, aucun accès club induit démontré ; voir la section 16 du rapport. Cette configuration Auth ne donne pas à elle seule une appartenance ou un rôle dans un club.

### 1. Décisions proposées

| ID | Proposition à valider | Effet concret | Écart avec le code actuel |
|---|---|---|---|
| D1 — Documents | CGU acceptées par les utilisateurs capables de s’engager ; notice de confidentialité et notice junior présentées séparément, sans consentement global à tous les traitements. | CGU nécessaires au service : nouvelle décision lors de chaque nouvelle version publiée, conformément au besoin exprimé. Les notices sont réaffichées et leur présentation peut être tracée ; ne pas conditionner tout le service à un consentement à la notice. | Le garde peut actuellement rendre `privacy` et `junior_notice` bloquants avec `required=true`. La configuration Admin doit empêcher une confusion entre information, contrat et consentement spécifique. |
| D2 — Juniors | Pour le lancement, proposer un parcours accompagné pour les moins de 18 ans : autorisation d’usage par représentant vérifié, par enfant et club ; notice compréhensible pour le junior. | L’autorisation d’usage n’accorde ni diffusion publique de photos, ni marketing, ni partage IA. Un âge/pays inconnu appelle une vérification ; aucun passage automatique au statut adulte. | `all_members` ne distingue pas âge/capacité/juridiction. Le futur contrat accepté pour l’enfant ne peut pas être remplacé par les CGU personnelles du parent. Règles versionnées et tests d’âge nécessaires. |
| D3 — Choix facultatifs | Séparer publication externe d’images, communications commerciales et assistance IA sur les données du joueur. Aucun choix précoché. | Refus : entraînements, planning, saisie manuelle et messagerie utile restent disponibles. Retrait : arrêter les nouveaux traitements de la finalité concernée et recontrôler les tâches déjà en attente. | Une décision `specific_consent` ne commande aujourd’hui aucun traitement par sa `purpose_key`. Il faut relier chaque finalité aux API, jobs et destinataires réels. |
| D4 — Plusieurs clubs | Une obligation du club B ne bloque que les ressources de B ; les CGU plateforme s’appliquent à l’ensemble du compte. | A reste utilisable si ses conditions sont remplies. La sélection du club, les documents, les droits et la déconnexion restent accessibles. Pour une opération visant A et B, vérifier les deux portées. | Le filtre HTTP considère toutes les appartenances ; SQL considère plateforme + club de la ligne. Résoudre la portée côté serveur à partir de la ressource et des droits, jamais depuis un simple paramètre de club non vérifié. |
| D5 — Rôles particuliers | Pas d’exemption générale pour un Admin agissant comme utilisateur. Gouvernance documentaire et demande de droits disposent d’un accès de récupération borné et audité. | Admin, Coach et Manager conservent leurs contrôles métier ; aucune validation par substitution à un Parent ou Player. Une organisation OM dispose d’une correspondance explicite, sans assimiler un parcours de golf à un club membre. | Harmoniser les exemptions HTTP/SQL et les organisations OM historiques. Les douze tables de bootstrap et les catalogues doivent avoir une finalité nommée et des champs minimaux. |
| D6 — Retrait et fin de relation | Distinguer retrait facultatif, fin d’autorisation d’usage, résiliation de compte et demande d’effacement. | Un retrait facultatif ne ferme pas le compte. Une fin d’autorisation concerne l’enfant et le club désignés, avec résolution des conflits entre représentants. Les autres enfants et clubs sont préservés. | Le parcours parent doit prévoir le retrait directement ; le bouton actuel de `/legal/my` vise seulement `specific_consent`. L’autorisation parentale n’est pas reliée au garde général ; le consentement historique ne constitue pas une preuve nouvelle. |

Le seuil de 18 ans de D2 est une **proposition de parcours produit**, pas une conclusion universelle sur la capacité de consentir aux données. Dans l’UE, les conditions de l’article 8 visent certains services aux enfants lorsque le traitement repose sur le consentement ; les seuils nationaux vont de 13 à 16 ans. Les règles contractuelles et la représentation doivent être examinées séparément. [Commission européenne](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data/are-there-any-specific-safeguards-data-about-children_en), [SECO, mineurs et conclusion du contrat](https://www.seco.admin.ch/fr/avant-l-achat-et-conclusion-du-contrat).

La proposition D1/D3 distingue information et consentement : la notice identifie responsables, usages et destinataires ; un consentement facultatif doit permettre un choix par finalité et un retrait simple. [PFPDT, devoir d’informer](https://www.edoeb.admin.ch/fr/devoir-dinformer), [CNIL, consentement](https://www.cnil.fr/fr/les-bases-legales/consentement).

### 2. Traduction des règles en parcours

| Utilisateur / événement | Parcours proposé, non activé |
|---|---|
| Adulte Player, Parent, Coach, Manager ou Admin | À la première connexion au compte précréé, présenter les CGU applicables à sa capacité et les notices, enregistrer les décisions nécessaires, puis proposer séparément les options facultatives. Le rôle Player seul ne permet pas de conclure à la majorité. |
| Junior | Présenter une notice adaptée ; l’autorisation vient du représentant habilité. Si elle manque, afficher une explication, l’accès à l’aide et la sortie de session ; préserver les fonctions de récupération. |
| Parent de deux enfants | CGU personnelles du parent puis une décision distincte par enfant et club, avec nom affiché avant confirmation. Jamais de case validant indistinctement tous les enfants. |
| Code parental | Code limité à une présentation, un parent et un enfant ; identité et droits relus avant décision. Le contrôle de l’adresse e-mail ne prouve pas, à lui seul, l’autorité parentale. |
| Passage à la majorité / changement de représentant | Revue de la capacité et des accès parentaux, nouveaux documents applicables ; ne pas transférer automatiquement une autorisation en acceptation personnelle et ne pas laisser des accès familiaux devenir permanents par défaut. |
| Nouvelle version | Préserver toutes les preuves précédentes ; présenter le nouveau texte et son résumé. Pour un document requis, l’ancienne décision ne suffit plus. Pour une finalité facultative élargie, aucune nouvelle utilisation sur la seule base de l’ancienne décision. |
| Deux représentants en désaccord | Le refus/retrait ne doit pas être annulé silencieusement par l’autre parent. Suspendre la finalité concernée, faire instruire le conflit et conserver l’historique. |
| Aucun consentement facultatif donné | Service principal disponible, aucune exécution des finalités optionnelles dans la future configuration choisie. |

### 3. Finalités et points d’application concrets

Les clés ci-dessous sont **proposées**, non créées en base. Chaque entrée devra préciser acteur, bénéficiaire, portée, version applicable, statut, base retenue, destinataires, date d’effet et règle de conservation. Ne pas ajouter un simple booléen de consentement sur le profil.

| Finalité proposée | Traitement et contrôle attendu |
|---|---|
| `service.account` / `service.sport` | Authentification, organisation et suivi sportif : qualifier les responsabilités et bases par traitement. Ne pas en faire des consentements facultatifs artificiellement obligatoires. Compte et connexion minimaux accessibles pour exercer les droits. |
| `media.external_publication` | Photo/vidéo publiée à l’extérieur du cercle autorisé : préciser supports, destinataires et durée ; contrôler avant chaque publication. Avatar dans l’application et diffusion publique sont deux usages à inventorier séparément. [PFPDT, photos](https://www.edoeb.admin.ch/fr/prendre-et-publier-des-photos). |
| `communications.marketing` | Communications commerciales : décision et canal séparés ; aucun envoi de cette finalité sans choix valable. Le logo statique d’un partenaire ne signifie pas en lui-même que des données lui sont transmises ; vérifier les liens, SDK et mesures d’audience effectifs. |
| `communications.service` | Sécurité du compte, organisation sportive, rappel et rapport : classifier chaque type. Permission système de notification, préférence de canal, droit de lire le contenu et base du traitement sont des contrôles différents. Recontrôler au moment de l’envoi. |
| `coaching.ai` | Synthèse/préparation et réécriture individuelle : décision applicable au bénéficiaire, autorisation du coach et du club, minimisation, destinataire et conditions du prestataire. Alternative manuelle disponible ; retrait vérifié avant l’appel et avant réemploi d’un résultat en attente. |
| `legal.evidence` / `rights.requests` | Preuves et demandes : accès limité, justification propre de conservation, purge/anonymisation conçue sans effacer la preuve ou les droits d’un autre acteur. |

**Code relu, sans appel extérieur ni envoi :**

- `lib/legalRequirements.ts` et `lib/server/legalRequirements.ts` : documents requis, toutes appartenances, règle exécutable limitée à `all_members` ; SQL `20261103` pour la portée des ressources.
- `app/api/coach/events/[eventId]/debrief/analyze-player/route.ts` : l’appel IA contient actuellement UUID, nom/prénom et commentaire source du joueur, avec `store:false`. `lib/server/coachTrainingAssistance.ts` contrôle une option club/coach ; ce contrôle ne démontre pas une décision du joueur/représentant. Ne pas qualifier ces données d’anonymes ni `store:false` de garantie contractuelle de conservation nulle. L’autre appel est dans `preparation-insights/route.ts`.
- `lib/server/periodicReportAccess.ts` : les destinataires sont revalidés via appartenance, lien et consentement historique. Le registre juridique versionné n’est pas consulté. Jobs concernés : `app/api/cron/periodic-reports/route.ts` et `competition-reminders/route.ts`.
- `app/api/push/dispatch/route.ts` : l’identité de l’émetteur est contrôlée, la vérification de notification dépend de la présence d’un identifiant ; la liste des destinataires vient de la requête. Revue de sécurité à terminer avec les politiques de création des notifications et les sources métier. **Candidat qualifié par lecture du chemin, pas essai d’envoi ni faille interclubs démontrée sur TEST.** La simple présence d’un destinataire enregistré ne devra pas remplacer le droit d’envoyer.
- `lib/playerDocumentPolicy.ts` / `lib/playerDocumentStorage.ts` : URL privée signée valable 15 minutes, fallback historique dans le bucket public `marketplace`. L’arrêt de nouvelles signatures ne retire pas les liens déjà distribués.
- `app/api/legal/data-request/route.ts` : enregistrement d’une demande ; aucune suppression de compte exécutée par cette route.

### 4. Conservation et révocation : décisions distinctes

Ne pas fixer une durée unique pour toutes les données et ne pas activer une purge automatique avant inventaire des contraintes. Compléter, pour chaque ligne : responsable, finalité, événement de départ, durée en activité, durée après sortie, motif d’exception, action finale, copies chez les prestataires et expiration des sauvegardes.

| Catégorie | Décision à renseigner / comportement technique proposé |
|---|---|
| Profil, adhésions, liens familiaux | Distinguer sortie d’un club et fermeture du compte ; supprimer ou anonymiser les éléments devenus inutiles sans supprimer les droits des autres clubs. |
| Activités, résultats, évaluations et messages | Définir les besoins historiques sportifs et les exceptions de preuve ; limiter l’accès après sortie. Éviter une conservation sans échéance justifiée. |
| Fichiers et photos | Inventorier le public existant avant migration ; pour les futurs documents sensibles, préférer un téléchargement serveur revalidant les droits à chaque demande si une révocation rapide est exigée. Choisir explicitement entre ce mécanisme et la tolérance d’une URL signée pendant 15 minutes. |
| Preuves de décisions, codes et demandes de droits | Séparer preuve durable justifiée, code éphémère et dossier de demande. Les triggers d’immutabilité actuels nécessitent une procédure de purge contrôlée ; aucune désactivation générale de ces protections. |
| Jobs, caches, sauvegardes et prestataires | Annuler les opérations non parties, revalider les files, vider les vues privées au retour au premier plan et définir la politique des sauvegardes. Aucun mécanisme ne récupère une copie déjà téléchargée. |

### 5. Lot de développement à préparer après arbitrage

Un seul lot cohérent si le schéma doit évoluer, avec préflight/postflight en lecture seule ; aucune nouvelle migration exploratoire à appliquer maintenant.

1. Définir les règles d’applicabilité versionnées (pays/capacité/représentation), la distinction notice/contrat/options et les portées communes HTTP/SQL. Refuser les combinaisons incohérentes dans l’Admin, sans réécrire une publication existante.
2. Relier les finalités aux contrôles métier : services interactifs, jobs et décisions parentales. Prévoir aussi le retrait en ligne, la fin de relation et les données déjà produites.
3. Terminer l’autorisation des notifications, la correspondance OM, le traitement des documents publics et le parcours réel de suppression de compte. Les permissions existantes ne sont jamais élargies par un accord juridique.
4. Traduire les textes stabilisés FR/EN/DE/IT, faire relire chacune des quatre versions, vérifier variables et version source, conserver le contenu rendu exact dans chaque preuve. Une proposition IA ne vaut pas approbation.
5. Réunir un dossier d’activation : décisions signées par les responsables, comptes et base jetables identifiés, captures attendues et retour arrière. L’activation réelle reste une étape séparément autorisée.

### 6. Critères de recette à ajouter au prochain lot

| ID | Scénario et preuve attendue |
|---|---|
| R0 | Inscription publique indisponible, y compris appel Auth direct et ancien client ; création Manager autorisée pour son club, refusée depuis un autre club et pour les rôles non habilités ; invitation sur compte existant, aucune acceptation automatique. |
| R1 | Mineur/adulte/date inconnue/pays non pris en charge ; anniversaire à la frontière de date ; mêmes décisions d’accès HTTP et SQL. |
| R2 | Parent validé pour enfant A, refusé pour B ; lien révoqué et compte récupéré par Manager ne permettent aucune substitution ; aucune décision réelle. |
| R3 | CGU V2 requises : V1 insuffisante ; notice seule non bloquante dans la configuration D1 ; option refusée : fonctions principales maintenues. |
| R4 | Même personne dans clubs A et B : document B ne ferme pas A ; ressource B et opération A+B contrôlées ; paramètres de club falsifiés sans effet. |
| R5 | IA facultative refusée/retirée : aucun appel du prestataire (transport simulé), saisie manuelle intacte ; résultat arrivé après retrait non appliqué. |
| R6 | Retrait pendant une file d’envoi : tâche annulée avant transport ; droit perdu sur enfant : aucun rapport ; changement de destinataire/canal revalidé. |
| R7 | Notifications : sans identifiant, émetteur étranger, destinataire ajouté, contenu remplacé, préférences indisponibles, réessai et destinataire interclub ; aucun transport réel. |
| R8 | Document privé : nouvelle URL refusée après retrait ; URL déjà émise observée selon la durée choisie ; copie locale reconnue comme limite ; fichiers publics répertoriés. |
| R9 | Demande de suppression : identité vérifiée, exécution réelle sur fixtures, exceptions expliquées, preuve conservée selon règle ; autre enfant/club intact. |
| R10 | Ancien client, onglet déjà ouvert, retour au premier plan, hors ligne et Capacitor ; aucune donnée nouvelle malgré un écran ancien ; interfaces de droits et sortie toujours accessibles. |
| R11 | Chaque rôle, FR/EN/DE/IT, desktop/mobile ; présentation et décision relues en base ; double clic/reprise réseau idempotents. |

Cette préparation est documentaire : aucun nouveau résultat de recette, aucune approbation juridique, aucun changement de configuration TEST ou production.

### 7. Dossier de rédaction FR r2 — responsabilités et conservation proposées

**Historique r2 : les confirmations ultérieures et la politique rédactionnelle r3 figurent en section 8.** Les formulations « non adopté », « à désigner » et les inconnues de cette section décrivent l’état au moment de r2.

La demande de poursuivre autorise la rédaction détaillée des CGU et de la notice, désormais réunies dans [drafts.md](drafts.md). **Les propositions ci-dessous sont des choix à examiner, pas des pratiques déployées, des durées légales universelles ou une approbation de D1–D6.** Aucun contrat conclu n’a été consulté ; aucune donnée réelle n’a été lue pour cette préparation.

#### 7.1 Répartition proposée des responsabilités

Un rôle se qualifie selon celui qui décide de la finalité et des moyens du traitement. La proposition doit être confrontée au contrat et au fonctionnement effectif ; le nom donné dans les CGU ne suffit pas. Le PFPDT rappelle que l’externalisation conserve des obligations au mandant et doit encadrer les instructions, la sécurité et les sous-traitants. [PFPDT, externalisation](https://www.edoeb.admin.ch/fr/externalisation-sous-traitance).

| Traitement | Répartition proposée | Action concrète avant mise en service |
|---|---|---|
| Création des comptes, adhésion, liens familiaux, suivi sportif et communications du club | Club responsable ; ActiviTee sous-traitant dans la mesure où il agit sur instructions | Club identifie son interlocuteur, informe avant import/création, décide des champs utiles, vérifie les droits du représentant et retire les habilitations obsolètes. ActiviTee exécute et trace les instructions autorisées. |
| Compte commun à plusieurs clubs, authentification et sécurité | Partager explicitement les opérations réalisées pour les clubs et les finalités propres éventuellement déterminées par ActiviTee | Définir propriétaire des données communes, correction d’identité, accès d’assistance, incidents, sortie d’un club et fermeture du dernier accès. Pas de désignation globale par défaut. |
| Contrat, facturation et relation d’ActiviTee avec les clubs | Fabrice Joliat responsable des traitements qu’il détermine pour cette relation | Notice destinée aux interlocuteurs du club ; inventaire comptable séparé. Aucun délai comptable appliqué automatiquement au dossier sportif d’un junior. |
| Registre des décisions et demandes relatives aux données | Club pour ses autorisations/finalités ; ActiviTee pour ses propres CGU et dossiers, qualification des services de preuve à convenir | Affecter chaque dossier à un responsable et permettre la coordination sans divulguer les informations d’un autre club ou enfant. |
| IA, publication extérieure de photos, communications commerciales | Responsable à définir pour chaque usage effectivement choisi ; prestataire intervenant selon le contrat | Décision nommée par finalité, portée et bénéficiaire ; arrêt effectif au refus/retrait ; pas d’autorisation générique donnée au club ou à un partenaire. |
| Classements/OM et organisations, Marketplace | Déterminer qui organise le classement ou la transaction et choisit le public | Examiner les règles de l’organisation, les coordonnées partagées, les mineurs, la visibilité des images et les éventuels intervenants distincts du club. |

**Annexe contractuelle club/ActiviTee à préparer pour signature humaine :** objet, finalités et catégories de données/personnes ; instructions et personnes habilitées ; confidentialité et sécurité ; liste des prestataires et conditions de changement ; pays et garanties ; assistance aux droits et aux incidents ; accès d’administration et contrôle ; durée, restitution/suppression et sauvegardes ; traitement des données communes/multi-clubs ; preuve de fin de traitement. Les délais de coopération devront être compatibles avec ceux de la réponse aux personnes. Cette liste n’est pas un contrat déjà en vigueur.

#### 7.2 Inventaire technique de préparation — limites des preuves

Lecture du checkout `2af721a` avec les changements locaux documentés ; les chemins suivants qualifient des usages du code. Ils ne prouvent pas tous les services actifs, pays ou contrats de production.

| Élément | Usage et données établis par le code | Source locale | Preuve complémentaire attendue |
|---|---|---|---|
| Supabase | Auth, profil/rôles/liens, données sportives, fichiers et registre juridique ; sessions persistantes côté navigateur | `lib/supabaseClient.ts`, `app/api/admin/clubs/[clubId]/create-member/route.ts`, migrations juridiques | Entité contractante, région de chaque projet, accès support, sous-traitants et sauvegardes. La référence TEST est connue ; la localisation n’en découle pas. |
| Vercel | Hébergement du déploiement TEST déjà contrôlé en section 13 du rapport | `vercel.json`, preuve `20261005-deployment-recheck-environment.json` | Régions d’exécution, CDN, journaux, contrat et accès ; une région de base de données ne couvre pas ces opérations. |
| Brevo | Courriels d’accès, rapports et codes selon configuration ; destinataire et contenu du message | `lib/server/legalParentMail.ts`, `app/api/cron/periodic-reports/route.ts`, `app/api/manager/clubs/[clubId]/access-invitations/route.ts` | Compte/contrat, pays, conservation des contenus et journaux ; aucun envoi ni activation vérifié dans cette phase. |
| OpenAI — coaching | Réécriture : UUID, nom et texte sélectionné. Préparation : UUID, références/dates et notes privées de séances ; propositions mises en cache dans l’application | `app/api/coach/events/[eventId]/debrief/analyze-player/route.ts`, `preparation-insights/route.ts`, `lib/server/coachPreparationSources.ts` | Compte/projet, contrat, régions et conservation, finalité et choix individuel. `store:false` n’établit pas une conservation contractuelle nulle. |
| OpenAI — traduction administrative | Gabarit FR et variables non rendues ; toute donnée directement saisie dans le gabarit est aussi transmise, dont les coordonnées de l’exploitant | `app/api/admin/legal/translate/route.ts` | Consignes éditoriales empêchant la saisie de données de membres ; revue humaine ; aucune traduction externe déclenchée ici. |
| Notifications web | Abonnement et transport Web Push ; notification affichée avec titre, corps et lien | `app/api/push/subscriptions/route.ts`, `app/api/push/dispatch/route.ts`, `public/sw.js` | Prestataires effectifs selon appareil/binaire, contenu visible sur écran verrouillé, durée et révocation des abonnements. Pas d’accès à des abonnements réels pour identifier leurs domaines. |
| Stockage navigateur | Cookies/session, langue, sélection de l’enfant, cache de pages et profil du Hero | `lib/supabaseClient.ts`, `components/auth/AuthSessionBoundary.tsx`, `lib/clientPageCache.ts`, `app/player/page.tsx` | Inventaire des clés, durée physique, effacement à la déconnexion et appareil partagé. Le TTL du Hero de 10 min n’est pas une purge ; les clés Hero ne figurent pas dans le nettoyage explicite de cette boundary. À vérifier fonctionnellement, sans affirmer ici une divulgation intercomptes. |
| Fichiers | Documents privés : liens signés de 15 min ; chemins historiques publics dans `marketplace` ; images d’annonces renvoyées avec URL publique | `lib/playerDocumentPolicy.ts`, `lib/playerDocumentStorage.ts`, `app/api/player/marketplace/route.ts` | Public réel, inventaire des anciens objets, CDN et suppression ; ne pas écrire « tous les fichiers sont privés » ni « retrait instantané de chaque copie ». |
| Droits et preuves | Le formulaire persiste une demande ; les présentations, versions et décisions ont des protections contre la modification/suppression | `app/api/legal/data-request/route.ts`, `app/legal/request/page.tsx`, migrations `20261020`–`20261022` | Responsable de suivi, exécution, pièces nécessaires et procédure de purge compatible avec les preuves. |

**Documents à réunir par prestataire :** contrat/avenant applicable au compte, entité, catégories transmises, pays de stockage et d’accès, liste des sous-traitants, garanties des transferts, durées de journaux et sauvegardes, mécanisme de suppression. Les pages commerciales génériques ne remplacent pas ces preuves propres aux comptes. L’information sur les transferts doit refléter les États et garanties effectifs. [PFPDT, communication à l’étranger](https://www.edoeb.admin.ch/fr/communication-de-donnees-a-letranger).

#### 7.3 Grille de conservation à examiner

**Scénario de travail chiffré, non adopté.** Les nombres servent à rendre l’arbitrage concret ; ils ne proviennent ni d’une obligation générale ni d’un réglage observé. Ils s’appliqueraient sous réserve d’un besoin réel documenté, d’une demande fondée d’effacement anticipé, des droits d’autres personnes et d’une exception précise. Le principe de suppression/anonymisation des données devenues inutiles est rappelé par le [PFPDT](https://www.edoeb.admin.ch/fr/le-droit-a-loubli-sur-internet).

| Catégorie | Point de départ et durée proposée | Pourquoi / fin de conservation | État et décision nécessaire |
|---|---|---|---|
| Compte précréé jamais utilisé | Revue à 90 jours après création ; supprimer les données sans autre besoin confirmé | Éviter les comptes abandonnés ; distinguer un dossier sportif encore utile au club du simple compte Auth | Nouveau processus à développer ; les invitations actuelles expirent après 7 jours, ce qui ne supprime pas le compte. |
| Profil, adhésions et liens | Pendant les relations utiles ; à la fin de la dernière relation, fenêtre maximale de 90 jours pour organiser export/fermeture | Révoquer l’accès obsolète immédiatement ; supprimer ensuite les données courantes inutiles, isoler les seules pièces justifiées | Pas de compte global supprimé à la seule sortie du club A ; règle multi-clubs à implémenter. |
| Résultats, évaluations et rapports sportifs | Besoin longitudinal réexaminé annuellement pendant l’adhésion ; au plus 24 mois après sortie du club | Permettre clôture et continuité d’une saison ; puis supprimer/anonymiser si aucun besoin distinct justifié | Proposition à confronter au besoin des clubs, aux classements officiels et aux droits des juniors ; pas de conservation de carrière par défaut. |
| Notes privées de coach | Revue au moins à chaque fin de saison ; plafond proposé de 12 mois après la séance | Éliminer les commentaires devenus inutiles ; un objectif encore actuel doit être justifié et actualisé, pas une reconduction automatique des notes | Vérifier les dépendances aux rapports et aux préparations IA ; exceptions documentées. |
| Messages et pièces de discussion | 12 mois après le dernier échange utile ; revue annuelle des fils toujours actifs | Garder les échanges utiles à l’organisation, puis supprimer/anonymiser sans effacer la preuve nécessaire à un signalement | Règles pour pièces jointes, autres participants et contentieux à concevoir. |
| Notifications et journaux de livraison courants | 90 jours après envoi | Historique et diagnostic bref ; purge du contenu et des métadonnées devenus inutiles | Paramètres des transporteurs à vérifier ; les rapports sources suivent leur propre durée. |
| Annonces Marketplace | Coordonnées retirées de l’affichage à la clôture ; purge proposée 90 jours après clôture | Limiter les anciennes coordonnées et images ; traiter séparément un litige concret | Suppression des objets et caches à développer et vérifier ; qualification de la vente requise. |
| Photos/documents d’activité | Pendant le besoin défini ; revue à la fin de chaque saison ou à la fin du support autorisé | Retirer les objets inutiles et les liens distribués maîtrisés ; éviter une durée uniforme pour tous les documents | Durée finale liée au document ou à l’autorisation ; cas sensibles et fichiers publics à inventorier. |
| Préparations IA non appliquées | Invalider dès modification/retrait pertinent ; purge proposée au plus 30 jours après la séance cible | Cache de préparation, pas dossier permanent ; une note adoptée par le coach suit la règle des notes | Nouvelle purge à concevoir ; vérifier séparément la conservation du fournisseur. |
| Codes et présentations abandonnées | Code inutilisable au plus après 10 min, présentation après 30 min (délais actuels) ; cible de purge des éléments éphémères inutiles sous 24 h | Un secret expiré n’a pas vocation à durer autant qu’une preuve ; préserver l’attestation minimale nécessaire | Séparer suppression du secret et conservation de l’événement ; les dépendances et triggers empêchent d’appliquer une purge naïve. |
| Journaux techniques de diagnostic | Proposition 30 jours ; événements de sécurité nécessaires jusqu’à 90 jours | Résolution d’erreurs et investigation ; exclure mots de passe, codes, contenu sportif intégral | Inventorier d’abord les collecteurs et les éventuelles obligations spécifiques ; aucun réglage fournisseur changé. |
| Demandes de droits et pièces d’identité éventuelles | Pièces de vérification supprimées dès qu’inutiles ; durée du dossier minimal après clôture à arrêter juridiquement | Prouver le traitement sans conserver systématiquement une copie d’identité | Pas de durée arbitraire présentée comme acquise ; responsable et procédure encore requis. |
| Décisions juridiques et anciens textes | Durée spécifique à arrêter par type de preuve, événement de départ et délais de recours applicables | Garder le contenu accepté et ses éléments d’attribution nécessaires, avec accès limité ; aucune conservation indéfinie automatique | Revue juridique et purge contrôlée indispensables ; pas d’effacement en cascade ni de désactivation générale de l’immutabilité. |
| Sauvegardes, export et copies des prestataires | Horizon réel à relever dans chaque contrat/paramétrage ; objectif de limitation à choisir ensuite | Suppression différée documentée ; restaurations accompagnées de la réapplication des suppressions | Aucune promesse « toutes les copies supprimées sous 30 jours » tant que l’horizon réel n’est pas prouvé. |

Pour chaque exception : motif, données concernées, responsable, accès autorisés et date de réexamen. Une anonymisation doit rendre la réidentification raisonnablement impossible ; supprimer le nom ou remplacer l’identifiant ne suffit pas. Avant toute purge : simulation en lecture seule, calcul des dépendances/fichiers/caches, contrôle des autres clubs et essais sur fixtures. Aucune purge réelle n’est autorisée par cette proposition.

#### 7.4 Circuit proposé des demandes de droits

1. Réception par `info@activitee.golf` ou formulaire ; affectation à une personne responsable et au club concerné. Ne pas dépendre d’une notification automatique qui n’est pas implémentée par la route actuelle.
2. Identifier le demandeur proportionnellement ; vérifier séparément la représentation d’un enfant ; ne pas demander systématiquement une pièce d’identité complète.
3. Délimiter compte, club, enfant et données ; examiner les droits des tiers, les obligations et les exceptions. La sortie d’un club ne supprime pas tous les autres accès.
4. Préparer la réponse et, selon la demande, corriger, transmettre ou supprimer effectivement les éléments concernés. Conserver une preuve minimale du traitement et expliquer les exclusions.
5. Relever l’échéance, relancer les prestataires et confirmer le résultat, y compris le devenir des sauvegardes. Pour l’accès suisse, le délai de principe de 30 jours rappelé par le [PFPDT](https://www.edoeb.admin.ch/fr/droit-dacces) ne doit pas être transformé en délai unique d’effacement pour toute demande.

**À désigner :** personne qui suit quotidiennement le contact données et l’Admin, relais dans chaque club et suppléant ; moyens de vérification et d’export sécurisé ; procédure de conflit et d’incident. Aucun message réel n’a été envoyé pour essayer ce circuit.

#### 7.5 Conditions de passage à la traduction et au développement

- Source FR r2 à relire : le premier accord éditorial ne valide pas automatiquement les clauses ajoutées ensuite.
- Arrêter les choix D1–D6 et les propositions de responsabilités/durées. Le modèle de facturation au club est confirmé ; le circuit Marketplace et l’assistance/modération restent distincts.
- Compléter les preuves fournisseurs, les pays, les garanties et les contacts ; faire relire textes et règles par un juriste connaissant le produit et les mineurs en Suisse.
- Finaliser la source puis préparer EN/DE/IT avec même révision et mêmes variables ; une correction source rouvre leur revue.
- Développer le lot cohérent et réaliser R0–R11 avec transports simulés et fixtures ; l’autorisation d’activer une base isolée, les drapeaux TEST et une publication réelle restent des décisions séparées.

### 8. Finalisation FR r3 et réglages vérifiés — 5 octobre 2026

L’utilisateur confie la finalisation des annotations et confirme : Fabrice Joliat suit l’assistance et les signalements à **info@activitee.golf** ; la Marketplace est une mise en relation sans paiement dans ActiviTee ni commission, avec intervention d’un représentant pour les transactions d’un mineur ; **IA facultative, aucun marketing ni publication publique de photos de personnes au lancement**. La facturation au club et les comptes créés par le club restent acquis.

#### 8.1 Choix de rédaction retenus et limites

- [Source FR r3](drafts.md) : autorisation par enfant/club, notice junior, notice complète, CGU et gabarit d’option IA distincte. Aucun champ éditorial à compléter entre crochets ; seules les variables serveur `{{child_name}}` et `{{club_name}}` sont conservées. Ce fichier n’est pas une version publiée du registre juridique.
- D1–D6 servent désormais de cible rédactionnelle : information distincte du consentement, accompagnement des moins de 18 ans, choix facultatifs séparés, préservation des autres clubs, absence de substitution par un administrateur, retrait distinct de l’effacement. Le seuil de 18 ans est un choix de parcours ; la capacité suisse et les obligations éventuelles d’une autre législation doivent encore être revues. Les écarts de code listés plus haut restent ouverts.
- Retrait par demande auprès du club ou de l’exploitant : la rédaction ne promet plus un bouton parental autonome absent. Prévoir un traitement simple, tracé et effectif ; un courriel indiqué n’est pas la preuve de l’arrêt des traitements.
- La grille C7 est retenue pour la rédaction sous la délégation de l’utilisateur : revue des comptes inutilisés à 90 jours, clôture des données courantes sous 90 jours après fin de relation, suivi sportif au plus 24 mois après sortie, notes privées à 12 mois, discussions à 12 mois après dernier échange utile, livraison à 90 jours, annonces à 90 jours après clôture, préparations IA non adoptées à 30 jours après séance cible. Les exceptions sont motivées et réexaminées. Ce sont des choix de politique à mettre en œuvre et à revoir avec les clubs, pas des délais légaux universels ni des purges actives.
- Les preuves juridiques utilisent un critère de conservation lié à la relation, au besoin de défense et aux délais de recours, avec réexamen annuel. La durée exacte par catégorie doit être qualifiée juridiquement ; aucune règle uniforme de dix ans ou durée illimitée n’est inventée. Les justificatifs devenus inutiles sont supprimés ; le dossier minimal suit son besoin de preuve.
- Fabrice assure le suivi des demandes reçues par courriel. Le formulaire ne déclenche pas encore leur exécution : définir sa consultation régulière, le relais de chaque club et la suppléance. Un cron de nettoyage de réservations/fichiers existe (`app/api/cron/player-document-cleanup/route.ts`), sans couvrir toute la politique C7.

#### 8.2 Réglages des comptes, en lecture seule

L’utilisateur a expressément étendu le périmètre à la lecture des réglages d’hébergement et de conservation Supabase/Vercel en production. Il a ensuite ouvert OpenAI et Brevo pour lire leurs paramètres. Aucune clé, donnée de membre, contenu de courriel, prompt, journal opérationnel ou sauvegarde n’a été consulté. Les paramètres n’ont pas été modifiés. Preuve minimale : [relevé des réglages](evidence/20261005-hosting-settings-readonly.json).

| Service | Fait observé | Portée / limite |
|---|---|---|
| Supabase TEST `wizbeuuvjibmmuxyynly` | `test PREVIEW`, `eu-west-1`, Ireland | Configuration primaire du projet. |
| Supabase production `qgyshibomgcuaxhyhrgo` | `main PRODUCTION`, `eu-west-1`, Ireland | Aucun contrôle de données ni de parcours de production. |
| Sauvegardes Supabase production | Huit sauvegardes quotidiennes affichées du 28 septembre au 5 octobre ; PITR non activé ; les objets Storage ne sont pas inclus | La liste visible ne prouve pas la date d’expiration de toutes les copies ; aucune restauration/téléchargement. |
| Vercel `nextee` | Région de fonctions sélectionnée `iad1`, Washington D.C., États-Unis ; aucun Log Drain associé | Réglage du projet, pas vérification de chaque déploiement. Aucun drain ne signifie pas absence de logs ; leur rétention complète n’a pas été établie. |
| OpenAI, projet nommé `ActiviTee` | Residency `Global`, Data retention `Standard Retention` | Zero Data Retention n’est pas activé sur ce projet. Le lien avec la clé de chaque intégration déployée n’a pas été vérifié ; aucun secret lu. Ne pas promettre une résidence UE. |
| Brevo, compte `ActiviTee` | Tous les expéditeurs ; logs un mois ; option Ne pas conserver les aperçus sélectionnée | Vaut pour les nouveaux aperçus ; absence/suppression des anciens non vérifiée. Aucun envoi ni lecture de logs. |

La notice distingue les paramètres observés et la documentation générique de Brevo sur l’hébergement France/Allemagne/Belgique. Les pages publiques de DPA et les régions affichées ne prouvent pas la version des contrats acceptés par ces comptes. Il reste à documenter les entités contractantes, accès hors région, sous-traitants et garanties effectivement applicables ; la demande de consultation n’autorisait pas à accepter un avenant.

#### 8.3 Blocage IA à résoudre avant traitement des enfants concernés

La documentation OpenAI exige Zero Data Retention avant de traiter les données personnelles d’enfants sous 13 ans ou sous l’âge applicable de consentement numérique qu’elle vise. Le projet observé est en conservation standard. Le mode `store:false` et le seul choix du club/coach ne satisfont pas ce prérequis. [Source officielle OpenAI](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance).

La notice et l’option IA sont donc des textes préparatoires ; leur rédaction ne rend pas l’usage actuel acceptable pour ces données. Avant usage : obtenir/valider le dispositif fournisseur requis ou exclure effectivement ces envois, puis vérifier la décision du bénéficiaire, l’âge pertinent et la révocation avant chaque appel. Le contrôle s’applique aussi aux notes privées et identifiants transmis par un coach adulte. Retirer le nom seul ne rend pas les données anonymes. Ne pas présumer qu’un accord parental remplace l’exigence du fournisseur.

Aucun changement de réglage ou de route IA n’est réalisé dans cette phase documentaire. La recette R5 doit tester les refus d’envoi par transport simulé ; l’option parentale nécessite aussi sa variante pour un joueur adulte. Une recommandation ou un texte ne vaut pas blocage technique déjà déployé.

#### 8.4 Suite opérationnelle

1. Faire revoir les textes et responsabilités, capacité, garanties et critères de conservation ; réunir les accords de traitement fournisseurs et l’annexe club.
2. Résoudre le dispositif IA ; aligner les contrôles, retraits, purges, demandes de droits et fichiers sur la politique décrite, puis tester R0–R11. Un éventuel SQL sera préparé en un seul lot avec préflight/postflight en lecture seule.
3. Préparer EN/DE/IT depuis la même révision FR, avec revue humaine liée à la source. Aucun appel de traduction n’a été effectué.
4. Décider séparément publication, recette avec gardes actifs et activation. Aucune acceptation réelle, publication, migration, configuration ou donnée réelle modifiée. Les résultats de campagne TEST n’établissent aucun parcours juridique en production.

### 9. Contrôle local des usages IA — 5 octobre 2026

La poursuite demandée a produit le correctif décrit en [section 20 du rapport unique](campaign-report-2026-10-04.md#20-correctif-local-des-usages-ia--5-octobre-2026), puis déployé sur TEST dans `a13dad9`. Voir la [section 21](campaign-report-2026-10-04.md#21-contrôle-test-de-a13dad9-et-correction-ciblée--5-octobre-2026) pour les preuves Chrome, le nettoyage et le petit ajustement de priorité du refus restant local.

- Mineur d’après la date enregistrée, date absente/invalide : IA bloquée. Cette exclusion temporaire de tous les moins de 18 ans est un choix conservatoire en attendant la revue du dispositif fournisseur, de l’âge et de la représentation ; elle n’assimile pas tous les mineurs au seuil OpenAI. La fiabilité et les droits de modification de la date de naissance restent à examiner avant une ouverture effective.
- Adulte : adhésion active au bon club, document facultatif unique `specific_consent` de finalité `coaching.ai` pour ce club, règle approuvée exécutable, dernière version cohérente, décision personnelle `consented` issue du parcours et prise après majorité, sans conflit. Absence ou erreur = refus de l’IA. Aucun statut historique ou consentement parental ne devient un accord personnel.
- Coach, événement et participant recontrôlés avant envoi, avant écriture du cache et avant retour des résultats. Un retrait/version modifiée observé pendant la génération écarte la réponse. L’empreinte du cache et de sa lecture comprend la décision ; un nouvel accord ne réutilise pas silencieusement l’ancien résultat.
- Les noms et identifiants techniques ajoutés automatiquement sont retirés des charges envoyées ; le texte libre reste personnel. La rédaction FR r4 décrit cette minimisation ; le déploiement TEST ne constitue pas une validation de la production.
- Les contrôles sont indépendants des drapeaux d’enforcement global, laissés inactifs. Sans document actif et décision spécifique, les aides IA de coaching resteront indisponibles après déploiement ; les parcours manuels n’exigent pas cet accord facultatif.

La vérification couvre les routes de génération, l’accusé de lecture et le calcul du statut de préparation. Les tables de cache et de lectures sont réservées au service dans les migrations relues, sans nouvelle permission client. Aucun SQL supplémentaire n’est nécessaire pour ces corrections. La suppression des anciennes copies, les demandes de droits, le retrait parental du service et le moteur général d’applicabilité restent distincts et inachevés. Les tests simulés ne prouvent pas les privilèges déployés ni les écrans Chrome TEST.

### 10. Reformulation limitée pour mineurs — préparation locale du 5 octobre 2026

À la demande de l’utilisateur, le code prépare un usage distinct : correction/amélioration du seul texte choisi par le coach, après masquage local des noms connus et aperçu. Voir les sections 22–23 du rapport unique et la rédaction **FR-2026-10-05-r6**. Le seuil ZDR, initialement étendu à tous les mineurs, est ramené à **13 ans** à la demande explicite de l’utilisateur. Cette possibilité reste désactivée ; retirer un nom et obtenir un accord parental ne suffisent pas à eux seuls à établir la licéité du traitement.

#### 10.1 Règles retenues

- Document facultatif distinct `coaching.rewrite`, par club, `specific_consent`, action `consent`, rôles `parent` + `player`, règle approuvée `all_members`, version publiée cohérente. Le garde exige à la fois le dernier accord représentatif confirmé par code et le dernier choix personnel positif du junior, sur la version courante. Il revérifie l’habilitation actuelle du représentant et bloque aussi lorsqu’un autre représentant a un dernier choix négatif sur cette version, sans se limiter à la première page d’historique. Refus, retrait, conflit, autre club, version obsolète ou âge inconnu bloquent l’appel. L’accord d’utilisation de l’application n’est pas réutilisé.
- Les deux choix concernent les moins de 18 ans ; le seuil ZDR est distinct et fixé à 13 ans. Le parcours accompagné reste une précaution produit, pas une définition légale de la capacité. La compréhension et la capacité doivent être examinées ; une personne qui ne peut pas prendre ce choix reste en saisie manuelle jusqu’à décision humaine sur un parcours adapté. Aucune exception automatique « le parent a cliqué ».
- Prénom/nom connus, certaines coordonnées et UUID sont masqués côté serveur. La détection est volontairement limitée : surnoms, fautes, tiers et détails contextuels peuvent subsister. Le coach doit relire l’aperçu exact et retirer les autres informations identifiantes, sanitaires ou concernant des tiers du texte d’origine. Masquage ne signifie pas anonymisation.
- Aperçu sans appel fournisseur, autorisation signée de cinq minutes liée au texte, destinataire, coach, événement, langue, audience et accords. L’envoi exige la confirmation de relecture ; tout changement exige un nouvel aperçu. Les contrôles d’accès/choix sont refaits avant transport et avant retour. Une révocation peut écarter le résultat mais ne rappelle pas une requête déjà partie.
- La préparation automatique des mineurs à partir de l’historique reste fermée. Les majeurs conservent l’option personnelle `coaching.ai` ; leur reformulation bénéficie aussi de l’aperçu. La modification locale de `/legal/my` distingue le choix propre du junior de l’état collectif alimenté par un parent.

#### 10.2 Conditions d’ouverture, sans activation dans cette intervention

| Réglage serveur | Rôle |
|---|---|
| `COACH_AI_MINOR_REWRITE_ENABLED` | Doit rester absent ou `false` jusqu’à validation des prérequis et recette TEST. |
| `OPENAI_COACH_ZDR_CONFIRMED` | Requis uniquement avant 13 ans. Attestation opérateur après vérification effective de ZDR ; cette variable ne configure ni ne prouve ZDR chez OpenAI. |
| `OPENAI_COACH_PROJECT_ID` | Identifiant du projet dédié vérifié, transmis dans `OpenAI-Project`. |
| `OPENAI_COACH_API_KEY` | Secret serveur rattaché à ce projet ; aucune reprise automatique de la clé générale pour les mineurs. |
| `OPENAI_COACH_MODEL` | Modèle de coaching réellement employé, `gpt-4o-mini` par défaut ; l’attestation doit couvrir ce modèle et l’endpoint Responses, y compris après une modification. |

Le drapeau d’ouverture, le projet dédié et sa clé restent nécessaires pour tous les mineurs. L’attestation ZDR est requise uniquement avant le 13e anniversaire ; son absence ou la valeur `false` ne bloque plus les 13–17 ans. Aucun réglage distant n’a été ajouté ou activé. Le seuil technique demandé est 13 ans pour le lancement suisse ; la documentation OpenAI mentionne les moins de 13 ans ou l’âge applicable de consentement numérique. Ce paramétrage ne détermine pas à lui seul le droit applicable. `store:false` ne remplace pas ZDR. Le dernier constat du compte était Global/Standard Retention ; aucun nouveau contrôle de ce réglage n’est revendiqué ici.

Avant ouverture : vérifier les contrats, transferts et sous-traitants et, pour les moins de 13 ans, l’éligibilité et l’activation réelle de ZDR pour les endpoints/modèles concernés ; revoir la capacité, les conflits de représentants et la fiabilité des dates de naissance ; mettre à jour la notice fournisseur, traduire/revoir les textes, puis faire une recette sur fixtures avec transports simulés. La revue des garanties, des informations adaptées aux mineurs et de la proportionnalité reste humaine. Les permissions de consulter les réglages n’autorisent pas à accepter des contrats ni à envoyer une demande commerciale.

Aucune migration, activation juridique globale, publication ni acceptation réelle. Aucun changement de permissions PostgREST/RPC/Storage. Les résultats locaux de ce lot ne prouvent pas son déploiement ni un parcours en production.

#### 10.3 Vérification du seuil demandé

Le calcul distingue explicitement 13 et 18 ans selon le calendrier Europe/Zurich. Le 13e anniversaire lève le prérequis ZDR ; il ne transforme pas un accord parental en accord personnel majeur et n’ouvre pas la préparation automatique des mineurs. Le ticket d’aperçu comprend la tranche d’âge (`under13` ou `13plus`) : une correction de date qui change cette tranche impose un nouvel aperçu. Un âge inconnu/invalide reste refusé. Les tests simulés couvrent aussi le retour sous 13 ans pendant une génération sans ZDR, dont le résultat est alors écarté. Aucun envoi déjà parti ne peut être rappelé.
