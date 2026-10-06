#!/usr/bin/env bash
# Run locally in the Codex terminal. The password is entered without echo and
# is never written to a file or shell history. Only database structure is dumped.
set -euo pipefail
umask 077

pg_dump_bin=/opt/homebrew/opt/libpq/bin/pg_dump
output=/private/tmp/activitee-test-public-schema-20261006.sql
host=db.wizbeuuvjibmmuxyynly.supabase.co

if [[ ! -x "$pg_dump_bin" ]]; then
  printf 'pg_dump is missing: %s\n' "$pg_dump_bin" >&2
  exit 1
fi
if [[ -e "$output" ]]; then
  printf 'Output already exists; refusing to overwrite: %s\n' "$output" >&2
  exit 1
fi

IFS= read -r -s -p 'TEST PostgreSQL password: ' db_password
printf '\n'
if [[ -z "$db_password" ]]; then
  printf 'Empty password; stopped.\n' >&2
  exit 1
fi

temporary=$(mktemp /private/tmp/activitee-test-schema.XXXXXX)
trap 'rm -f "$temporary"; unset db_password' EXIT
PGPASSWORD="$db_password" PGSSLMODE=require "$pg_dump_bin" \
  --schema-only --no-owner --schema=public \
  --host="$host" --port=5432 --username=postgres --dbname=postgres \
  --file="$temporary"
unset db_password
mv "$temporary" "$output"
printf 'Schema-only export saved: %s\n' "$output"
