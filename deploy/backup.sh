#!/bin/sh
# Daily database backup. Runs in the "backup" container (postgres image, so pg_dump matches the server).
#   BACKUP_TIME       shop-local time to run, HH:MM (default 02:30, TZ sets the zone)
#   BACKUP_KEEP_DAYS  days of backups to keep in /backups (default 14)
# Each file is a complete, compressed dump: deploy/restore.sh puts it back.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
AT="${BACKUP_TIME:-02:30}"

backup() {
  name="tailorpos-$(date +%Y-%m-%d-%H%M).dump"
  echo "$(date) backup: writing $name"
  # Written under a temporary name first, so a half-written file is never mistaken for a backup.
  if pg_dump --format=custom --compress=6 --no-owner --file="/backups/.$name.partial" \
    && pg_restore --list "/backups/.$name.partial" >/dev/null; then
    mv "/backups/.$name.partial" "/backups/$name"
    date +%Y-%m-%d > /backups/.last-success
    echo "$(date) backup: ok ($(du -h "/backups/$name" | cut -f1))"
  else
    rm -f "/backups/.$name.partial"
    echo "$(date) backup: FAILED" >&2
    return 1
  fi
  find /backups -name 'tailorpos-*.dump' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/backup: removed old /'
}

mkdir -p /backups
# A fresh server (or one that was off at backup time) gets a backup straight away.
if [ "$(cat /backups/.last-success 2>/dev/null || true)" != "$(date +%Y-%m-%d)" ]; then
  backup || true
fi

echo "$(date) backup: next runs daily at $AT ($TZ)"
while true; do
  sleep 30
  if [ "$(date +%H:%M)" = "$AT" ] && [ "$(cat /backups/.last-success 2>/dev/null || true)" != "$(date +%Y-%m-%d)" ]; then
    backup || true
  fi
done
