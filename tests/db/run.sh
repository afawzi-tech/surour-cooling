#!/usr/bin/env bash
# يشغّل schema.sql مرتين (للتأكد أنه آمن لإعادة التشغيل) ثم الاختبارات، على PostgreSQL محلي مؤقت.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
bin=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
tmp=$(mktemp -d); trap '"$bin/pg_ctl" -D "$tmp/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
chown -R postgres "$tmp" 2>/dev/null || true
as() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
as "'$bin/initdb' -D '$tmp/data' -A trust -U postgres >/dev/null"
as "'$bin/pg_ctl' -D '$tmp/data' -o '-k $tmp -p 54329 -c listen_addresses=' -l '$tmp/log' start -w >/dev/null"
psql() { PGOPTIONS="-c client_min_messages=warning" command psql -h "$tmp" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql -f "$here/stubs.sql"
psql -f "$root/supabase/schema.sql" >/dev/null
psql -f "$root/supabase/schema.sql" >/dev/null
for t in "$here"/test_*.sql; do echo "== $(basename "$t")"; psql -o /dev/null -f "$t"; done
echo "كل الاختبارات نجحت"
