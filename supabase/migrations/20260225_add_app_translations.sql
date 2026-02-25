-- Translation overrides editable from Admin module.

create table if not exists public.app_translations (
  locale text not null check (locale in ('fr', 'en')),
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (locale, key)
);

create index if not exists app_translations_locale_idx
  on public.app_translations (locale);

