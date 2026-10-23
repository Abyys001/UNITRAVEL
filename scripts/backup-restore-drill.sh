#!/usr/bin/env bash
# Backup restore drill (booklet ch. 30.6): logical dump of the live database, restore into a scratch database,
# row-count comparison on every table, timed. Production uses WAL archiving + PITR; this drill proves the dumps restore.
set -euo pipefail
PG="${PG_CONTAINER:-unitravel-dev-postgres-1}"
SRC="${SRC_DB:-unitravel}"; DST="${SRC}_restore_drill"
OUT="${OUT_DIR:-$(dirname "$0")/../.run}/drill-$(date -u +%Y%m%dT%H%M%SZ).dump"
mkdir -p "$(dirname "$OUT")"
psqlc() { docker exec -i "$PG" psql -U unitravel -v ON_ERROR_STOP=1 -qtA "$@"; }

t0=$(date +%s.%N)
docker exec "$PG" pg_dump -U unitravel -Fc -Z 6 "$SRC" > "$OUT"
t1=$(date +%s.%N)
psqlc -d postgres -c "DROP DATABASE IF EXISTS $DST" -c "CREATE DATABASE $DST"
docker exec -i "$PG" pg_restore -U unitravel -d "$DST" --no-owner --exit-on-error < "$OUT"
t2=$(date +%s.%N)

counts() { psqlc -d "$1" -c "SELECT string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text), ' ' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition"; }
if [ "$(counts "$SRC")" != "$(counts "$DST")" ]; then echo "MISMATCH between source and restored row counts" >&2; exit 1; fi
tables=$(psqlc -d "$DST" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
psqlc -d postgres -c "DROP DATABASE $DST"
printf 'dump %.1fs (%s)  restore %.1fs  tables %s  row counts identical\n' "$(echo "$t1-$t0" | bc)" "$(du -h "$OUT" | cut -f1)" "$(echo "$t2-$t1" | bc)" "$tables"
rm -f "$OUT"
