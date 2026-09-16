# Rappels des compétitions

Les rappels sont enregistrés dans `club_event_reminders` et exécutés exclusivement côté serveur par :

`GET /api/cron/competition-reminders`

Le fichier `vercel.json` appelle cette route toutes les cinq minutes. Vercel transmet la variable `CRON_SECRET` dans l’en-tête `Authorization`. Les variables suivantes doivent être configurées dans l’environnement de déploiement :

- `CRON_SECRET` : secret du job planifié ;
- `NEXT_PUBLIC_SUPABASE_URL` ;
- `SUPABASE_SERVICE_ROLE_KEY` ;
- `BREVO_API_KEY` pour le canal e-mail ;
- `MAIL_FROM` pour l’expéditeur Brevo (facultatif, valeur par défaut : `ActiviTee <noreply@activitee.golf>`) ;
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et éventuellement `VAPID_SUBJECT` pour les notifications push.

La fonction SQL `claim_due_club_event_reminders` verrouille et marque les rappels dus avant leur traitement. Un rappel n’est donc réclamé qu’une fois. Le statut final (`sent`, `failed` ou `cancelled`), `sent_at`, le nombre de tentatives et la dernière erreur sont conservés en base.

En local, le traitement peut être déclenché ainsi :

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/competition-reminders
```

Une compétition supprimée entraîne la suppression en cascade de son rappel. Une activité passée au statut `cancelled` annule automatiquement tout rappel encore en attente.
