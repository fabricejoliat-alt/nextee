#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
mode=${1:---plan}
if [[ $# -gt 1 || ( "$mode" != --plan && "$mode" != --check && "$mode" != --apply ) ]]; then
  printf 'Use --plan, --check or --apply. Zurich only.\n' >&2; exit 1
fi
node scripts/security/zurich-admin-security.mjs --plan
if [[ "$mode" == --plan ]]; then exit 0; fi
trap 'unset PGPASSWORD ACTIVITEE_BACKUP_PASSPHRASE TARGET_SUPABASE_URL TARGET_SUPABASE_SERVICE_ROLE_KEY security_zurich_password security_zurich_passphrase security_zurich_key' EXIT
IFS= read -r -s -p 'Zurich PostgreSQL password (hidden): ' security_zurich_password
printf '\n'
[[ -n "$security_zurich_password" ]] || exit 1
export PGPASSWORD="$security_zurich_password"; unset security_zurich_password
if [[ "$mode" == --apply ]]; then
 IFS= read -r -s -p 'Backup passphrase, at least 16 characters (keep it securely): ' security_zurich_passphrase
 printf '\n'
 [[ ${#security_zurich_passphrase} -ge 16 ]] || { printf 'Passphrase too short. No changes made.\n' >&2; exit 1; }
 export ACTIVITEE_BACKUP_PASSPHRASE="$security_zurich_passphrase"; unset security_zurich_passphrase
 IFS= read -r -s -p 'Zurich Supabase service_role key (hidden): ' security_zurich_key
 printf '\n'
 [[ -n "$security_zurich_key" ]] || exit 1
 export TARGET_SUPABASE_URL=https://soivxpdcilgltbjbpimt.supabase.co
 export TARGET_SUPABASE_SERVICE_ROLE_KEY="$security_zurich_key"; unset security_zurich_key
fi
node scripts/security/zurich-admin-security.mjs "$mode"
