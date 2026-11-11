# Showing Tailor POS to a prospect

The demo is a sample tailoring shop with two weeks of sales, custom orders, measurements and a busy workshop, so the dashboard and reports look like a real business. Visitors sign in with one tap as **Owner**, **Cashier** or **Tailor**. Anything that could lock the next visitor out (passwords, staff accounts, printer keys) is switched off; everything else works, including selling and taking deposits.

## Share it from your laptop (fastest, free)

In the Ubuntu terminal, from `~/tailor-pos`:

```bash
sh deploy/demo-up.sh
```

The first run takes a few minutes. When it's ready it prints a link like `https://something-random.trycloudflare.com`. Send that link to the prospect. It works on their phone, tablet or PC, with HTTPS, as long as:

- the terminal window stays open, and
- your laptop stays on and online.

Press `Ctrl+C` to stop sharing. Each run gives a new link.

The demo's dates are fixed when its data is created, so **before each meeting, start fresh** so "this week" is today's week:

```bash
sh deploy/demo-up.sh --fresh
```

Stop the demo completely when you're done:

```bash
sh deploy/demo-down.sh
```

Notes:
- The demo runs on its own (port 8080) and never touches your development data.
- The quick link comes from Cloudflare's free "quick tunnel" (no account needed). It's meant for demos, not for real shops.
- Don't share your development app (port 5173/4173) instead: it runs in debug mode, which must never be on the internet.

## A permanent demo link

For a link that's always on (for your website or WhatsApp status), put the demo on a small server the same way as a real install (DEPLOY.md), using the demo file:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.demo.yml up -d --build
```

with `SITE_ADDRESS=demo.yourdomain.co.ke` in `.env`. Refresh its data weekly with `down -v` then `up -d`.

## A 10-minute walkthrough

1. **Owner → Dashboard.** This week's takings and orders against last week, the takings chart, payment methods (M-Pesa, cash, card), the workshop pipeline, top sellers.
2. **Sell.** Add a tie and 2.5 m of fabric, take a split M-Pesa + cash payment, show the change and the receipt.
3. **Custom order.** Choose a customer, their measurements fill in, take a 30% deposit, set the collection date.
4. **Workshop.** Drag a job from Cutting to Stitching. Sign in as **Tailor** to show they see measurements but never prices.
5. **Customers.** Open a customer, compare two fittings side by side.
6. **Reports → Daily cash-up.** Takings by method and the drawer check: "Short by KES 100".
7. **Offline.** Turn the Wi-Fi off, make a sale, turn it back on: it syncs by itself.
