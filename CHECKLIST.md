# Tailor POS build checklist

Tick each box (`- [x]`) as we finish and verify it. We work top to bottom: one phase at a time, tested before moving on.

## Phase 0: Setup (on your laptop)
- [ ] Unzip `tailor-pos.zip` and open the folder in VS Code
- [ ] Install Docker Desktop (needed for the database and tests)
- [ ] Install Git, create an empty GitHub repo, push the first commit
- [ ] Run the backend tests on your laptop: `docker compose -f docker-compose.test.yml run --rm --build tests`

## Phase 1: Backend foundation ✅ (in this zip)
- [x] Flask app factory, config, JSON error format, health check
- [x] PostgreSQL schema plus migrations (Flask-Migrate / Alembic)
- [x] Multi-shop (tenant) isolation: one shop never sees another's data
- [x] Staff login (JWT), roles: owner / cashier / tailor, instant deactivation
- [x] Customers: Kenyan phone normalisation, duplicate-phone warning
- [x] Measurements: append-only history, locked to orders (DB triggers)
- [x] Inventory: fractional metres, stock movement ledger, stock counts
- [x] Orders / job cards: retail and bespoke, status workflow, events
- [x] Payments ledger: split tender, M-Pesa code checks, refunds, deposits
- [x] Safe retries for offline sync (client UUIDs, no double charges)
- [x] Row locking: no overselling, no overpaying, unique order numbers
- [x] Reports: daily cash-up by method, outstanding balances, overdue, low stock
- [x] ESC/POS receipts and job cards (32/42/48 char paper)
- [x] Print agent for shop PCs (network or USB printer)
- [x] 107 automated tests against real PostgreSQL

## Phase 2: Frontend shell ✅
- [x] Vite + React + TypeScript + Tailwind + shadcn/ui project
- [x] Login page, session refresh, role-based navigation
- [x] App layout (sidebar on desktop, icon rail on tablet, menu drawer on phone)
- [x] API client with error handling (14 frontend tests)
- [x] `docker compose up` runs database + API with demo data + frontend

## Phase 3: Checkout (POS) ✅
- [x] Item grid with search and categories, stock left on each item
- [x] Cart: quantities in metres, custom lines, discount (owner only), stock warnings
- [x] Sale or custom order: customer, measurements, collection date, minimum deposit
- [x] Customer picker and quick-add (warns on a phone number already in use)
- [x] Split tender dialog (cash with change, M-Pesa code, card)
- [x] Receipt: browser print plus thermal print
- [x] Cart survives a page reload; a retried sale is never recorded twice
- [x] Money maths in whole cents, matching the server

## Phase 4: Customers and measurements ✅
- [x] Customer list with search, profile, edit and archive (tailors can view, not edit)
- [x] New fitting form (standard and custom fields, in/cm with automatic conversion)
- [x] "Start from the last fitting" so only changes need typing
- [x] Side-by-side comparison of two fittings with changes highlighted (works across in/cm)
- [x] Which jobs each fitting is locked to
- [x] Customer's orders and total balance owed (front desk only)

## Phase 5: Orders and workshop ✅
- [x] Orders list (filters: status, balance owing, sale or custom order, search), overdue flags
- [x] Order detail: take balance, history, cancel (refund or keep deposit, restock), refund, print receipt and job card
- [x] Edit order: collection date, tailor, notes, which fitting to cut from (until cutting starts)
- [x] Hand-over blocked while money is owed (owner can release on credit)
- [x] Kanban board with drag and drop (mouse and touch grip) plus a "Move to" menu
- [x] Conflict handling when two people move the same card; board refreshes every 30 s
- [x] Tailors see job cards with measurements but no prices

## Phase 6: Offline mode ✅
- [x] Redux Toolkit store with persistence (IndexedDB; moves the old localStorage session over)
- [x] Outbox queue: sales, balance payments and new customers made offline sync later, oldest first
- [x] Never recorded twice: each queued item carries its own id; retries are harmless
- [x] Catalogue, customers and workshop board saved on the device for offline use
- [x] Offline banner (also when Wi-Fi is up but the server isn't), sync status in the header
- [x] Sync page: waiting, needs attention (fix the M-Pesa code and retry, or discard), recently synced
- [x] Offline receipts with a reference until the order number arrives
- [x] Installable app (PWA) that opens without internet: manifest, icons, service worker

## Phase 7: Stock, reports, settings
- [ ] Stock page: add items, adjust, movement history
- [ ] Dashboard and daily cash-up page
- [ ] Settings: shop details, VAT, deposit %, staff, printer setup

## Phase 8: Deploy
- [ ] Production Docker Compose (Postgres, API, web, Redis)
- [ ] Domain, HTTPS, environment secrets
- [ ] Daily database backups and a tested restore
- [ ] Error monitoring (e.g. Sentry)
- [ ] Pilot in one real tailor shop

## Later (needed before selling widely in Kenya)
- [ ] KRA eTIMS invoice integration (tax compliance)
- [ ] M-Pesa STK push (Daraja API) instead of typing codes
- [ ] SMS: "your suit is ready" and balance reminders
- [ ] Self-service shop sign-up and subscription billing
