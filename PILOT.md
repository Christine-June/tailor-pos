# Pilot in one shop

Run Tailor POS alongside the shop's current way of working for two weeks, then switch over. Tick as you go.

## Before day one
- [ ] Server live on the shop's domain with HTTPS (DEPLOY.md steps 1–5)
- [ ] Backups copied off the server, and `sh deploy/test-restore.sh` passed
- [ ] Sentry and the uptime check set up, with alerts reaching your phone
- [ ] Shop details, KRA PIN, VAT, minimum deposit and receipt footer in **Settings**
- [ ] Every staff member has their own account with the right role
- [ ] The whole catalogue in **Stock**, with a real shelf count for each fabric
- [ ] Existing customers with open jobs added, with their latest measurements
- [ ] Open jobs entered as custom orders, with deposits already paid recorded as payments
- [ ] Receipt printer prints a test page; browser printing works as a fallback
- [ ] The app installed on the counter tablet/PC ("Install" in the browser menu)
- [ ] 30-minute walk-through with staff: a sale, a custom order with deposit, collecting a balance, the workshop board, the cash-up

## Every day of the pilot
- [ ] Every sale and payment goes into Tailor POS as well as the old book
- [ ] At closing: the **Daily cash-up**. Count the drawer, compare with the old book, and note any difference and why
- [ ] M-Pesa: tick the day's codes on the cash-up against the M-Pesa statement
- [ ] Check the header badge: nothing left "to sync" or "needs attention"
- [ ] Write down anything confusing, slow or missing

## Test on purpose in week one
- [ ] Turn the Wi-Fi off, make a sale, turn it back on: the sale syncs by itself
- [ ] Two people move the same job on the workshop board: the second sees the right stage
- [ ] Stop someone's access in **Settings → Staff**: they're signed out at once
- [ ] Hand over an order with a balance: it is blocked until paid (or the owner allows credit)

## End of week two: decide
- [ ] Cash-ups matched the drawer every day (or the differences are explained)
- [ ] Staff can do a sale, a deposit and a collection without help
- [ ] No lost sales, no double-recorded payments
- [ ] Feedback list reviewed and the must-fixes done
- [ ] Switch over: stop the paper book, keep it for reference
