-- Notification template overrides are saved for all four application locales.
-- Keep existing rows and the (locale, key) primary key unchanged.
alter table public.app_translations
  drop constraint if exists app_translations_locale_check;

alter table public.app_translations
  add constraint app_translations_locale_check
  check (locale in ('fr', 'en', 'de', 'it'));
