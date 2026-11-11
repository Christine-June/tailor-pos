#!/bin/sh
# Proves a backup can actually be restored, without touching the live database: restores it
# into a throwaway Postgres and checks the data is there. Run monthly (and after any change).
#   ./deploy/test-restore.sh                 newest backup in ./backups
#   ./deploy/test-restore.sh path/to.dump    a specific file
set -eu

FILE="${1:-$(ls -t backups/tailorpos-*.dump 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "No backup file found (looked in ./backups)." >&2; exit 1; }
NAME="tailorpos-restore-test-$$"
echo "Testing $FILE"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_USER=tailor -e POSTGRES_PASSWORD=test -e POSTGRES_DB=tailor_pos postgres:16-alpine >/dev/null
i=0
until docker exec "$NAME" pg_isready -U tailor -d tailor_pos >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "Test database didn't start." >&2; exit 1; }; sleep 1
done
sleep 2

docker exec -i "$NAME" pg_restore -U tailor -d tailor_pos --no-owner --exit-on-error < "$FILE"

docker exec "$NAME" psql -U tailor -d tailor_pos -At -c "
  SELECT 'schema version: ' || version_num FROM alembic_version;
  SELECT 'shops:          ' || count(*) FROM shops;
  SELECT 'customers:      ' || count(*) FROM customers;
  SELECT 'orders:         ' || count(*) FROM orders;
  SELECT 'payments:       ' || count(*) || ' (net ' || coalesce(sum(amount), 0) || ')' FROM payments;
  SELECT 'measurements:   ' || count(*) FROM measurements;
  SELECT 'latest order:   ' || coalesce(max(created_at)::text, 'none') FROM orders;"

# The append-only protection (payments, measurements, stock and status history, audit log)
# must come back with the data, or history could be edited after a restore.
TRIGGERS="$(docker exec "$NAME" psql -U tailor -d tailor_pos -At -c "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%\_append\_only'")"
if [ "$TRIGGERS" -ge 5 ]; then
  echo "append-only triggers: $TRIGGERS present"
else
  echo "append-only triggers: MISSING (found $TRIGGERS)" >&2; exit 1
fi
if docker exec "$NAME" psql -U tailor -d tailor_pos -At -c "DELETE FROM payments WHERE id IN (SELECT id FROM payments LIMIT 1)" >/dev/null 2>&1 \
  && [ "$(docker exec "$NAME" psql -U tailor -d tailor_pos -At -c "SELECT count(*) FROM payments")" != "0" ]; then
  echo "append-only check: deleting a payment was allowed" >&2; exit 1
fi
echo "Restore test passed."
