#!/usr/bin/env bash
# Install the reviewed public schema in the dedicated, empty Zurich project.
# The transaction rolls back in full if PostgreSQL rejects any statement.
set -euo pipefail
umask 077

psql_bin=/opt/homebrew/opt/libpq/bin/psql
source_dump=/private/tmp/activitee-test-public-schema-20261006.sql
expected_sha=eff5254656a60a9c203a713d43ebd8d31b726e8ba835509735b5c608d7d38eb8
target_host=db.soivxpdcilgltbjbpimt.supabase.co

if [[ ! -x "$psql_bin" || ! -f "$source_dump" ]]; then
  printf 'Required psql or schema export is missing.\n' >&2
  exit 1
fi
actual_sha=$(shasum -a 256 "$source_dump" | awk '{print $1}')
if [[ "$actual_sha" != "$expected_sha" ]]; then
  printf 'Schema checksum differs from the reviewed export; stopped.\n' >&2
  exit 1
fi
if /usr/bin/grep -Eq '^(COPY |INSERT INTO |\\copy )' "$source_dump"; then
  printf 'Schema export unexpectedly contains data; stopped.\n' >&2
  exit 1
fi

prepared=$(mktemp /private/tmp/activitee-zurich-public-schema.XXXXXX)
trap 'rm -f "$prepared"; unset db_password PGPASSWORD' EXIT
# A new Supabase project already contains public. PostgreSQL on the destination
# also forbids changing default privileges owned by the internal supabase_admin
# role; its built-in defaults stay in place. Preserve every application object.
internal_acl_count=$(/usr/bin/grep -Ec '^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public ' "$source_dump")
if [[ "$internal_acl_count" != 12 ]]; then
  printf 'Unexpected Supabase internal ACL count; stopped.\n' >&2
  exit 1
fi
sed -e 's/^CREATE SCHEMA public;$/-- public schema already exists in Supabase/' \
    -e '/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public /d' \
    "$source_dump" > "$prepared"
if /usr/bin/grep -Eq '^CREATE SCHEMA public;$|^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public ' "$prepared"; then
  printf 'Could not prepare the schema export; stopped.\n' >&2
  exit 1
fi

IFS= read -r -s -p 'Zurich PostgreSQL password: ' db_password
printf '\n'
if [[ -z "$db_password" ]]; then
  printf 'Empty password; stopped.\n' >&2
  exit 1
fi
export PGPASSWORD="$db_password" PGSSLMODE=require
unset db_password
common=(--host="$target_host" --port=5432 --username=postgres --dbname=postgres --no-password --no-psqlrc -X -v ON_ERROR_STOP=1)

preflight=$("$psql_bin" "${common[@]}" --tuples-only --no-align -c \
  "select current_setting('server_version_num')::integer >= 170000
     and (select count(*) from information_schema.tables where table_schema = 'public') = 0
     and (select count(*) from auth.users) = 0
     and (select count(*) from pg_extension where extname in ('pgcrypto', 'uuid-ossp')) = 2")
if [[ "$preflight" != t ]]; then
  printf 'Target is not an empty compatible Supabase project; stopped.\n' >&2
  exit 1
fi

"$psql_bin" "${common[@]}" --quiet --single-transaction --file="$prepared"
printf 'Schema import committed to Zurich. Verify postflight before adding reference data.\n'
