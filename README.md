# Tailor POS

A cloud point of sale and workshop manager for custom tailors and apparel designers: retail checkout, deposits and balances, customer measurement history, and job cards moving through the workshop.

Progress is tracked in [CHECKLIST.md](CHECKLIST.md).

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui (Phase 2) |
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
├── frontend/                (Phase 2)
├── docker-compose.test.yml
└── CHECKLIST.md
```

## Run the tests

Requires Docker Desktop.

```bash
docker compose -f docker-compose.test.yml run --rm --build tests
```

## Key design decisions

- **Money is never a float.** Prices are `NUMERIC` in the database, `Decimal` in Python, and strings in JSON.
- **Payments are a ledger.** Each tender (cash, M-Pesa, card) is its own row; the amount paid is always summed from it. Refunds are negative rows. Rows can't be edited or deleted, which the database enforces.
- **Measurements are append-only.** A new fitting is a new record, so an order always points at the exact numbers it was cut from.
- **Production stage and payment are separate.** An order can be at Stitching and part-paid at the same time. It can't be handed over with a balance unless the owner allows credit.
- **Offline-safe.** The client generates IDs, so a sale retried after a dropped connection is recorded once.
- **Cloud printing uses an agent.** A cloud server can't reach a printer on a shop's Wi-Fi, so `print_agent/agent.py` runs on a shop PC and collects jobs.
