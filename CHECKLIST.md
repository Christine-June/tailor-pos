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

## Phase 2: Frontend shell
- [ ] Vite + React + TypeScript + Tailwind + shadcn/ui project
- [ ] Login page, session refresh, role-based navigation
- [ ] App layout (sidebar on desktop, bottom bar on tablet)
- [ ] API client with error handling

## Phase 3: Checkout (POS)
- [ ] Item grid with search and categories
- [ ] Cart: quantities in metres, custom lines, discount (owner only)
- [ ] Customer picker and quick-add
- [ ] Split tender dialog (cash with change, M-Pesa code, card)
- [ ] Receipt: browser print plus thermal print

## Phase 4: Customers and measurements
- [ ] Customer list and profile
- [ ] New fitting form (standard and custom fields, in/cm)
- [ ] Side-by-side comparison of two fittings with changes highlighted
- [ ] Which jobs each fitting is locked to

## Phase 5: Orders and workshop
- [ ] Orders list (filters: status, unpaid balance, search)
- [ ] Order detail: take balance, timeline, cancel/refund, print job card
- [ ] Kanban board with drag and drop (mouse and touch)
- [ ] Conflict handling when two people move the same card

## Phase 6: Offline mode
- [ ] Redux Toolkit store with persistence (IndexedDB)
- [ ] Outbox queue: sales and payments made offline sync later
- [ ] Offline banner and "needs attention" list for failed syncs
- [ ] Installable app (PWA) that opens without internet

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
