#!/usr/bin/env bash
# Run a read-only image transfer preview, or --apply after inspecting it.
set -euo pipefail
umask 077
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
if [[ ! -s .env.local ]]; then
  printf 'TEST .env.local is missing.\n' >&2
  exit 1
fi
if [[ "${1:-}" != "" && "${1:-}" != "--apply" ]]; then
  printf 'Usage: bash scripts/bootstrap/run-validation-image-transfer.sh [--apply]\n' >&2
  exit 1
fi
IFS= read -r -s -p 'Zurich Supabase service_role key: ' target_key
printf '\n'
if [[ -z "$target_key" ]]; then
  printf 'Empty key; stopped.\n' >&2
  exit 1
fi
export TARGET_SUPABASE_URL=https://soivxpdcilgltbjbpimt.supabase.co
export TARGET_SUPABASE_SERVICE_ROLE_KEY="$target_key"
unset target_key
trap 'unset TARGET_SUPABASE_SERVICE_ROLE_KEY' EXIT
node --env-file=.env.local scripts/bootstrap/transfer-validation-images.mjs "$@"
