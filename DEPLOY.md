# Going live

One Linux server runs everything: Caddy (HTTPS and the app), the Flask API, PostgreSQL, Redis and a daily backup job, all from `docker-compose.prod.yml`.

```
 tablet / phone / PC ──HTTPS──▶ Caddy ──/api──▶ Gunicorn (Flask) ──▶ PostgreSQL
                                  │                    └──────────▶ Redis (login limits)
                                  └── the app (React build, service worker for offline)
                                        backup job ──daily──▶ ./backups ──▶ copy off the server
```

## 1. What you need

- **A server**: any Linux VPS with Ubuntu 24.04, 2 GB RAM, 1–2 CPUs and 25 GB disk is plenty for several shops. Pick a data-centre region close to Kenya for speed.
- **A domain**, e.g. `pos.yourshop.co.ke`. At your DNS provider, add an **A record** pointing it at the server's IP address.
- About 30 minutes.

## 2. Prepare the server

Log in with SSH, then:

```bash
sudo apt update && sudo apt -y upgrade
```

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

Allow only SSH and the web through the firewall (the database is never exposed):

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

Turn on automatic security updates:

```bash
sudo apt -y install unattended-upgrades && sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

## 3. Get the code and set the secrets

```bash
git clone https://github.com/<you>/tailor-pos.git && cd tailor-pos
```

```bash
cp .env.production.example .env && chmod 600 .env
```

Make three random values, one at a time, and paste them into `.env` (`POSTGRES_PASSWORD`, `SECRET_KEY`, `JWT_SECRET_KEY`):

```bash
openssl rand -hex 32
```

Then set `SITE_ADDRESS` and `PUBLIC_URL` to your domain:

```bash
nano .env
```

Keep a copy of `.env` somewhere safe (a password manager). If you rebuild the server you need the same `POSTGRES_PASSWORD` to reconnect to the database, and new `SECRET_KEY`/`JWT_SECRET_KEY` values sign everyone out.

## 4. Start it

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a few minutes. Caddy then fetches the HTTPS certificate by itself (it needs the A record from step 1 to be working). Check:

```bash
docker compose -f docker-compose.prod.yml ps
```

All services should be `Up`, and the API `healthy`. Open `https://pos.yourshop.co.ke`.

## 5. Create the shop and its owner

```bash
docker compose -f docker-compose.prod.yml exec api flask create-shop
```

It asks for the shop name, the owner's name, email and password. Sign in as the owner, then in **Settings** fill in the shop details, VAT and deposit, add staff, and set up the printer. Add the catalogue in **Stock**.

Another shop on the same server: run `create-shop` again. Shops never see each other's data.

## 6. Backups

- Every day at `BACKUP_TIME` (default 02:30 Nairobi time) the `backup` service writes a complete dump to `./backups` and keeps `BACKUP_KEEP_DAYS` (default 14) days.
- **Copy them off the server.** A backup on the same disk doesn't survive the server being lost. Either turn on your VPS provider's automatic snapshots, or copy `./backups` daily to cloud storage (for example with `rclone` and a cron job).
- **Test a restore every month** (and after any big change). This restores the newest backup into a throwaway database and checks it, without touching live data:

```bash
sh deploy/test-restore.sh
```

- **To restore for real** (disaster only; it takes a safety copy of the current data first and asks you to type RESTORE):

```bash
sh deploy/restore.sh backups/tailorpos-2026-11-11-0230.dump
```

## 7. Monitoring

- **Errors:** create a free project at [sentry.io](https://sentry.io) (platform: Flask), put its DSN in `.env` as `SENTRY_DSN`, then rerun step 4. Server errors and screens that crash in the browser are reported. No customer names, phone numbers, measurements, request contents or passwords are sent; only the error, the page and opaque shop/user ids.
- **Uptime:** add a free uptime check (for example UptimeRobot) on `https://pos.yourshop.co.ke/api/health`. It returns `{"status": "ok"}` when the API and database are fine, and alerts you by SMS or email when they aren't.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f --tail 100 api`

## 8. Updating

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Database changes apply automatically when the API starts. Staff get the new version on their next page load; an open tablet shows "A newer version is ready" with a Reload button if it needs it. Sales saved offline are kept through updates.

## 9. Printers

In **Settings → Printer**, choose *Printer in the shop*, create an agent key, and run the command it shows on a Windows or Linux PC in the shop that can reach the receipt printer (needs Python 3). Make it start with the PC (Windows: Task Scheduler; Linux: a systemd service). Print a test page to check.

## 10. Data protection (Kenya)

The app stores customers' names, phone numbers and measurements, which is personal data under the Data Protection Act, 2019. Before the pilot:

- Check whether the business needs to register with the Office of the Data Protection Commissioner (ODPC) as a data controller or processor.
- Tell customers what you keep and why (a short notice at the counter or on the receipt footer).
- Give staff their own accounts (never shared), and remove leavers in **Settings → Staff** the day they leave.
- Keep backups encrypted at rest when you copy them off the server, and limit who can SSH into the server.

This is a checklist, not legal advice; confirm the specifics with a Kenyan data-protection adviser.

## Open-source licences

The app ships open-source software under permissive licences (MIT, ISC, BSD, Apache, MPL, LGPL). Their notices are served at `/third-party-licenses.txt` (linked from the sign-in page) and listed for the server in `backend/THIRD_PARTY_LICENSES.txt`. Both lists are regenerated and checked on every build. The app uses no Google Fonts or other web fonts (only each device's built-in fonts), and its icons are Lucide (ISC licence), bundled into the app rather than loaded from anyone's server.
