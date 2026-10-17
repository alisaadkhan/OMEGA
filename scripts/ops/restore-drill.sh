#!/usr/bin/env bash
# Backup and restore drill (audit OPS-04), local and disposable. Backs up a copy of the synthetic E2E template with a
# workspace and credits, erases a creator AFTER the backup (as happens between a backup and a loss), exports the erasure
# journal, restores the backup into a new database, runs after-restore.ts, and checks that the data came back, the
# creator stays erased and the credits reconcile. Times are printed to compare with the owner's RTO.
# Usage: PG_BIN=... restore-drill.sh   (needs the template from scripts/e2e-fixtures/build-template.sh)
# The hosted drill (Supabase backup restored to a new project) uses the same after-restore step.
set -u
H="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$H/../.." && pwd)"
B="${PG_BIN:?set PG_BIN}"
SRC=mushin_restoredrill_src
DST=mushin_restoredrill_dst
T="$(node -p "require('os').tmpdir()")/mushin-restore-drill"
mkdir -p "$T" && rm -f "$T"/*
q() { "$B/psql" -h localhost -p 54330 -U postgres -d "$1" -Atc "$2"; }
fail() { echo "FAIL | $1"; exit 1; }
for d in $SRC $DST; do "$B/dropdb" -h localhost -p 54330 -U postgres --if-exists "$d" > /dev/null 2>&1; done
"$B/createdb" -h localhost -p 54330 -U postgres -T mushin_e2e_synthetic_template $SRC || exit 1
q $SRC "insert into wp.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'drill@example.com');
  insert into wp.workspaces (id, name, owner_user_id) values ('22222222-2222-4222-8222-222222222222', 'Drill', '11111111-1111-4111-8111-111111111111');
  insert into wp.workspace_members (workspace_id, user_id, role) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'owner');
  with l as (insert into wp.credit_lots (workspace_id, source, amount, remaining, expires_at) values ('22222222-2222-4222-8222-222222222222', 'trial', 200, 200, now() + interval '14 days') returning id)
  insert into wp.credit_ledger (workspace_id, amount, kind, lot_id, source_ref) select '22222222-2222-4222-8222-222222222222', 200, 'grant', id, 'trial:drill' from l;" > /dev/null || fail "seeding the source"
COUNTS="select (select count(*) from gcp.creators where status <> 'erased')||'/'||(select count(*) from gcp.creator_contacts)||'/'||(select count(*) from wp.credit_ledger)||'/'||(select count(*) from platform.schema_migrations)"
AT_BACKUP=$(q $SRC "$COUNTS")

t0=$(date +%s)
"$B/pg_dump" -h localhost -p 54330 -U postgres -Fc -f "$T/backup.dump" $SRC || fail "pg_dump"
t1=$(date +%s)
echo "PASS | backup taken in $((t1 - t0)) s ($(du -k "$T/backup.dump" | cut -f1) kB); counts creators/contacts/ledger/migrations = $AT_BACKUP"

# After the backup: a creator is erased (suppression recorded, profile gone), as the eraser does.
CHAI=$(q $SRC "select creator_id from gcp.creator_profiles where handle = 'fxchaicorner'")
q $SRC "insert into gcp.creator_suppressions (url_hash, platform) select encode(sha256(convert_to(lower(trim(canonical_url)), 'UTF8')), 'hex'), platform from gcp.creator_profiles where creator_id = '$CHAI';
  delete from gcp.creator_contacts where creator_id = '$CHAI'; delete from gcp.creator_profiles where creator_id = '$CHAI';
  update gcp.creators set status = 'erased', display_name = 'Erased creator' where id = '$CHAI';" > /dev/null || fail "erasing after the backup"

cd "$REPO" && source scripts/e2e-customer/env.sh
export DATABASE_URL="postgres://postgres@localhost:54330/$SRC" DIRECT_URL="postgres://postgres@localhost:54330/$SRC"
node --import tsx scripts/ops/export-erasure-journal.ts "$T/journal.json" 2>/dev/null | tail -1 || fail "journal export"
grep -q "fxchaicorner\|@example" "$T/journal.json" && fail "the journal contains readable personal data"
echo "PASS | erasure journal holds hashes only"

# Loss, then restore into a new database.
t2=$(date +%s)
"$B/createdb" -h localhost -p 54330 -U postgres $DST && "$B/pg_restore" -h localhost -p 54330 -U postgres -d $DST "$T/backup.dump" || fail "pg_restore"
t3=$(date +%s)
[ "$(q $DST "$COUNTS")" = "$AT_BACKUP" ] || fail "restored counts $(q $DST "$COUNTS") differ from the backup $AT_BACKUP"
[ "$(q $DST "select status from gcp.creators where id = '$CHAI'")" != "erased" ] || fail "expected the older backup to still hold the creator"
echo "PASS | restored in $((t3 - t2)) s; counts match the backup; the creator erased after the backup is back (as expected before re-applying)"

export DATABASE_URL="postgres://postgres@localhost:54330/$DST" DIRECT_URL="postgres://postgres@localhost:54330/$DST"
node --import tsx scripts/ops/after-restore.ts "$T/journal.json" 2>"$T/after-restore.err" || { grep -v "SSL_CA_FILE" "$T/after-restore.err" | tail -5; fail "after-restore reported a problem"; }
t4=$(date +%s)
[ "$(q $DST "select status from gcp.creators where id = '$CHAI'")" = "erased" ] || fail "the creator erased after the backup came back"
[ "$(q $DST "select count(*) from gcp.creator_contacts where creator_id = '$CHAI'")" = "0" ] || fail "its contacts came back"
echo "PASS | after re-applying the journal the creator is erased again (contacts gone); total restore time $((t4 - t2)) s"
for d in $SRC $DST; do "$B/dropdb" -h localhost -p 54330 -U postgres "$d"; done
