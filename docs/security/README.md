# Renforcement de la section Admin — 9 octobre 2026

## Modifications

- MFA TOTP obligatoire pour ouvrir l’interface et appeler les API Admin. Le niveau `aal2` vient de `auth.getClaims()`, après vérification de signature et de l’identité auprès de Supabase.
- Une validation TOTP de moins de 15 minutes est requise avant les modifications. La demande de code conserve le formulaire et ne rejoue jamais une écriture automatiquement.
- Les anciens endpoints utilisés par les managers conservent leurs contrôles d’appartenance active et de cible au club. Les autres API métier ne permettent pas au superadmin de contourner le MFA.
- Les nouveaux comptes et les mots de passe réinitialisés depuis Admin utilisent un mot de passe initial cryptographique. Le drapeau `initial_password_required` est stocké dans `app_metadata`, modifiable uniquement côté serveur. Le nouveau mot de passe personnel doit contenir 12–128 caractères.
- Les invitations signées existantes et les liens de récupération restent utilisables. Les comptes existants ne sont pas marqués rétroactivement.
- CSP avec nonce sur les pages Admin, refus d’intégration dans une iframe, `nosniff`, politique de référent et réponses Admin `private, no-store`.
- Journal append-only : acteur, opération, cible, identifiant de requête, date et résultat HTTP. Aucune valeur de mot de passe, jeton ou contenu soumis n’est enregistré. Une intention durable est inscrite avant l’opération. Si l’enregistrement du résultat échoue après une écriture, l’intention reste disponible et l’API renvoie 503 : vérifier l’état avant de réessayer.

## Activation

Si le navigateur Supabase est indisponible, la commande suivante cible exclusivement TEST. Elle demande le mot de passe PostgreSQL et une phrase de chiffrement en saisie masquée, vérifie le certificat, sauvegarde les schémas `public`/`auth`/`storage`, contrôle l’intégrité de l’archive, puis applique la même transaction et les vérifications finales :

```sh
bash scripts/security/run-test-admin-security.sh --apply
```

Conserver la phrase de chiffrement pour restaurer la sauvegarde. Cette sauvegarde n’inclut pas les octets des fichiers Storage, qui ne sont pas modifiés par la migration. Une restauration complète dans un projet séparé reste à vérifier. `--plan` ne se connecte pas ; `--check` vérifie uniquement les préconditions. Cette commande ne peut cibler ni Zurich ni l’ancienne production.

La vérification `pg_restore --list` utilise un fichier temporaire privé (dossier `0700`, archive `0600`), supprimé à la fin de la vérification, y compris en cas d’erreur. L’envoi du dump complet sur stdin peut provoquer `EPIPE`, car `--list` s’arrête après avoir lu sa table des matières. Seule l’archive chiffrée est conservée pour la sauvegarde.

1. Utiliser `apply-admin-security.sql` sur TEST. La transaction compare le nombre et l’empreinte de toutes les tables applicatives existantes et de `auth.users` avant/après. Sa table de contrôle est temporaire, protégée par RLS et supprimée au commit. Le script refuse de remplacer un hook PostgREST différent.
2. Le titulaire du compte configure son application TOTP dans `/admin`. Aucune clé ni aucun code ne doit être envoyé dans une conversation ou conservé dans les preuves de test.
3. Vérifier la connexion réelle, une écriture réversible, les événements `started`/`succeeded` et le refus avec une session `aal1`.
4. Répéter la transaction et la configuration du titulaire sur Zurich, puis déployer le code et vérifier `activitee.app`. Le compte et le facteur MFA de TEST sont distincts de ceux de Zurich.

Sans la migration, les modifications Admin échouent volontairement à l’étape de journalisation. Ne pas déployer le code en production avant que cette dépendance soit prête.

### Dépendance Contact manquante dans TEST

Le contrôle réel du 9 octobre a identifié `PGRST205` pour `platform_contact_settings` dans TEST. Le journal contient bien l’intention puis l’échec HTTP 503 de `PUT /api/admin/contact-settings` : l’accès MFA et la journalisation ont donc fonctionné, mais la dépendance Contact n’était pas disponible. La transaction de sécurité seule ne crée pas cette table métier.

```sh
bash scripts/security/run-test-admin-security.sh --repair-contact
```

