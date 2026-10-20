# Suppression de compte — mise en service

Le titulaire ouvre **Profil → Supprimer mon compte**, confirme les conséquences
et saisit son mot de passe. Le serveur utilise exclusivement l’identité de sa
session : le parent supprime son propre compte, jamais celui de l’enfant affiché.
Une demande couvre tous les clubs. Le délai annoncé est de **30 jours maximum**.
Le titulaire peut annuler avant le début du traitement.

Le reçu contient un secret aléatoire de 256 bits dans le fragment de l’URL ; seul
son SHA-256 est enregistré. Le suivi fonctionne après la suppression du compte,
y compris pour les juniors sans adresse de courriel. Ne jamais journaliser ni
partager ce lien. Le statut public ne retourne ni identité ni adresse.

## Traitement

Dans **Administration → Documents juridiques → Suppressions de comptes** :

1. Charger les demandes et traiter d’abord les échéances proches ou dépassées.
2. Identifier la demande confirmée, puis saisir `SUPPRIMER`.
3. L’exécution efface les données personnelles, retire les liens familiaux et
   les accès à tous les clubs, puis supprime physiquement les fichiers avec
   l’API Storage. Les structures partagées sont conservées avec auteur nul.
4. Le compte Auth et le profil sont supprimés seulement après traitement des
   fichiers. Une dépendance inconnue bloque la finalisation, même si sa clé
   étrangère aurait permis une suppression en cascade.
5. En cas d’échec, la demande reste en cours et peut être reprise. Aucun message
   de réussite n’est envoyé avant la finalisation. Le reçu confirme alors le
   résultat ; un courriel est envoyé à l’adresse Auth vérifiée, si elle existe.

La vérification MFA récente et l’audit Admin existants s’appliquent. Un autre
administrateur doit traiter une demande visant un administrateur. Le traitement
est manuel et doit être assuré quotidiennement ; le cron ne prend pas la décision
de supprimer un compte.

Le cron horaire `/api/cron/account-deletion-followup` reprend les suppressions déjà
déclenchées par un administrateur après expiration des liens de téléversement
existants (deux heures, plus dix minutes de marge), réessaie les courriels,
supprime les reçus terminés après 90 jours et les limites de tentative après un
jour. Il renvoie un échec si un délai est dépassé ou une livraison échoue.
Configurer une alerte sur ces échecs dans l’exploitation Vercel.

## Déploiement

- Appliquer `supabase/migrations/20261203_account_deletion.sql` d’abord sur TEST,
  après les migrations juridiques, organisations, stockage des documents et
  sécurité Admin. La migration seule ne supprime aucun compte.
- Déployer le code et `vercel.json`. Conserver `CRON_SECRET`, `BREVO_API_KEY` et
  un expéditeur vérifié (`LEGAL_MAIL_FROM` ou `MAIL_FROM`) configurés. Aucun
  courriel réel ne doit partir des tests automatisés.
- Vérifier le parcours avec un compte fictif de chaque rôle et des fichiers
  fictifs sur TEST : demandes, annulation, reprise après échec Storage, absence
  finale du profil/Auth/données/fichiers et confirmation. Inclure le parent avec
  enfant et le coach avec activités partagées. Rejouer l’ancien JWT contre
  PostgREST/Storage pour confirmer le refus.
- Faire correspondre la politique de confidentialité au délai de traitement,
  à la conservation de 90 jours du reçu et à la politique réelle de sauvegarde.
  Cette implémentation ne modifie pas silencieusement les versions juridiques
  déjà publiées.
- Déployer la même migration/code sur l’environnement de production choisi,
  puis vérifier le parcours du binaire iOS.

## Périmètre et sauvegardes

Les annonces, messages envoyés, fichiers personnels ou téléversés par le compte,
rapports sportifs et décisions juridiques propres à la personne sont supprimés.
Les documents publics de gouvernance et les contenus institutionnels des clubs
ne sont pas supprimés avec le compte de leur rédacteur. Leurs identifiants
historiques de publication ne permettent plus une connexion.
Les autres comptes, clubs, événements et relations entre autres membres restent.

Les copies déjà envoyées par courriel ou téléchargées ne peuvent pas être
rappelées. Les sauvegardes Supabase et les archives externes ne sont pas purgées
par l’API applicative. Leur durée réelle doit être vérifiée avant la mise en
service. Une restauration doit réappliquer les suppressions **avant** de rouvrir
les accès ; conserver un registre d’effacement séparé du jeu de sauvegarde
pendant toute sa durée de restauration possible. Si cette durée dépasse 90 jours,
adapter la politique et ce registre avant activation.

Le schéma de référence des tests provient uniquement des métadonnées PostgREST de
TEST ; il ne contient aucune donnée utilisateur. Les essais SQL locaux incluent
les clés étrangères mais ne remplacent pas les essais sur les triggers et
contraintes complets de TEST.

Référence : [Apple — Offering account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).

## Texte à intégrer à la prochaine version de la notice

Vous pouvez demander la suppression définitive de votre compte depuis
« Profil → Supprimer mon compte ». Après confirmation de votre identité par
votre mot de passe, la demande concerne tous vos accès ActiviTee, dans tous vos
clubs. Elle est traitée dans les 30 jours. Vous pouvez l’annuler avant le début
du traitement. Les comptes de vos enfants et des autres membres ne sont pas
supprimés avec le vôtre.

Votre accès, profil, historique sportif personnel, annonces, messages et fichiers
associés sont supprimés. Les structures et contenus institutionnels des clubs
restent disponibles, sans votre attribution personnelle lorsque celle-ci peut
être retirée. Les documents publics de gouvernance ne sont pas supprimés avec
le compte de leur rédacteur.

La suppression terminée est confirmée sur votre reçu de suivi, accessible sans
connexion, et par courriel si votre compte possède une adresse vérifiée. Le reçu
et l’adresse de confirmation sont conservés pendant 90 jours pour vous permettre
de vérifier le traitement, puis effacés. Les copies déjà reçues par des
destinataires ne peuvent pas être rappelées. Les durées et conditions de
conservation des sauvegardes techniques suivent la section correspondante de
cette notice.

Avant publication, vérifier et renseigner les durées réelles de sauvegarde dans
la notice ; cette phrase ne doit pas servir à laisser ces durées indéterminées.
