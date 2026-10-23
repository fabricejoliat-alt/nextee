# ActiviTee — test Android

Ce projet Capacitor produit une application Android installable. Il charge
`https://activitee.app`, selon `../capacitor.config.ts`. Une connexion Internet
est nécessaire et les connexions utilisent les comptes de cette application.

## Ouvrir et installer

Depuis la racine du dépôt :

```sh
npx cap sync android
npx cap open android
```

Dans Android Studio, sélectionner un téléphone avec le débogage USB autorisé,
ou un émulateur, puis lancer la configuration `app` avec **Run**.

Le projet utilise Java 21, le SDK Android 36 et Android 7 minimum. Sur le Mac
de préparation, le SDK et Java sont configurés dans `local.properties` et
`.gradle/config.properties`, qui restent locaux. Le JDK compatible se trouve
dans `~/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home`.

## APK de test

Depuis le dossier `android` :

```sh
./gradlew :app:assembleDebug
```

Le fichier produit est `app/build/outputs/apk/debug/app-debug.apk`. Il est signé
avec la clé de développement locale et destiné aux essais, pas à Google Play.

## Fonctions natives

Les notifications Android utilisent Firebase Cloud Messaging. Le fichier local
`app/google-services.json` doit correspondre au projet Firebase et au package
`golf.activitee.app`. Il est ignoré par Git. La configuration serveur et le
parcours de vérification sont décrits dans `../docs/native-push-android.md`.

Une demande Oui / Non est présentée sur les appareils compatibles. Oui lance
l'autorisation système puis enregistre cet appareil ; Non mémorise le refus
sur cet appareil.

Le déverrouillage biométrique est proposé après connexion et dans les paramètres
du profil. Android choisit une biométrie forte compatible avec l’app (empreinte
ou visage selon le téléphone) ; le code, schéma ou mot de passe de l’appareil
sert de secours. Une activation exige une vérification biométrique réussie.
Le verrou natif masque le contenu au retour d’arrière-plan et au redémarrage.
La préférence est liée au compte sur cet appareil, exclue des sauvegardes et
retirée à la déconnexion. Les mots de passe et données biométriques ne sont
pas stockés par le module. Les quatre langues FR/EN/DE/IT sont prises en charge.

L’écran de lancement utilise le logo vectoriel ActiviTee d’iOS, sur fond vert.

Si le chargement de la page principale échoue, un écran hors connexion natif
remplace l’erreur Android. Il reste disponible sans Internet, propose Réessayer
et relance la page lorsque le réseau retrouve un accès Internet validé.
Le verrou biométrique reste prioritaire. Les erreurs de ressources secondaires
ne remplacent pas une page déjà utilisable. Les textes existent en FR/EN/DE/IT.
Ce comportement nécessite une nouvelle installation Android ; il ne rend pas
les données de l’app consultables ou modifiables hors connexion.
