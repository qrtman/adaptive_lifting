#!/usr/bin/env bash
# Restore drill: decrypt a downloaded backup and restore it into a throwaway local PostgreSQL 17.
# Usage: scripts/recovery/restore-drill.sh path/to/db-YYYYMMDDTHHMMSSZ.dump.age
# Needs: age, docker. Reads the bare AGE-SECRET-KEY-1... line from .env (never printed).
set -euo pipefail

file="${1:?usage: restore-drill.sh <backup.dump.age>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
key="$(grep -E '^AGE-SECRET-KEY-1' "$root/.env" | head -1 | tr -d ' ')"
[ -n "$key" ] || { echo "AGE-SECRET-KEY-1 line not found in .env"; exit 1; }

work="$(mktemp -d)"
name="al-restore-drill-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
umask 077

printf '%s\n' "$key" > "$work/key.txt"
age -d -i "$work/key.txt" -o "$work/db.dump" "$file"
echo "Decrypted OK ($(stat -c %s "$work/db.dump") bytes)"

docker run -d --name "$name" -e POSTGRES_PASSWORD=drill postgres:17 >/dev/null
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2

# Roles Supabase objects reference; harmless if unused.
docker exec "$name" psql -U postgres -qc "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role supabase_auth_admin nologin;" || true
docker cp "$work/db.dump" "$name:/tmp/db.dump"
docker exec "$name" pg_restore -U postgres -d postgres --no-owner --no-privileges /tmp/db.dump 2>&1 | tail -20 || true

docker exec "$name" psql -U postgres -qc "analyze;" || true
echo "--- Row counts after restore ---"
docker exec "$name" psql -U postgres -At -c "
select schemaname||'.'||relname, n_live_tup from pg_stat_user_tables
where schemaname in ('public','auth','al_private','supabase_migrations') and n_live_tup > 0 order by 1;" || true
docker exec "$name" psql -U postgres -At -c "select 'auth.users', count(*) from auth.users;" || true
