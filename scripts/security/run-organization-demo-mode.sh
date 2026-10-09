#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
environment=${1:-}
mode=${2:---plan}
if [[ $# -gt 2 || ( "$environment" != --test && "$environment" != --zurich ) || ( "$mode" != --plan && "$mode" != --check && "$mode" != --apply ) ]]; then
  printf 'Use --test or --zurich, then --plan, --check or --apply.\n' >&2; exit 1
fi
node scripts/security/organization-demo-migration.mjs "$environment" --plan
if [[ "$mode" == --plan ]]; then exit 0; fi
trap 'unset PGPASSWORD ACTIVITEE_BACKUP_PASSPHRASE TARGET_SUPABASE_URL TARGET_SUPABASE_SERVICE_ROLE_KEY demo_password demo_passphrase demo_confirmation demo_key' EXIT
IFS= read -r -s -p "${environment#--} PostgreSQL password (hidden): " demo_password
printf '\n'
[[ -n "$demo_password" ]] || exit 1
export PGPASSWORD="$demo_password"; unset demo_password
if [[ "$mode" == --apply ]]; then
  IFS= read -r -s -p 'Backup passphrase, at least 16 characters (keep it securely): ' demo_passphrase
  printf '\n'
  [[ ${#demo_passphrase} -ge 16 ]] || { printf 'Passphrase too short. No changes made.\n' >&2; exit 1; }
  IFS= read -r -s -p 'Confirm backup passphrase (hidden): ' demo_confirmation
  printf '\n'
  [[ "$demo_passphrase" == "$demo_confirmation" ]] || { printf 'Passphrases differ. No changes made.\n' >&2; exit 1; }
  export ACTIVITEE_BACKUP_PASSPHRASE="$demo_passphrase"; unset demo_passphrase demo_confirmation
  if [[ "$environment" == --zurich ]]; then
    IFS= read -r -s -p 'Zurich Supabase service_role key (hidden): ' demo_key
    printf '\n'
    [[ -n "$demo_key" ]] || exit 1
    export TARGET_SUPABASE_URL=https://soivxpdcilgltbjbpimt.supabase.co
    export TARGET_SUPABASE_SERVICE_ROLE_KEY="$demo_key"; unset demo_key
  fi
fi
node scripts/security/organization-demo-migration.mjs "$environment" "$mode"
