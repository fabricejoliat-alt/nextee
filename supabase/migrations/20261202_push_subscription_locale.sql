-- Language of each installed app/browser, used for localized notification templates.
begin;
alter table public.push_subscriptions add column if not exists locale text not null default 'fr';
alter table public.push_subscriptions drop constraint if exists push_subscriptions_locale_check;
alter table public.push_subscriptions add constraint push_subscriptions_locale_check check (locale in ('fr','en','de','it'));
commit;
