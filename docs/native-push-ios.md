# Notifications iOS natives

La PWA conserve Web Push/VAPID. Capacitor utilise le module officiel
`@capacitor/push-notifications` et APNs, sans Firebase.

## Déploiement

1. Appliquer `supabase/migrations/20261207_native_push.sql` au projet concerné.
2. Activer Push Notifications pour l’identifiant Apple `golf.activitee.app`.
3. Créer deux clés APNs **Topic Specific**, limitées à cet identifiant : Sandbox
   pour les installations Xcode, Production pour TestFlight/App Store.
4. Configurer ces secrets côté serveur Vercel, jamais en `NEXT_PUBLIC_*` :

| Variable | Valeur |
| --- | --- |
| `APNS_TEAM_ID` | Team ID Apple |
| `APNS_SANDBOX_KEY_ID` | Identifiant de la clé Sandbox |
| `APNS_SANDBOX_PRIVATE_KEY` | Contenu PEM du fichier `.p8` Sandbox |
| `APNS_KEY_ID` | Identifiant de la clé Production |
| `APNS_PRIVATE_KEY` | Contenu PEM du fichier `.p8` Production |

Les sauts de ligne PEM réels ou encodés `\n` sont acceptés. Ne pas committer
les clés, les afficher dans les logs ou les inclure dans l’app.

5. Déployer le serveur puis exécuter `npx cap sync ios`. Compiler et réinstaller
   avec l’équipe Apple Developer payante et un profil incluant `aps-environment`.
   Une publication web ne met pas à jour le binaire iOS déjà installé.

`NativePushContext` lit l’environnement du profil signé. Il distingue ainsi
les installations de développement et les archives exportées; App Store utilise
Production. Le simulateur utilise Sandbox. Xcode adapte l’entitlement de
développement lors de l’export en distribution.

## Comportement et vérification

- Activer Push dans les paramètres et accepter la demande iOS.
- Vérifier les catégories, notamment Messages du Marketplace.
- Déclencher une notification destinée au compte de test, vérifier l’alerte au
  premier plan, puis la réception quand l’app est en arrière-plan/verrouillée.
- Toucher une notification métier ouvre son écran après authentification.
- Tester le refus dans Réglages iOS, la désactivation dans ActiviTee, la
  reconnexion, puis le changement de compte.
- Vérifier séparément une installation TestFlight et une PWA existante.

Les préférences `receive_in_app`, `receive_push` et `enabled_kinds` sont communes
aux deux transports. Les tokens sont privés (API authentifiée, table inaccessible
au navigateur), liés à une session Supabase et supprimés en cascade lors de la
déconnexion ou de la suppression du compte. L’app renouvelle l’inscription au
lancement/retour au premier plan sans demander à nouveau une permission déjà
accordée. Une clé absente ou un échec d’APNs ne sont jamais présentés comme une
activation réussie. L’acceptation APNs ne prouve pas la réception sur le téléphone.

Tests :

```sh
node --experimental-strip-types --test tests/native-push.test.ts tests/native-push-sql.test.mjs tests/web-push.test.ts tests/coach-notification-settings.test.ts tests/coach-notification-toggle.test.ts
```
