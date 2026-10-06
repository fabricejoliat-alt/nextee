# Formulaire de contact de la plateforme

La page `/contact` présente un formulaire protégé par Cloudflare Turnstile. L'API `/api/contact` vérifie le jeton côté serveur avant d'envoyer le message via Brevo. L'adresse du visiteur est placée dans `replyTo`, jamais dans `sender`. Un lien `mailto:` reste disponible si le formulaire ne charge pas.

Le destinataire est `info@activitee.golf` tant que la migration n'est pas appliquée. Après application de `supabase/migrations/20261106_platform_contact_settings.sql`, un administrateur de la plateforme peut modifier cette adresse dans `/admin/settings/contact`. La page publique et l'API d'envoi lisent cette valeur côté serveur.

## Configuration par environnement

Créer un widget Turnstile pour chaque domaine public utilisé et configurer :

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` : clé publique du widget Turnstile ;
- `TURNSTILE_SECRET_KEY` : secret du même widget, exclusivement côté serveur ;
- `BREVO_API_KEY` : clé API transactionnelle Brevo, exclusivement côté serveur ;
- `MAIL_FROM` : expéditeur vérifié dans Brevo, par exemple `ActiviTee <noreply@activitee.golf>`.

En développement local, sans clés Turnstile, les clés de test officielles sont utilisées. Le formulaire vérifie alors réellement le jeton de test, mais simule l'envoi : aucun e-mail n'est expédié. `CONTACT_MAIL_TRANSPORT=brevo` permet explicitement un envoi Brevo hors production pour un test encadré. En production, les clés de test sont refusées ; si une clé manque, le formulaire reste indisponible et le lien e-mail sert de recours.

Ne pas placer les secrets dans `NEXT_PUBLIC_*`, dans Git ou dans la configuration du navigateur. Configurer les variables distinctement sur TEST et sur la production. Ne pas activer l'envoi réel sur TEST avant d'avoir défini un destinataire de test et validé le domaine expéditeur Brevo.

Avant publication, faire relire la notice de confidentialité : le formulaire transmet le jeton de vérification à Cloudflare et le message à Brevo. Le formulaire ne doit pas être annoncé comme opérationnel tant que les clés réelles, la migration et un essai d'envoi contrôlé ne sont pas validés sur l'environnement cible.

## Base de données

Avant d'appliquer la migration sur TEST, vérifier le projet Supabase ciblé et exécuter en lecture seule :

```sql
select current_database(), current_user;
select to_regclass('public.platform_contact_settings') as existing_table;
```

Après l'application, vérifier en lecture seule :

```sql
select singleton, contact_email, updated_at from public.platform_contact_settings;
select relrowsecurity from pg_class where oid = 'public.platform_contact_settings'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'platform_contact_settings'
order by grantee, privilege_type;
```

Résultat attendu : une seule ligne `singleton=true`, RLS activée, aucun privilège direct pour `anon` ou `authenticated`. La modification de l'adresse passe uniquement par l'API Admin avec un jeton d'administrateur.
