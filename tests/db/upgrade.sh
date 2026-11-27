#!/usr/bin/env bash
# يتأكد أن تحديث قاعدة فيها النسخة السابقة من schema.sql يعطي نفس البنية تماماً كالتثبيت من الصفر.
# الاستخدام: tests/db/upgrade.sh <ملف schema.sql القديم>   (مثلاً: git show origin/main:supabase/schema.sql > /tmp/old.sql)
set -euo pipefail
old="$1"; here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
bin=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
tmp=$(mktemp -d); trap '"$bin/pg_ctl" -D "$tmp/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
cp "$old" "$tmp/old.sql"; chown -R postgres "$tmp" 2>/dev/null || true
as() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
as "'$bin/initdb' -D '$tmp/data' -A trust -U postgres >/dev/null"
as "'$bin/pg_ctl' -D '$tmp/data' -o '-k $tmp -p 54331 -c listen_addresses=' -l '$tmp/log' start -w >/dev/null"
psql() { PGOPTIONS="-c client_min_messages=warning" command psql -h "$tmp" -p 54331 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql -d postgres -c "create database upgraded" -c "create database fresh"
for db in upgraded fresh; do psql -d $db -f "$here/stubs.sql"; done
psql -d upgraded -f "$tmp/old.sql" >/dev/null
psql -d upgraded -f "$root/supabase/schema.sql" >/dev/null
psql -d fresh -f "$root/supabase/schema.sql" >/dev/null
psql -d upgraded -At -f "$here/catalog.sql" > "$tmp/a.txt"
psql -d fresh -At -f "$here/catalog.sql" > "$tmp/b.txt"
if diff -u "$tmp/a.txt" "$tmp/b.txt"; then echo "التحديث يطابق التثبيت من الصفر ($(wc -l < "$tmp/b.txt") عنصراً)"; else echo "اختلاف بين التحديث والتثبيت من الصفر" >&2; exit 1; fi
