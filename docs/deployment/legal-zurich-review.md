# Relecture juridique pour la nouvelle production Zurich

État au 6 octobre 2026 : trois documents de plateforme sont des brouillons inactifs dans le projet Supabase `soivxpdcilgltbjbpimt`. Les trois modèles de club sont également non approuvés. Aucune version Zurich n'est publiée et le contrôle juridique est désactivé.

## Correction factuelle déjà identifiée

La notice de confidentialité importée de TEST (`activitee_notice_donnees_personnelles`) indique dans ses quatre langues que le projet Supabase de production est en Irlande. Le nouveau projet est configuré en `eu-central-2`, Central Europe (Zurich), selon ses paramètres Supabase. La [liste officielle des régions Supabase](https://supabase.com/docs/guides/platform/regions) associe `eu-central-2` à Zurich et précise que la région détermine l'emplacement des données principales du projet, sans garantir que tous les autres traitements restent dans le même pays.

Une correction ciblée des brouillons FR, EN, DE et IT est conservée dans `supabase/bootstrap/correct-zurich-privacy-draft.sql` et a été appliquée le 6 octobre 2026 dans Zurich. Elle décrit **ce projet Zurich**, conserve les nuances déjà présentes sur les sauvegardes, fichiers et autres prestataires, et laisse les quatre traductions à relire. Elle ne doit pas être interprétée comme une affirmation générale que toute donnée ou tout accès technique reste en Suisse. Postflight SQL : révision 2, quatre langues à relire, document inactif, zéro version publiée, zéro club.

## Informations à confirmer avant publication

- **Vercel** : le texte importé décrit une exécution des fonctions aux États-Unis. Vérifier la région réelle du nouveau projet Vercel `activitee.app` une fois créé et déployé, puis corriger les quatre langues si nécessaire.
- **Domaine et contact** : l'application sera sur `activitee.app`, mais l'adresse `info@activitee.golf` peut rester le contact si elle est opérationnelle. Contrôler les liens vers le service, l'expéditeur et les réponses avant publication ; ne pas remplacer l'adresse de contact simplement à cause du nouveau domaine.
- **Prestataires et réglages** : confirmer les configurations effectives de Brevo, OpenAI, notifications et éventuels autres services pour la nouvelle production avant de reprendre les affirmations de TEST.
- **Parcours utilisateur** : relire le rendu des quatre langues, les variables de club et les rôles concernés dans l'application branchée à Zurich. Les modèles de club instanciés restent des brouillons propres à chaque club jusqu'à leur approbation et publication.

Le catalogue `supabase/bootstrap/legal-catalog-20261006.json` conserve le texte exporté de TEST et son empreinte pour la traçabilité. Les corrections éditoriales du nouveau projet doivent être faites dans les brouillons Zurich, puis revues et approuvées selon le module juridique. Aucun texte ne doit être activé automatiquement par ces notes.
