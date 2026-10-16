#!/usr/bin/env bash
# Builds the E2E template database from the repository alone (audit OPS-02): every migration, then the synthetic
# creator catalogue. No developer data and no provider data. Usage: PG_BIN=... build-template.sh
# Both harnesses (customer and staff) clone it before each run. Rebuild after adding a migration.
set -u
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
DB=mushin_e2e_synthetic_template
"$B/psql" -h localhost -p 54330 -U postgres -d postgres -qAtc "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB'" > /dev/null
"$B/dropdb" -h localhost -p 54330 -U postgres --if-exists "$DB" && "$B/createdb" -h localhost -p 54330 -U postgres "$DB" || exit 1
cd "$REPO" && source scripts/e2e-customer/env.sh
export DATABASE_URL="postgres://postgres@localhost:54330/$DB" DIRECT_URL="postgres://postgres@localhost:54330/$DB"
node --import tsx packages/db/src/migrate-cli.ts | tail -1 || exit 1
node --import tsx "$H/seed-fixtures.ts" || exit 1
