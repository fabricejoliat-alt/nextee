-- Batch 2: private, validated Player document storage.
-- Existing objects stay marked as `marketplace` until the storage migration
-- script has copied and verified them in the private bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-documents',
  'player-documents',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table if exists public.player_dashboard_documents
  add column if not exists storage_bucket text;

update public.player_dashboard_documents
set storage_bucket = 'marketplace'
where storage_bucket is null;

-- Keep the legacy default during the rolling deployment. Batch 2 routes always
-- write `player-documents` explicitly; older deployed routes remain compatible
-- until the application cutover is complete.
alter table public.player_dashboard_documents
  alter column storage_bucket set not null,
  alter column storage_bucket set default 'marketplace';

alter table public.player_dashboard_documents
  drop constraint if exists player_dashboard_documents_storage_bucket_check;
alter table public.player_dashboard_documents
  add constraint player_dashboard_documents_storage_bucket_check
  check (storage_bucket in ('marketplace', 'player-documents'));

alter table public.player_dashboard_documents
  drop constraint if exists player_dashboard_documents_new_private_bucket_check;
drop trigger if exists trg_require_private_bucket_for_new_player_document on public.player_dashboard_documents;
drop function if exists public.require_private_bucket_for_new_player_document();

alter table public.player_dashboard_documents
  drop constraint if exists player_dashboard_documents_storage_path_scope_check;
alter table public.player_dashboard_documents
  add constraint player_dashboard_documents_storage_path_scope_check
  check (
    storage_path like
      'player-documents/' || organization_id::text || '/' || player_id::text || '/%'
  ) not valid;

alter table public.player_dashboard_documents
  drop constraint if exists player_dashboard_documents_size_check;
alter table public.player_dashboard_documents
  add constraint player_dashboard_documents_size_check
  check (size_bytes is null or (size_bytes > 0 and size_bytes <= 104857600)) not valid;

create unique index if not exists idx_player_dashboard_documents_unique_storage_object
  on public.player_dashboard_documents (storage_path)
  where storage_bucket = 'player-documents';

create table if not exists public.player_document_upload_reservations (
  id uuid primary key,
  storage_bucket text not null check (storage_bucket = 'player-documents'),
  storage_path text not null unique,
  -- Deliberately no foreign keys: the cleanup ledger must survive deletion of
  -- the organization, player, uploader or event long enough to remove objects.
  organization_id uuid not null,
  player_id uuid not null,
  uploaded_by uuid not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  club_event_id uuid null,
  coach_only boolean not null default false,
  expires_at timestamptz not null,
  finalized_at timestamptz null,
  created_at timestamptz not null default now()
);

drop index if exists public.idx_player_document_upload_reservations_cleanup;
create index idx_player_document_upload_reservations_cleanup
  on public.player_document_upload_reservations (expires_at);

alter table public.player_document_upload_reservations enable row level security;
revoke all on table public.player_document_upload_reservations from anon, authenticated;

create table if not exists public.player_document_storage_deletions (
  id bigint generated always as identity primary key,
  storage_bucket text not null check (storage_bucket in ('marketplace', 'player-documents')),
  storage_path text not null,
  attempts integer not null default 0,
  last_error text null,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

alter table public.player_document_storage_deletions enable row level security;
revoke all on table public.player_document_storage_deletions from anon, authenticated;

create or replace function public.queue_player_document_storage_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.player_dashboard_documents document
    where document.storage_bucket = old.storage_bucket
      and document.storage_path = old.storage_path
  ) then
    insert into public.player_document_storage_deletions (storage_bucket, storage_path)
    values (old.storage_bucket, old.storage_path)
    on conflict (storage_bucket, storage_path) do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_queue_player_document_storage_deletion on public.player_dashboard_documents;
create trigger trg_queue_player_document_storage_deletion
after delete
on public.player_dashboard_documents
for each row execute function public.queue_player_document_storage_deletion();

create or replace function public.validate_player_document_event_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_event_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.club_events event
    join public.club_event_attendees attendee
      on attendee.event_id = event.id
     and attendee.player_id = new.player_id
    where event.id = new.club_event_id
      and event.club_id = new.organization_id
  ) then
    raise exception 'Invalid Player document event association'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_player_document_event_link on public.player_dashboard_documents;
drop trigger if exists trg_validate_player_document_event_link_insert on public.player_dashboard_documents;
drop trigger if exists trg_validate_player_document_event_link_update on public.player_dashboard_documents;
create trigger trg_validate_player_document_event_link_insert
before insert
on public.player_dashboard_documents
for each row execute function public.validate_player_document_event_link();

create trigger trg_validate_player_document_event_link_update
before update of organization_id, player_id, club_event_id
on public.player_dashboard_documents
for each row execute function public.validate_player_document_event_link();
