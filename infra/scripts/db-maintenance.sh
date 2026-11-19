#!/bin/sh
# Runs inside the db-maintenance service (infra/compose.prod.yml). Once at start, then every 24 hours:
#   1. ensure_monthly_partitions for the partitioned tables (owner role; migration 0001),
#   2. pg_dump (custom format, compressed) to /backups, keeping BACKUP_KEEP_DAYS days.
# Output is one line per step so `docker compose logs db-maintenance` shows the last run.
set -eu
umask 077
KEEP="${BACKUP_KEEP_DAYS:-14}"
while true; do
  started=$(date -u +%Y%m%dT%H%M%SZ)
  if psql "$DATABASE_MIGRATE_URL" -v ON_ERROR_STOP=1 -qAt -c "SELECT ensure_monthly_partitions('audit_log'); SELECT ensure_monthly_partitions('provider_calls');" >/dev/null; then
    echo "$started partitions ok"
  else
    echo "$started partitions FAILED" >&2
  fi
  out="/backups/unitravel-$started.dump"
  if pg_dump "$DATABASE_MIGRATE_URL" --format=custom --compress=9 --file="$out.part" && mv "$out.part" "$out"; then
    echo "$started backup ok $(du -h "$out" | cut -f1) $out"
  else
    rm -f "$out.part"; echo "$started backup FAILED" >&2
  fi
  find /backups -name 'unitravel-*.dump' -mtime +"$KEEP" -delete
  sleep 86400
done
