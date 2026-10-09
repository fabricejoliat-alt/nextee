#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
mode=${1:---plan}
if [[ $# -gt 1 || ( "$mode" != --plan && "$mode" != --check && "$mode" != --apply && "$mode" != --plan-contact && "$mode" != --repair-contact ) ]]; then
  printf 'Use --plan, --check, --apply, --plan-contact or --repair-contact. This command only targets TEST.\n' >&2
  exit 1
fi
plan_mode=--plan
if [[ "$mode" == --repair-contact || "$mode" == --plan-contact ]]; then plan_mode=--plan-contact; fi
node scripts/security/test-admin-security.mjs "$plan_mode"
if [[ "$mode" == --plan || "$mode" == --plan-contact ]]; then exit 0; fi
trap 'unset PGPASSWORD ACTIVITEE_BACKUP_PASSPHRASE security_db_password security_backup_passphrase' EXIT
IFS= read -r -s -p 'TEST PostgreSQL password (hidden): ' security_db_password
printf '\n'
[[ -n "$security_db_password" ]] || exit 1
export PGPASSWORD="$security_db_password"
unset security_db_password
if [[ "$mode" == --apply || "$mode" == --repair-contact ]]; then
  IFS= read -r -s -p 'Backup passphrase, at least 16 characters (keep it securely): ' security_backup_passphrase
  printf '\n'
  [[ ${#security_backup_passphrase} -ge 16 ]] || { printf 'Passphrase too short. No changes made.\n' >&2; exit 1; }
  export ACTIVITEE_BACKUP_PASSPHRASE="$security_backup_passphrase"
  unset security_backup_passphrase
fi
node scripts/security/test-admin-security.mjs "$mode"
