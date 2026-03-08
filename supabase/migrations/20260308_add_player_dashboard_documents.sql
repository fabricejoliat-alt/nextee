-- Documents uploaded by staff for a player dashboard.

create table if not exists public.player_dashboard_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clubs(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text null,
  size_bytes bigint null,
  coach_only boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_dashboard_documents_player_created
  on public.player_dashboard_documents (player_id, created_at desc);

create index if not exists idx_player_dashboard_documents_org
  on public.player_dashboard_documents (organization_id, created_at desc);

alter table if exists public.player_dashboard_documents enable row level security;

drop policy if exists "player_dashboard_documents_select_staff" on public.player_dashboard_documents;
create policy "player_dashboard_documents_select_staff"
on public.player_dashboard_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.club_members cm
    where cm.club_id = player_dashboard_documents.organization_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('manager', 'coach')
  )
);

drop policy if exists "player_dashboard_documents_insert_staff" on public.player_dashboard_documents;
create policy "player_dashboard_documents_insert_staff"
on public.player_dashboard_documents
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.club_members cm
    where cm.club_id = player_dashboard_documents.organization_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('manager', 'coach')
  )
);

drop policy if exists "player_dashboard_documents_delete_staff" on public.player_dashboard_documents;
create policy "player_dashboard_documents_delete_staff"
on public.player_dashboard_documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.club_members cm
    where cm.club_id = player_dashboard_documents.organization_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('manager', 'coach')
  )
);

