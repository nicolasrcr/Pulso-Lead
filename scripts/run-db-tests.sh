#!/usr/bin/env bash
# Aplica as migrations em um Postgres descartável e roda db/tests/*.sql.
# Uso: DATABASE_URL=postgres://superuser@host/db scripts/run-db-tests.sh
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL (superuser ou dono do schema)}"
cd "$(dirname "$0")/../db"
for f in migrations/*.sql; do echo "-> $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f seed.sql
for t in tests/*.sql; do echo "-> $t"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$t"; done
