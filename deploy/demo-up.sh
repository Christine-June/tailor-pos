#!/bin/sh
# Starts the demo and gives you a public https link to send a prospect.
#   sh deploy/demo-up.sh            start (or restart) and share
#   sh deploy/demo-up.sh --fresh    wipe the demo first, so the sample week is up to date
# Press Ctrl+C to stop sharing; the demo keeps running on http://localhost:8080.
# Stop it completely with:  sh deploy/demo-down.sh
set -eu
cd "$(dirname "$0")/.."

COMPOSE="docker compose -p tailorpos-demo --env-file .env.demo -f docker-compose.prod.yml -f docker-compose.demo.yml"

# Random secrets for the demo, made once and kept out of git.
if [ ! -f .env.demo ]; then
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "SECRET_KEY=$(openssl rand -hex 32)"
    echo "JWT_SECRET_KEY=$(openssl rand -hex 32)"
    echo "SITE_ADDRESS=:80"
    echo "PUBLIC_URL=http://localhost:8080"
  } > .env.demo
  chmod 600 .env.demo
fi

if [ "${1:-}" = "--fresh" ]; then
  echo "Wiping the old demo data..."
  $COMPOSE down -v
fi

echo "Building and starting the demo (the first time takes a few minutes)..."
$COMPOSE up -d --build

printf "Waiting for it to be ready"
i=0
until curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 90 ] && { echo; echo "It didn't start. See: $COMPOSE logs api" >&2; exit 1; }
  printf "."; sleep 2
done
echo
echo "Demo running at http://localhost:8080"
echo
echo "Creating a public link. Send the https://....trycloudflare.com address it prints below."
echo "The link works while this window stays open. Press Ctrl+C to stop sharing."
echo
docker run --rm --network tailorpos-demo_default cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://web:80
