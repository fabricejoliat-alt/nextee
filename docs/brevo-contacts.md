# Synchronisation des contacts ActiviTee → Brevo

## Fonctionnement

La page **Administration → Contacts Brevo** (`/admin/settings/brevo`) affiche un aperçu paginé des contacts, le nombre de changements en attente, les retraits, les erreurs et la dernière exécution. L’aperçu ne contacte pas Brevo. Le lancement manuel exige un superadmin avec MFA et réauthentification récente ; il est audité comme les autres mutations d’administration.

Le cron `/api/cron/brevo-contacts` vérifie l’annuaire toutes les cinq minutes, puis traite au maximum 25 contacts, dans un budget de 80 secondes hors dernière requête. Le premier passage prépare automatiquement les contacts existants ; les passages suivants n’envoient que les différences. Un premier import de 300 contacts nécessite donc environ une heure avec le cron seul. Le bouton manuel traite un lot supplémentaire. Sans `CRON_SECRET`, seul le lancement manuel authentifié est disponible et la page indique explicitement ce mode. Ajouter ce secret commun authentifie aussi les autres crons existants : leur activation doit être autorisée séparément si elle dépasse le périmètre de la publication Brevo.

La projection utilise les adhésions actives `club_members` et `organization_members` pour les rôles `player`, `parent`, `coach`, `manager`, les noms des profils et l’adresse de connexion Auth. Les organisations désactivées et comptes bannis/supprimés sont exclus. Les rôles organisationnels `owner`, `admin`, `staff`, `captain` ne sont pas transformés implicitement en managers.

Une adresse normalisée = un contact, avec tous ses rôles et clubs. Pour une adresse partagée, le nom d’un parent est privilégié, puis manager, coach, joueur. Aucun nom d’enfant ni lien familial n’est ajouté au contact propre du parent. Un junior sans email réel n’est pas exporté ; le parent est synchronisé indépendamment s’il dispose de son propre compte et d’une adhésion active. Les adresses techniques `.local`, `.invalid`, `.test`, `.example` sont exclues.

La langue de l’interface est actuellement enregistrée sur l’appareil (`AppI18nProvider` / `app_locale`), sans préférence centrale de profil. Cette version ne transmet donc pas de langue supposée à Brevo. Aucun téléphone, date de naissance, résultat sportif ou document juridique n’est exporté.

## Configuration et activation

1. Appliquer **uniquement** `supabase/migrations/20261215_brevo_contacts.sql` sur l’environnement cible, selon la procédure habituelle. Ne pas appliquer en masse les migrations locales non publiées d’autres travaux.
2. Dans Brevo, créer une liste dédiée **ActiviTee — Répertoire**, sans campagne ni automatisation déclenchée par ajout à cette liste. Noter son ID. Cette liste contient un annuaire ; elle ne constitue pas une liste de consentements newsletter.
3. Configurer côté serveur, séparément sur TEST et production :

   | Variable | Valeur / usage |
   | --- | --- |
   | `BREVO_API_KEY` | Clé Brevo existante, avec accès contacts/listes/attributs ; jamais `NEXT_PUBLIC_*`. |
   | `BREVO_CONTACTS_LIST_ID` | ID numérique positif de la liste dédiée. |
   | `BREVO_CONTACTS_WEBHOOK_SECRET` | Secret aléatoire distinct de la clé API et du secret cron. |
   | `BREVO_CONTACTS_SYNC_ENABLED` | `false` pendant la préparation, puis `true` pour activer. Toute autre valeur désactive. |
   | `CRON_SECRET` | Secret du cron Vercel existant, requis pour l’endpoint cron. |

4. Créer un webhook Brevo **marketing**, canal **email**, pointant vers `https://<hôte cible>/api/webhooks/brevo-contacts`, avec les événements `unsubscribed`, `spam`, `contactDeleted`. Ajouter l’en-tête personnalisé `Authorization: Bearer <BREVO_CONTACTS_WEBHOOK_SECRET>`. Aucun secret dans l’URL. Les payloads `unsubscribe`/`unsubscribed` et `contact_deleted`/`contactDeleted` sont acceptés. Les lots JSON sont acceptés, maximum 100 événements / 64 Ko.
5. Déployer la page et les endpoints. Vérifier l’aperçu superadmin et la réception authentifiée d’un webhook sur une adresse de test contrôlée. Le statut « secret configuré » prouve uniquement la présence de la variable, pas l’installation du webhook chez Brevo.
6. Activer `BREVO_CONTACTS_SYNC_ENABLED=true`, redéployer la configuration et lancer un lot. Les attributs manquants `ACTIVITEE_*` sont créés automatiquement ; un attribut existant du mauvais type provoque une erreur explicite, sans changement de son type.
7. Vérifier dans Brevo : contact existant mis à jour, nouveau contact, personne multirôle, modification du nom, retrait d’adhésion, changement d’email, désabonnement et relance. Vérifier ensuite un véritable passage du cron et la persistance de l’état dans la page superadmin.

L’activation ne déclenche aucun email dans le code ActiviTee. Des automatisations Brevo peuvent toutefois réagir aux ajouts de contacts : la liste dédiée doit être préparée avant activation. Pour TEST, utiliser une base et un compte/liste Brevo de test avec uniquement des contacts fictifs contrôlés.

## Attributs et segments

