# Production web server: builds the app, then serves it with Caddy, which also gets and renews
# the HTTPS certificate and forwards /api to the Flask server.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The licence list is regenerated on every release and the build fails on a problem licence.
RUN npm run licenses && npm run build

FROM caddy:2.10-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
