#!/usr/bin/env bash
# Seed only platform reference catalogs in the dedicated Zurich project.
# No club, Auth user, profile, participation or historical record is copied.
set -euo pipefail
umask 077

psql_bin=/opt/homebrew/opt/libpq/bin/psql
target_host=db.soivxpdcilgltbjbpimt.supabase.co
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
validation_source="$repo_root/supabase/migrations/20260428_add_validations_module.sql"
validation_seed=$(mktemp /private/tmp/activitee-validation-seed.XXXXXX)
trap 'rm -f "$validation_seed"; unset db_password PGPASSWORD' EXIT

if [[ ! -x "$psql_bin" || ! -f "$validation_source" ]]; then
  printf 'Required psql or validation seed is missing.\n' >&2
  exit 1
fi
# The validation migration also creates tables already restored from TEST.
# Extract only its reference-data inserts, starting at their exact header.
sed -n '/^insert into public.validation_sections (slug, name, sort_order, is_active)$/,$p' \
  "$validation_source" > "$validation_seed"
if [[ "$(/usr/bin/grep -Ec '^insert into public.validation_sections |^insert into public.validation_exercises ' "$validation_seed")" != 2 ]]; then
  printf 'Unexpected validation seed structure; stopped.\n' >&2
  exit 1
fi

files=(
  "$repo_root/supabase/migrations/20260921_seed_2027_rules_curriculum.sql"
  "$repo_root/supabase/migrations/20260923_seed_rules_series_1_content.sql"
  "$repo_root/supabase/migrations/20260924_seed_rules_series_2_content.sql"
  "$repo_root/supabase/migrations/20260925_seed_rules_series_3_to_12_content.sql"
  "$repo_root/supabase/migrations/20261019_seed_etiquette_fr.sql"
  "$validation_seed"
  "$repo_root/supabase/migrations/20261109_seed_ftem_on_new_club.sql"
)
for file in "${files[@]}"; do
  if [[ ! -s "$file" ]]; then
    printf 'Seed file missing or empty: %s\n' "$file" >&2
    exit 1
  fi
done

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
  "select (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') = 139
     and (select count(*) from auth.users) = 0
     and (select count(*) from public.clubs) = 0
     and (select count(*) from public.rules_series) = 0
     and (select count(*) from public.etiquette_themes) = 0
     and (select count(*) from public.validation_sections) = 0")
if [[ "$preflight" != t ]]; then
  printf 'Zurich is not the expected empty reference base; stopped.\n' >&2
  exit 1
fi

file_args=()
for file in "${files[@]}"; do file_args+=(--file="$file"); done
"$psql_bin" "${common[@]}" --quiet --single-transaction "${file_args[@]}"
printf 'Rules, Etiquette, Validation and FTEM reference catalogs committed to Zurich.\n'
