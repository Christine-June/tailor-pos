#!/bin/sh
# Stops the demo. Add --wipe to also delete its data (the next start reloads fresh sample data).
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose -p tailorpos-demo --env-file .env.demo -f docker-compose.prod.yml -f docker-compose.demo.yml"
if [ "${1:-}" = "--wipe" ]; then
  $COMPOSE down -v
else
  $COMPOSE down
fi
echo "Demo stopped."