Tous les attributs sont de type texte, sauf `ACTIVITEE_ACTIVE` (booléen). Les noms existants d’autres intégrations (`FIRSTNAME`, `LASTNAME`, etc.) restent intacts.

| Attribut | Contenu |
| --- | --- |
| `ACTIVITEE_FIRSTNAME`, `ACTIVITEE_LASTNAME` | Identité retenue pour l’adresse. |
| `ACTIVITEE_ACTIVE` | Présence actuelle dans l’annuaire actif. |
| `ACTIVITEE_ROLES` | Jetons triés, par exemple `\|coach\|parent\|`. |
| `ACTIVITEE_CLUBS` | Noms des clubs / organisations, séparés par ` / `. |
| `ACTIVITEE_CLUB_IDS` | Identifiants délimités par `\|`. |
| `ACTIVITEE_PLAYER_CLUBS`, `ACTIVITEE_PARENT_CLUBS`, `ACTIVITEE_COACH_CLUBS`, `ACTIVITEE_MANAGER_CLUBS` | Identifiants des clubs pour le rôle concerné. |

Exemple : segment « coachs du club X » = liste dédiée + `ACTIVITEE_ACTIVE=true` + `ACTIVITEE_COACH_CLUBS` contient `|<UUID du club X>|`. Filtrer séparément sur le rôle et le club général pourrait sélectionner une personne coach du club A mais seulement parent du club B ; les attributs par rôle évitent cette ambiguïté. Pour une newsletter, ajouter le critère de consentement géré dans Brevo selon votre processus d’inscription ; ce connecteur ne le crée pas.

## Désabonnements, changements d’adresse et retraits

Le connecteur n’écrit jamais `emailBlacklisted=false`, `smsBlacklisted`, `smtpBlacklistSender`, `EMAIL`, `ext_id` ou `forceMerge`. L’email Brevo n’est jamais renommé, car Brevo indique qu’un changement d’adresse peut réinitialiser le blocage. L’ancienne adresse est retirée de la seule liste dédiée et ses attributs ActiviTee sont vidés ; la nouvelle est traitée comme une adresse distincte.

Les webhooks de désabonnement, spam et suppression enregistrent une protection durable (empreinte SHA-256 de l’adresse et identifiants internes des comptes concernés). Les blocages déjà présents dans Brevo et observés par le worker sont aussi enregistrés. Les identifiants permettent de conserver cette protection lors d’un changement d’adresse du même compte. La nouvelle adresse attend le traitement de l’ancienne pour observer son éventuel blocage avant création. Les retraits de liste conservent le contact Brevo, ses autres listes et ses préférences globales.

Un contact protégé absent de Brevo n’est pas recréé ; s’il existe, il est retiré de la liste dédiée. Aucune réinscription automatique : une reprise après nouveau consentement explicite demande un traitement administratif séparé de la protection et des préférences Brevo. Si un désabonnement ancien concerne une adresse déjà supprimée de Brevo avant installation du connecteur, il faut reprendre l’historique d’opposition existant avant l’import ; ce connecteur ne peut pas reconstruire une information absente des deux systèmes.

Le départ d’un compte nettoie uniquement les attributs ActiviTee et la liste dédiée ; ce retrait ne supprime pas globalement le contact Brevo. Une demande d’effacement complète doit donc également couvrir Brevo et ses éventuelles autres finalités, selon la procédure d’effacement applicable.

## Fiabilité et exploitation

Les tables, la vue et les fonctions de synchronisation sont privées au rôle serveur `service_role` ; aucune lecture directe par `anon` ou `authenticated`. Aucun appel Brevo n’est placé dans les transactions de création/modification des comptes.

Un bail exclusif de cinq minutes empêche le chevauchement cron / lancement manuel. Après arrêt brutal, le bail expire et les écritures idempotentes sont reprises. Les contacts inchangés ne sont pas réenvoyés. Les erreurs conservent une tentative et une échéance de reprise exponentielle (60 secondes à 24 heures). HTTP 429 respecte `Retry-After` et suspend globalement les passages suivants jusqu’à l’échéance ; 401/403 arrêtent le lot. Les erreurs stockées n’incluent pas les réponses Brevo ni les adresses.

La liste cible est mémorisée au premier passage : changer son ID échoue pour éviter de laisser les anciens contacts dans la précédente liste. Un changement de liste doit être accompagné d’un nettoyage et d’une migration administrés. Pour arrêter les envois de contacts, désactiver `BREVO_CONTACTS_SYNC_ENABLED` et redéployer la configuration ; garder le webhook actif pour conserver les oppositions.

Validation locale :

```sh
node --experimental-strip-types --test tests/brevo-contacts.test.ts tests/brevo-contacts-sql.test.mjs
```

Ces tests simulent Brevo et exécutent la migration sur PostgreSQL embarqué (PGlite). Ils ne prouvent ni la configuration du compte Brevo, ni le fonctionnement authentifié en production.

Références officielles : [contacts](https://developers.brevo.com/docs/synchronise-contact-lists), [mise à jour et blocage d’adresse](https://developers.brevo.com/reference/update-contact), [attributs](https://developers.brevo.com/reference/create-attribute), [webhooks marketing](https://developers.brevo.com/docs/marketing-webhooks), [authentification et en-têtes webhook](https://developers.brevo.com/reference/create-webhook).
