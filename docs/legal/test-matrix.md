# Scénarios à exécuter sur une base locale isolée

> **Mise à jour — reprise TEST du 4 octobre 2026 :** voir le [rapport unique](campaign-report-2026-10-04.md). Le lot `20261102` est appliqué sur TEST et son postflight de 16 lignes vérifié. Publication, décisions, V2, parent/code, refus et retrait ont été exercés avec fixtures dans Chrome ; corrections d’interface locales encore à déployer. Le garde reste désactivé. Les notes de préparation ci-dessous sont historiques ; elles ne remplacent pas cet état courant.

Aucun de ces scénarios n'a été exécuté sur une base réelle pendant la préparation. Utiliser uniquement des comptes, clubs, adresses et textes fictifs. Vérifier les réponses API **et** l'état SQL après chaque opération.

| Scénario | Résultat attendu |
|---|---|
| Brouillon FR modifié pendant la génération EN ; deux éditeurs simultanés | Réponse tardive ou édition concurrente refusée ; autres langues à revoir |
| Publication avec langue manquante, non approuvée ou sans revue de règle | Refus, aucune version créée |
| Variables déclarées modifiées, traduction avec une occurrence manquante ou `{{email}}` inconnue | Toutes les langues à revoir ; publication refusée avant revalidation |
| Admin ouvre la comparaison puis un autre Admin modifie le brouillon, la règle ou publie une version | Publication refusée ; nouvel aperçu et nouvelle confirmation requis |
| Appel direct des quatre RPC de mutation après préparation du garde, contrôle SQL inactif | Même résultat métier qu'avant migration ; fonctions `_business` inaccessibles aux rôles clients |
| Après future levée explicite de la contrainte d'inactivité dans une base jetable : appel direct des quatre RPC par un acteur sans validation requise | Refus avant toute écriture ; aucune activité, partie ou modification du mode performance |
| Après le lot des 17 tables privées : lecture/écriture PostgREST directe en `anon` et `authenticated` | Accès refusé, même avec un identifiant de ligne connu ; les routes serveur autorisées continuent de fonctionner |
| Lecture directe de `app_translations` et tentative d'écriture cliente | Lecture des traductions autorisée ; insertion, modification et suppression refusées |
| Appel direct de `om_recompute_round` en `anon` ou par un autre joueur, puis par le propriétaire ou parent éditant la partie | Les deux premiers sont refusés sans recalcul ; les deux derniers conservent le résultat métier |
| Après le lot golf : sauvegarde trou par trou, grille 9/18, édition des métadonnées, Miss cut et recalcul OM | Mêmes résultats métier et aucun blocage avec contrôle SQL inactif ; fonctions `_business` inaccessibles aux clients |
| Après le lot classement : appels directs aux deux surcharges `om_ranking_snapshot`, pages Player/Coach et vue Manager | Même classement avec garde inactif ; fonctions métier refusées aux clients ; appel anonyme refusé |
| Après le lot Manager : archivage d'un groupe et écritures OM fictifs, avec Manager d'un autre club | Manager autorisé : même résultat métier ; autre club et `anon` : refus sans mutation |
| Après le lot édition d'événements : occurrence et série Coach/Manager fictives, modification concurrente, présences et évaluations déjà enregistrées | Même résultat transactionnel avec garde inactif ; refus des éditions étrangères et des conflits sans perte d'historique |
| Après le lot RPC groupé 20261101 : structure, compétition, évaluation, OM, fils d'événement, quiz de règles, archivage de catégories/joueurs et publication Étiquette avec fixtures fictives | Parcours autorisés inchangés avec garde inactif ; appels `anon` et corps `_business` refusés ; fonctions internes toujours utilisables par les RPC privilégiés |
| Texte fictif avec `child_name`, `club_name`, `user_name` en FR/EN/DE/IT | Présentation contenant les valeurs de profil/club exactes ; même texte et même empreinte dans la décision |
| Profil sans nom, document plateforme utilisant `club_name`, bénéficiaire adulte avec `child_name` | Présentation refusée sans substitution partielle |
| Publication puis correction mineure | Nouvelle version ; ancienne version et décisions inchangées |
| Présentation V1, publication V2, validation V1 | 409 ; aucune décision ; V2 doit être réaffichée |
| Deux clics et reprise réseau avec même clé | Un événement ; identifiant stable |
| Refus/retrait du consentement facultatif | État courant concerné seulement ; journal préservé ; autres documents inchangés |
| Deux parents, retrait par l'un puis tentative d'autorisation par l'autre | Conflit ; aucune réautorisation silencieuse |
| Parent sans assertion vérifiée, lien révoqué, club différent, Manager utilisant mot de passe parent | Aucune décision parentale possible par substitution |
| Code parent : expiré, faux cinq fois, utilisé, autre enfant, ancien texte, e-mail changé | Décision positive refusée ; aucun secret dans réponse/log/export |
| Junior et adulte `adult` historique | Aucun statut historique converti en CGU acceptées |
| Accès direct avec rôle `anon`/`authenticated` aux tables et RPC ; accès Storage | Refus ; vérifier séparément tous les buckets concernés |
| Garde SQL de table désactivé, puis activé seulement dans une transaction de fixture isolée | Désactivé : droits historiques inchangés ; activé : CGU plateforme et notice du club requis selon le rôle, sans propager le blocage au club voisin |
| Drapeau HTTP activé par erreur alors que la commande SQL reste verrouillée | Pages/API métier en échec explicite ; textes juridiques, gestion des décisions et aide toujours accessibles ; aucune vue protégée conservée au retour au premier plan |
| Ancienne app, PWA hors ligne, retour premier plan, changement de rôle/club/enfant | Aucun accord hors ligne ; état serveur rechargé ; fonctions protégées refusées si accord requis |
| Clavier/lecteur d'écran, mobile iOS safe area, FR/EN/DE/IT | Textes exacts sans fallback ; formulaires utilisables |
| Demande de droits publique et fermeture de compte | Demande persistée, vérification d'identité, exécution contrôlée ; aucune suppression immédiate |

Le garde des pages/API métier est codé derrière `LEGAL_ENFORCEMENT_ENABLED`, mais reste désactivé. Les lignes relatives aux accès Supabase directs, au traitement différé des retraits, aux règles juridiques complexes, à Storage et aux parcours en mode hors ligne **échoueront ou restent non démontrables** dans ce lot inactif. Elles sont des critères bloquants pour l'activation, pas des tests annoncés comme réussis.
