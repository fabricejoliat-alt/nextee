# Point de sauvegarde Zurich avant le club de démo

Cette procédure vise uniquement le projet `soivxpdcilgltbjbpimt`. Elle ne charge aucun fichier `.env`, ne modifie aucune donnée et n'applique aucune migration. Les connexions PostgreSQL vérifient le certificat et imposent des transactions en lecture seule. Ne pas créer de club, importer de comptes ou modifier les documents pendant la capture.

## Exécution

Dans le Terminal :

```sh
cd /Users/activitee/Projects/nextee
bash scripts/security/run-zurich-clean-checkpoint.sh --backup
```

Saisir le mot de passe PostgreSQL **Zurich**, une phrase de chiffrement d'au moins 16 caractères, sa confirmation, puis la clé `service_role` **Zurich**. Les saisies sont masquées. Conserver la phrase dans un gestionnaire de mots de passe. Ne transmettre aucun de ces secrets dans une conversation.

`--plan` décrit l'opération sans connexion. `--check` demande uniquement le mot de passe PostgreSQL et vérifie la base en lecture seule, sans créer de sauvegarde.

## Conditions et contenu

- Exactement le superadmin existant dans Auth et son profil ; zéro club, académie et organisation ; aucune donnée métier dans les tables contrôlées par `organization-clean-base-check.sql`.
- Documents juridiques de plateforme actifs, modèles juridiques de club, catalogues Règles, Étiquette, Validation et FTEM présents ; illustrations rattachées à Zurich.
- Archive PostgreSQL des schémas `public`, `auth`, `storage`, contenant les données et leurs objets de schéma ; octets et métadonnées des illustrations Storage ; configuration du hook `authenticator` enregistrée dans les métadonnées.
- Lecture de toute l'archive PostgreSQL avec `pg_restore`, sans connexion à une destination. Déchiffrement du fichier sauvegardé et vérification de ses empreintes. Comparaison avant/après des catalogues, documents et identités, y compris compte Auth et facteur MFA.

Tout contrôle échoué interrompt la validation. Aucun nettoyage automatique n'est réalisé. Une archive peut avoir été créée avant un échec du contrôle final : seul le reçu final `checkpoint: passed` valide le point de sauvegarde.

## Conservation

Les archives horodatées et leurs fichiers `.sha256` sont dans `backups/checkpoints/`. Les reçus sont dans `backups/checkpoints/receipts/`. Ces dossiers sont exclus de Git. Le script ne remplace pas les sauvegardes précédentes.

Après validation, copier **l'archive chiffrée, son `.sha256` et son reçu** sur un stockage distinct du Mac, puis comparer le SHA-256 de la copie. Conserver la phrase de chiffrement séparément. Ne pas déplacer les seuls exemplaires disponibles.

## Limite de récupération

L'intégrité et la lecture de l'archive sont vérifiées ; une restauration complète dans un projet Supabase séparé n'est pas encore testée (`restore_verified: false`). Les paramètres du fournisseur, Auth/SMTP, DNS et les secrets Vercel ne sont pas une configuration de projet restaurable par cet export. Le hook PostgreSQL consigné dans le reçu doit être rétabli explicitement lors d'une restauration revue. Les schémas gérés par Supabase et les droits nécessitent une procédure adaptée à la destination ; ne pas importer cette archive directement dans la production existante pour la tester.
