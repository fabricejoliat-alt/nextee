#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
mode=${1:---plan}
if [[ $# -gt 1 || ( "$mode" != --plan && "$mode" != --check && "$mode" != --backup ) ]]; then
  printf 'Use --plan, --check or --backup. Zurich only; no migrations.\n' >&2; exit 1
fi
node scripts/security/zurich-clean-checkpoint.mjs --plan
if [[ "$mode" == --plan ]]; then exit 0; fi
trap 'unset PGPASSWORD ACTIVITEE_BACKUP_PASSPHRASE TARGET_SUPABASE_URL TARGET_SUPABASE_SERVICE_ROLE_KEY checkpoint_password checkpoint_passphrase checkpoint_confirmation checkpoint_key' EXIT
IFS= read -r -s -p 'Zurich PostgreSQL password (hidden): ' checkpoint_password
printf '\n'
[[ -n "$checkpoint_password" ]] || exit 1
export PGPASSWORD="$checkpoint_password"; unset checkpoint_password
if [[ "$mode" == --backup ]]; then
  IFS= read -r -s -p 'Backup passphrase, at least 16 characters (keep it securely): ' checkpoint_passphrase
  printf '\n'
  [[ ${#checkpoint_passphrase} -ge 16 ]] || { printf 'Passphrase too short. No changes made.\n' >&2; exit 1; }
  IFS= read -r -s -p 'Confirm backup passphrase (hidden): ' checkpoint_confirmation
  printf '\n'
  [[ "$checkpoint_passphrase" == "$checkpoint_confirmation" ]] || { printf 'Passphrases differ. No changes made.\n' >&2; exit 1; }
  export ACTIVITEE_BACKUP_PASSPHRASE="$checkpoint_passphrase"; unset checkpoint_passphrase checkpoint_confirmation
  IFS= read -r -s -p 'Zurich Supabase service_role key (hidden): ' checkpoint_key
  printf '\n'
  [[ -n "$checkpoint_key" ]] || exit 1
  export TARGET_SUPABASE_URL=https://soivxpdcilgltbjbpimt.supabase.co
  export TARGET_SUPABASE_SERVICE_ROLE_KEY="$checkpoint_key"; unset checkpoint_key
fi
node scripts/security/zurich-clean-checkpoint.mjs "$mode"
