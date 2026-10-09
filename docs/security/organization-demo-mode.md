# Organisations de démonstration

## Comportement

`organizations.is_demo` est un booléen global, initialisé à `false` pour les organisations existantes. Le superadmin peut l'activer dès la création atomique de l'organisation ou dans ses paramètres. Le formulaire et le badge Démo utilisent les styles Admin existants et leurs nouveaux textes sont traduits FR/EN/DE/IT.

Les organisations de démo conservent leur accès aux règles, quiz et classement interne. L'API Règles filtre **avant** les agrégations et le calcul des positions interclubs. Elle retire les organisations de démo et les tentatives commencées dans une organisation de démo, même si une affiliation secondaire les rattache à un vrai club. Aucun club démo n'est réintroduit dans les résultats sous prétexte qu'il s'agit du club du joueur connecté. Une erreur de lecture du statut rend le classement indisponible ; elle ne rétablit pas les résultats démo.

Le mode ne modifie aucun score, ne désactive pas la participation aux quiz et n'accorde aucune autorisation juridique. Les modèles juridiques, rôles, MFA et consentements continuent à suivre les parcours habituels. Ce mode concerne l'exclusion du classement Règles interclubs ; il ne constitue pas une séparation complète entre données de démo et données de production pour toutes les statistiques du produit.

## Sécurité

Les API de création et sauvegarde restent protégées par les contrôles superadmin/MFA et le journal des mutations Admin. Les deux RPC sont réservées à `service_role`, vérifient le superadmin acteur et définissent le contexte requis par le trigger. Un manager ou un appel direct `authenticated` ne peut pas changer le mode. Une ancienne sauvegarde de paramètres qui omet `is_demo` conserve la valeur existante. Une chaîne `"false"` ou `null` est refusée plutôt que convertie implicitement.

## Activation

Appliquer d'abord dans TEST :

```sh
bash scripts/security/run-organization-demo-mode.sh --test --apply
```

Mot de passe PostgreSQL TEST, phrase de chiffrement d'au moins 16 caractères, confirmation. La sauvegarde chiffrée comprend `public`/`auth`/`storage`. Les fichiers Storage ne sont pas modifiés ; leurs octets ne sont pas inclus dans cette sauvegarde TEST.

Après validation de TEST, appliquer dans Zurich :

```sh
bash scripts/security/run-organization-demo-mode.sh --zurich --apply
```

Mot de passe PostgreSQL Zurich, phrase de chiffrement et confirmation, puis clé `service_role` Zurich. La commande exige la base propre avant/après, sauvegarde la base et les octets des illustrations avant la migration, puis crée un nouveau point de sauvegarde sans club avec le schéma actualisé. Les sauvegardes précédentes restent conservées. Les paramètres du fournisseur et secrets de déploiement doivent être configurés séparément lors d'une récupération ; une restauration complète dans un projet séparé reste à vérifier.

La transaction verrouille et compare les lignes de toutes les tables `public` existantes et `auth.users` avant/après, en ignorant uniquement la nouvelle colonne `is_demo` dans cette comparaison. Toute autre modification des enregistrements provoque un rollback. La migration ne crée aucune organisation, aucun utilisateur et aucune donnée de démo. Les modes `--plan` et `--check` ne modifient pas la base.

**Déployer le code après installation de la migration.** La nouvelle API ne contourne pas l'absence de colonne/RPC. Le projet Vercel `activitee-app` reçoit la branche dédiée ; ne pas pousser sur `main` ou `test` pour cette publication.

## Vérifications effectuées localement

- API : classement avec vrais clubs et club démo premier, résultats démo aussi liés à un vrai club, accès quiz et classement interne, absence de réinsertion du club démo, erreur de lecture.
- PostgreSQL isolé : création atomique, refus du manager et des écritures directes, conservation du mode par ancien client, valeurs strictes, réapplication et rollback si des données existantes sont modifiées.
- API Admin : autorisation, booléen de création/sauvegarde, omission par ancien client, traductions.
- TypeScript, lint ciblé et build de production isolé.

Les tests utilisent des données synthétiques locales. Ils ne remplacent pas l'application réelle des migrations, le déploiement et la vérification du formulaire Admin en production.

## Migrations vérifiées le 9 octobre 2026

- TEST : reçu `backups/checkpoints/receipts/test-demo-mode-1791569363244.json`, migration `d534e0bcaf6740545285e1f6b07dc0a30c1332f0625a79ac67d900966c1fe6d0`, 6 clubs, 7 organisations, 27 comptes, 1 superadmin et 19 versions juridiques conservés.
- Zurich : reçu `backups/checkpoints/receipts/zurich-demo-mode-1791569574776.json`, même empreinte de migration, zéro club/organisation et un seul compte superadmin conservés.
- Point de sauvegarde Zurich après migration : reçu `backups/checkpoints/receipts/zurich-clean-before-demo-1791569603713.json`. Archive chiffrée et 40 illustrations incluses ; empreinte SHA-256 de l'archive comparée au reçu et au fichier compagnon. Restauration complète non vérifiée.

Ces reçus et archives sont privés et exclus de Git. Leur vérification confirme les migrations et la conservation ; le résultat du déploiement et le contrôle du formulaire Admin restent distincts.
