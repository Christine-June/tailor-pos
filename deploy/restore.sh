#!/bin/sh
# Puts a backup back into the LIVE database, replacing what is there. For a disaster only:
# try deploy/test-restore.sh first. Takes a safety backup of the current data before it starts.
#   ./deploy/restore.sh backups/tailorpos-2026-11-11-0230.dump
set -eu

FILE="${1:?Usage: ./deploy/restore.sh backups/<file>.dump}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "This replaces ALL data in the live database with $FILE."
printf "Type RESTORE to continue: "
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

SAFETY="backups/before-restore-$(date +%Y-%m-%d-%H%M).dump"
echo "Saving the current data to $SAFETY first..."
$COMPOSE exec -T db pg_dump -U tailor -d tailor_pos --format=custom --no-owner > "$SAFETY"

echo "Stopping the API so nobody writes during the restore..."
$COMPOSE stop api backup

echo "Restoring..."
$COMPOSE exec -T db psql -U tailor -d postgres -c "DROP DATABASE tailor_pos WITH (FORCE);" -c "CREATE DATABASE tailor_pos OWNER tailor;"
$COMPOSE exec -T db pg_restore -U tailor -d tailor_pos --no-owner --exit-on-error < "$FILE"

echo "Starting the API (it applies any newer migrations)..."
$COMPOSE start api backup
echo "Done. Sign in and check today's orders and the cash-up."
