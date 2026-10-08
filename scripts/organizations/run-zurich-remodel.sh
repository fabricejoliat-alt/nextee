#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
mode=${1:---plan}
node scripts/organizations/zurich-remodel.mjs --plan
if [[ "$mode" == --plan ]]; then exit 0; fi
if [[ "$mode" != --check && "$mode" != --apply && "$mode" != --backup ]]; then
  printf 'Use --plan, --check, --apply or --backup.\n' >&2; exit 1
fi
trap 'unset PGPASSWORD ACTIVITEE_BACKUP_PASSPHRASE TARGET_SUPABASE_SERVICE_ROLE_KEY TARGET_SUPABASE_URL db_password backup_passphrase target_key' EXIT
IFS= read -r -s -p 'Zurich PostgreSQL password (hidden): ' db_password
printf '\n'
[[ -n "$db_password" ]] || exit 1
export PGPASSWORD="$db_password"
unset db_password
if [[ "$mode" == --apply || "$mode" == --backup ]]; then
  IFS= read -r -s -p 'Backup passphrase, at least 16 characters (keep it securely): ' backup_passphrase
  printf '\n'
  [[ ${#backup_passphrase} -ge 16 ]] || exit 1
  export ACTIVITEE_BACKUP_PASSPHRASE="$backup_passphrase"
  unset backup_passphrase
  IFS= read -r -s -p 'Zurich Supabase service_role key (hidden): ' target_key
  printf '\n'
  [[ -n "$target_key" ]] || exit 1
  export TARGET_SUPABASE_URL=https://soivxpdcilgltbjbpimt.supabase.co
  export TARGET_SUPABASE_SERVICE_ROLE_KEY="$target_key"
  unset target_key
fi
node scripts/organizations/zurich-remodel.mjs "$mode"
