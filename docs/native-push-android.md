# Notifications Android

Le package `golf.activitee.app` utilise le projet Firebase
`activitee-android-push`. Le client Capacitor Push Notifications reçoit les
messages FCM ; `NativePushContextPlugin` expose la configuration Android et
crée le canal `activitee`. Le démarrage automatique de Firebase Messaging et
Analytics sont désactivés. L'inscription suit le choix explicite Oui, y compris
sur Android antérieur à 13 où la permission système est accordée par défaut.

## Configuration

- Placer le fichier Firebase client dans `android/app/google-services.json`
  (ignoré par Git), puis reconstruire l'APK.
- Appliquer `supabase/migrations/20261210_android_push.sql` avant d'activer le
  serveur FCM. La table est accessible uniquement au service serveur et les
  inscriptions disparaissent avec la session ou le compte.
- Configurer côté serveur `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` et
  `FCM_PRIVATE_KEY`, à partir d'un compte technique dédié disposant du rôle
  `roles/firebasecloudmessaging.admin`. La clé privée doit rester dans les
  variables sécurisées du déploiement et hors du dépôt et de l'APK.
- Ne pas modifier les variables APNs existantes : le circuit iOS et sa table
  restent distincts. Le circuit Web Push conserve ses variables VAPID.

## Parcours

Le choix Oui / Non est mémorisé par compte sur chaque appareil. Non ne change
pas les préférences globales du compte. Oui demande l'autorisation au système,
enregistre le token via `/api/push/android`, puis active la préférence push
uniquement après réussite. Le réglage permet une activation ultérieure.
Une permission refusée se réactive dans les paramètres du système.

Les envois respectent les préférences et catégories existantes. Le serveur
utilise OAuth 2 et l'API FCM HTTP v1 ; seul un token explicitement UNREGISTERED
est supprimé après une réponse de FCM. Un défaut d'identifiants ou de droits ne
supprime pas les appareils.

## Vérification avant publication

Exécuter les tests Android, onboarding, natifs iOS, Web Push et SQL, le contrôle
TypeScript, le build web et `:app:assembleDebug :app:lintDebug`. Vérifier ensuite
sur un téléphone physique : premier choix Non, activation depuis les réglages,
autorisation système, réception en arrière-plan et ouverture de la bonne page.
Un build réussi ne prouve pas la livraison d'une notification sur le téléphone.
