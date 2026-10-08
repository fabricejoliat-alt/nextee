#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
mode=${1:---plan}
node scripts/organizations/test-remodel.mjs --plan
if [[ "$mode" == --plan ]]; then exit 0; fi
if [[ "$mode" != --check && "$mode" != --apply ]]; then printf 'Use --plan, --check or --apply.\n' >&2; exit 1; fi
trap 'unset PGPASSWORD ACTIVITEE_BACKUP_PASSPHRASE db_password backup_passphrase' EXIT
IFS= read -r -s -p 'TEST PostgreSQL password (hidden): ' db_password
printf '\n'
[[ -n "$db_password" ]] || exit 1
export PGPASSWORD="$db_password"
unset db_password
if [[ "$mode" == --apply ]]; then
 IFS= read -r -s -p 'Backup passphrase, at least 16 characters (keep securely): ' backup_passphrase
 printf '\n'
 [[ ${#backup_passphrase} -ge 16 ]] || exit 1
 export ACTIVITEE_BACKUP_PASSPHRASE="$backup_passphrase"
 unset backup_passphrase
fi
node scripts/organizations/test-remodel.mjs "$mode"