Cette variante cible exclusivement TEST et conserve la sauvegarde chiffrée avant toute modification. Elle applique `apply-contact-settings.sql` : ajout idempotent du paramètre Contact et de ses trois politiques de session, droits réservés au serveur, rechargement du cache PostgREST, contrôle des empreintes des données existantes. Une adresse déjà configurée est conservée. Elle exige que les fonctions de sécurité existent déjà et ne rejoue pas la migration Admin. `--plan-contact` affiche le plan sans connexion.

Après le résultat `TEST contact-settings committed`, recharger `/admin/settings/contact` et enregistrer l’adresse actuelle. Vérifier ensuite les événements `started`/`succeeded` et l’accès d’un joueur ou coach. La réparation est appliquée dans TEST et l’enregistrement Contact a été confirmé dans le navigateur puis dans le journal (HTTP 200).

### Passage à Zurich

TEST est désormais vérifié : le propriétaire a confirmé l’enregistrement Contact et l’accès normal avec un rôle ordinaire ; la lecture du journal a confirmé `started` puis `succeeded` HTTP 200. `test-verification.json` distingue cette preuve du déploiement en production.

```sh
bash scripts/security/run-zurich-admin-security.sh --apply
```

La commande cible uniquement `soivxpdcilgltbjbpimt`. Elle demande, en saisie masquée, le mot de passe PostgreSQL Zurich, une phrase de chiffrement d’au moins 16 caractères et la clé `service_role` Zurich. `--plan` ne se connecte pas ; `--check` effectue seulement les contrôles préalables.

Avant et après la transaction : exactement un superadmin, aucun club ni académie, aucune donnée métier, catalogues juridiques/règles/étiquette/validation/FTEM complets, illustrations rattachées à Zurich. Toute présence de données métier provoque un arrêt, sans nettoyage automatique. Le paramètre Contact est ajouté s’il manque ; une adresse configurée est conservée. Les données existantes sont contrôlées par empreinte et les règles MFA/journalisation par assertions.

Une sauvegarde chiffrée avant et après contient les schémas `public`, `auth`, `storage`, les octets des illustrations référencées, leurs métadonnées et l’ancien hook PostgREST. L’intégrité et la liste de l’archive PostgreSQL sont contrôlées. La restauration dans un projet séparé reste non vérifiée. La présence de fichiers Storage autres que les illustrations arrête l’opération.

La migration ne déploie pas l’application. Après son résultat confirmé, publier la branche dédiée sur le projet Vercel `activitee-app`, configurer le MFA du titulaire sur Zurich, puis vérifier une connexion réelle et un enregistrement Contact journalisé sur `activitee.app`. Le MFA de TEST ne configure pas le compte Zurich. Garder l’ancienne production sur `main`/`activitee.golf`.

## Contrôles SQL complémentaires

Le hook `check_application_session` protège les appels directs à PostgREST, y compris les RPC `SECURITY DEFINER`. Des politiques restrictives protègent aussi les tables RLS existantes, Realtime et `storage.objects`. Les politiques métier par rôle et organisation restent nécessaires. Une nouvelle table doit recevoir les mêmes politiques de session lors de sa création.

Le rôle `service_role` reste réservé au serveur. Il n’est pas soumis aux limites de session utilisateur ; les API doivent donc continuer à vérifier le titulaire, son rôle et sa cible avant chaque lecture ou écriture.

## Vérifications locales

```sh
node --experimental-strip-types --test tests/admin-security.test.ts tests/legal-admin-routes.test.ts tests/admin-platform-news.test.ts tests/manager-family-access.test.ts
node --test tests/admin-security-sql.test.mjs
npx tsc --noEmit
npm run build
```

Les tests SQL tournent dans PostgreSQL en mémoire et n’utilisent aucune base réelle. Les tests de routes vérifient séparément les refus, la fraîcheur MFA, les erreurs de signature et de journalisation, et l’absence de credentials dans le journal.

Trois tests antérieurs de `manager-security.test.ts` concernant les destinataires et l’envoi de rapports familiaux échouent également sur le commit d’origine, avant ce lot. Les 25 autres tests de ce fichier passent après les modifications.

## Récupération

En cas de perte de l’authentificateur, le propriétaire du projet Supabase doit vérifier l’identité et gérer le facteur depuis Supabase Auth. L’application n’offre pas de suppression du facteur avec une simple session mot de passe.

Pour un retour arrière, remettre le code précédent et restaurer les fonctions/politiques ainsi que le hook PostgREST à partir du schéma antérieur. Conserver les événements du journal. Ne pas désactiver le MFA ni retirer les règles de session pour contourner un problème de connexion.
