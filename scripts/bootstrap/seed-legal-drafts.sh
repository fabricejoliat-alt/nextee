#!/usr/bin/env bash
# One-time Zurich import. Text remains inactive and requires editorial review.
set -euo pipefail
umask 077

psql_bin=/opt/homebrew/opt/libpq/bin/psql
target_host=db.soivxpdcilgltbjbpimt.supabase.co
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
migration="$repo_root/supabase/bootstrap/club-legal-templates-zurich.sql"
generated=$(mktemp /private/tmp/activitee-zurich-legal-seed.XXXXXX)
trap 'rm -f "$generated"; unset db_password PGPASSWORD' EXIT
rm -f "$generated"
if [[ ! -x "$psql_bin" || ! -s "$migration" ]]; then
  printf 'Required psql or legal migration is missing.\n' >&2
  exit 1
fi
node "$repo_root/scripts/bootstrap/generate-legal-seed.mjs" "$generated"

IFS= read -r -s -p 'Zurich PostgreSQL password: ' db_password
printf '\n'
if [[ -z "$db_password" ]]; then
  printf 'Empty password; stopped.\n' >&2
  exit 1
fi
export PGPASSWORD="$db_password" PGSSLMODE=require
unset db_password
common=(--host="$target_host" --port=5432 --username=postgres --dbname=postgres --no-password --no-psqlrc -X -v ON_ERROR_STOP=1)
"$psql_bin" "${common[@]}" --quiet --single-transaction --file="$migration" --file="$generated"
printf 'Legal drafts and club templates committed to Zurich; publication remains inactive.\n'
