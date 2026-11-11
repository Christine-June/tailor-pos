# Tailor POS

A cloud point of sale and workshop manager for custom tailors and apparel designers: retail checkout, deposits and balances, customer measurement history, and job cards moving through the workshop.

Progress is tracked in [CHECKLIST.md](CHECKLIST.md).

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, shadcn/ui, React Router |
| State and offline | Redux Toolkit, persisted outbox, PWA (Phase 6) |
| Backend | Python 3.12, Flask, Flask-SQLAlchemy, Flask-Migrate, Pydantic |
| Auth | JWT (Flask-JWT-Extended), roles: owner, cashier, tailor |
| Database | PostgreSQL 16 |
| Printing | ESC/POS over TCP 9100 or a local print agent |
| Runtime | Docker, Gunicorn, Nginx |

## Folder layout

```
tailor-pos/
├── backend/
│   ├── app/
│   │   ├── __init__.py      app factory
│   │   ├── config.py        environment settings
│   │   ├── models/          shop, customer, inventory, order, printing
│   │   ├── routes/          REST endpoints (blueprints)
│   │   ├── services/        business rules (orders, stock)
│   │   ├── schemas.py       request validation
│   │   └── utils/           auth helpers, ESC/POS rendering
│   ├── migrations/          database migrations
│   ├── print_agent/         runs on a shop PC, forwards jobs to the printer
│   ├── tests/               pytest suite (real PostgreSQL)
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── components/      layout, route guards, receipt, ui/ (shadcn)
│   │   ├── lib/             api client, money and checkout rules, types
│   │   ├── pages/           login, sell/, customers/, orders/, workshop/, stock/, reports/, settings/
│   │   ├── store/           Redux Toolkit (session, cart, outbox, offline caches, sync)
│   │   └── App.tsx          routes
│   └── vite.config.ts
├── docker-compose.yml       local development stack
├── docker-compose.test.yml
└── CHECKLIST.md
```

## Run the app

Requires Docker Desktop. One command starts PostgreSQL, the API (with demo data) and the frontend:

```bash
docker compose up --build
```

Open http://localhost:5173 and sign in with a demo account (password `demo-password`):

| Email | Role | Sees |
|---|---|---|
| owner@demo.test | Owner | Everything, including Settings |
| cashier@demo.test | Cashier | Sell, orders, customers, workshop, stock, reports |
| tailor@demo.test | Tailor | Customers and workshop only |

Stop with `Ctrl+C`, or `docker compose down`. Add `-v` to also wipe the database.

### Try the installable, offline-ready build

The dev server above skips the service worker so code changes show instantly. To try the real thing (install it, then use it with the API stopped):

```bash
docker compose --profile preview up preview
```

Open http://localhost:4173, sign in, and visit Sell and Workshop once so the device saves its copies. Then stop the API with `docker compose stop api`: sales and payments are saved on the device, and they sync by themselves after `docker compose start api`. The **Sync** page (from the header badge) shows what is waiting and anything that needs attention.

## Run the tests

```bash
docker compose -f docker-compose.test.yml run --rm --build tests
```

```bash
docker compose run --rm --no-deps web sh -c "npm ci && npm test"
```

## Key design decisions

- **Money is never a float.** Prices are `NUMERIC` in the database, `Decimal` in Python, strings in JSON, and whole cents (`bigint`) in the browser, rounded exactly as the server rounds.
- **Payments are a ledger.** Each tender (cash, M-Pesa, card) is its own row; the amount paid is always summed from it. Refunds are negative rows. Rows can't be edited or deleted, which the database enforces.
- **Measurements are append-only.** A new fitting is a new record, so an order always points at the exact numbers it was cut from.
- **Production stage and payment are separate.** An order can be at Stitching and part-paid at the same time. It can't be handed over with a balance unless the owner allows credit.
- **Offline-safe.** The client generates IDs, so a sale retried after a dropped connection is recorded once. Sales made with no internet wait in an outbox in IndexedDB and sync oldest first; anything the server refuses goes to a "needs attention" list instead of being lost.
- **Cloud printing uses an agent.** A cloud server can't reach a printer on a shop's Wi-Fi, so `print_agent/agent.py` runs on a shop PC and collects jobs.
