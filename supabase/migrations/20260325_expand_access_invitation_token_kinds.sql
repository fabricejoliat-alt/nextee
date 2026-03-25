alter table if exists public.access_invitation_tokens
  drop constraint if exists access_invitation_tokens_kind_check;

alter table if exists public.access_invitation_tokens
  add constraint access_invitation_tokens_kind_check
  check (invitation_kind in ('parent_access', 'account_recovery'));

