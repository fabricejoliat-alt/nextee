import { readFileSync } from 'node:fs';

export function zurichSecurityBatch() {
  const source = readFileSync('docs/security/apply-admin-security.sql', 'utf8');
  const clean = readFileSync('supabase/bootstrap/organization-clean-base-check.sql', 'utf8');
  const contact = readFileSync('supabase/migrations/20261106_platform_contact_settings.sql', 'utf8');
  if ((source.match(/^begin;$/gm) ?? []).length !== 1 || (source.match(/^commit;$/gm) ?? []).length !== 1) {
    throw new Error('Unexpected Admin transaction boundaries');
  }
  return '-- Zurich only; no cleanup or imports. Stop if any club, academy or non-admin account exists.\n' + source
    .replace(/^begin;$/m, () => `begin;\nset local lock_timeout='10s';\nset local statement_timeout='120s';\nlock table public.organizations,public.clubs,public.organization_members,public.profiles,public.app_admins,auth.users in share row exclusive mode;\n${clean}`)
    .replace(/^create temp table admin_security_checkpoint/m, () => `${contact}\ncreate temp table admin_security_checkpoint`)
    .replace(/^commit;$/m, () => `${clean}\nselect 'zurich_admin_security_clean_base' as result, (select count(*) from public.clubs) as clubs, (select count(*) from public.organizations) as organizations, (select count(*) from auth.users) as users;\ncommit;`);
}
