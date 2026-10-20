# Marketplace : publication et modération

Les annonces, y compris les annonces existantes lors de la migration, sont en
attente de validation. Le texte, les coordonnées et toutes les photos doivent
être examinés par le Manager du club ou l'Admin ActiviTee avant publication.
Modifier le contenu ou les images impose une nouvelle validation ; désactiver
ou réactiver une annonce ne permet pas de contourner un refus.

## Parcours

- Junior/Parent : Marketplace → annonce → Signaler l'annonce ou Bloquer ce vendeur.
- Parent : les blocages protègent l'enfant sélectionné. Les droits de modification
  sur cet enfant sont requis pour signaler, bloquer ou débloquer.
- Marketplace → Membres bloqués permet de débloquer un membre.
- Messages reçus permet de signaler et bloquer un expéditeur, même sans annonce.
  Le courriel de contact contient également un lien vers ce parcours. Les nouveaux
  messages sont conservés pour le destinataire et filtrés avant envoi (contenus
  manifestement abusifs, liens externes et HTML), avec une limite persistante.
- Manager → Marketplace ; Admin → Modération Marketplace.
- Le tableau de bord affiche les annonces et signalements en attente. Les
  Managers ne traitent que leurs clubs ; l'Admin utilise sa session avec MFA.
- Refuser/retirer une annonce ou suspendre un vendeur exige un motif. Une
  suspension masque ses annonces et interdit publication et contact dans le club.
- Un signalement reste ouvert jusqu'à son traitement explicite.
- Les règles et le contact public sont accessibles à `/legal/marketplace`
  en français, anglais, allemand et italien.

## Exploitation

Appliquer les migrations sur chaque base utilisée par l'application, y compris
la base TEST de localhost : `20261203_account_deletion.sql` (prérequis),
`20261204_marketplace_moderation.sql`, puis
`20261205_marketplace_private_bucket.sql`. Ne pas rejouer les deux premières
si elles sont déjà présentes. La troisième rend privé un ancien bucket public
sans supprimer les photos. Vérifier les tables de modération, les permissions
et le chargement connecté de la file avant de déclarer l'environnement prêt.

Le code ne remplace pas le travail de modération. L'Admin et les Managers doivent
consulter régulièrement la file et répondre rapidement aux signalements. Avant
la soumission App Store, désigner les personnes chargées de ce suivi et traiter
la file initiale des annonces existantes. Aucune annonce n'est automatiquement
considérée comme approuvée.

Les blocages s'appliquent aux listes, aux liens directs, aux nouveaux liens vers
les photos et au contact depuis l'application dans les deux sens. Ils ne peuvent
pas rappeler des coordonnées ou images déjà reçues, ni bloquer des échanges
externes. Les liens privés de photos expirent après quinze minutes.

## Validation

`npm run test:marketplace` vérifie les refus d'accès, le contexte Parent/Junior,
les clubs, les contacts bloqués, les uploads, la modération SQL et la suppression
d'un modérateur sans effacer les annonces d'autrui. Les scénarios SQL utilisent
une base PGlite isolée et le schéma anonymisé du dépôt.

Pour la recette authentifiée sur le déploiement :

1. Créer une annonce fictive avec photo : visible dans Mes annonces, invisible
   pour un autre membre avant validation.
2. La valider dans le bon club puis la consulter depuis l'autre membre.
3. Modifier son texte ou ajouter une photo : elle doit revenir en attente.
4. Signaler puis bloquer une annonce : vérifier la file de modération, le retrait
   de la liste et le refus du lien direct et du contact.
5. Débloquer ; refuser l'annonce ou suspendre le vendeur ; vérifier les effets.
6. Répéter avec un Parent agissant pour son enfant et un Manager d'un autre club.

Référence : [App Review Guidelines, 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).
