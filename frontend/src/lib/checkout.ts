/**
 * Checkout rules, kept pure so they can be tested without a browser. They mirror the server
 * (services/orders.py), so staff see a problem before pressing Charge rather than after.
 */
import { formatQuantity, includedVat, lineTotal, parseMoney, parseQuantity, percentOf, toApiMoney, formatMoney } from "./money"
import type { Customer, Role, Shop } from "./types"

export type SaleKind = "retail" | "bespoke"
export type TenderMethod = "cash" | "mpesa" | "card"

export interface CartLine {
  key: string
  itemId: string | null
  description: string
  unit: string | null
  /** As typed, e.g. "2.5". */
  quantity: string
  unitPrice: string
  /** The catalogue price when the line was added; null for a custom line. */
  listPrice: string | null
  trackStock: boolean
  /** Stock on hand when the line was added, for an early warning. The server has the final say. */
  available: string | null
  notes: string
}

export interface Cart {
  /** Client-generated order id: retrying a sale after a dropped connection never records it twice. */
  saleId: string
  kind: SaleKind
  lines: CartLine[]
  customer: Customer | null
  measurementId: string | null
  discount: string
  dueDate: string
  notes: string
}

export interface Tender {
  key: string
  method: TenderMethod
  /** For cash this is the cash handed over; any excess becomes change. */
  amount: string
  reference: string
}

export const MPESA_RE = /^[A-Z0-9]{8,12}$/

export interface Totals {
  subtotal: bigint
  discount: bigint
  total: bigint
  vat: bigint
  deposit: bigint
}

export function lineAmount(line: CartLine): bigint {
  const qty = parseQuantity(line.quantity)
  const price = parseMoney(line.unitPrice)
  return qty === null || price === null ? 0n : lineTotal(qty, price)
}

export function cartTotals(cart: Cart, shop: Pick<Shop, "vat_registered" | "vat_rate" | "min_deposit_pct">): Totals {
  const subtotal = cart.lines.reduce((sum, line) => sum + lineAmount(line), 0n)
  const discount = parseMoney(cart.discount) ?? 0n
  const total = subtotal - discount > 0n ? subtotal - discount : 0n
  const vat = shop.vat_registered ? includedVat(total, shop.vat_rate) : 0n
  const deposit = cart.kind === "bespoke" ? percentOf(total, shop.min_deposit_pct) : total
  return { subtotal, discount, total, vat, deposit }
}

export interface Problem {
  lineKey?: string
  message: string
}

export function cartProblems(cart: Cart, role: Role): Problem[] {
  const problems: Problem[] = []
  if (cart.lines.length === 0) problems.push({ message: "Add at least one item." })

  const wanted = new Map<string, { qty: bigint; line: CartLine }>()
  for (const line of cart.lines) {
    const qty = parseQuantity(line.quantity)
    const price = parseMoney(line.unitPrice)
    if (!line.description.trim()) problems.push({ lineKey: line.key, message: "Give this line a description." })
    if (qty === null) problems.push({ lineKey: line.key, message: `Enter a quantity for ${line.description || "this line"}.` })
    if (price === null) problems.push({ lineKey: line.key, message: `Enter a price for ${line.description || "this line"}.` })
    const list = parseMoney(line.listPrice)
    if (price !== null && list !== null && price < list && role !== "owner") {
      problems.push({ lineKey: line.key, message: `Only the owner can sell ${line.description} below ${formatMoney(list)}.` })
    }
    if (line.itemId && line.trackStock && qty !== null) {
      const entry = wanted.get(line.itemId)
      wanted.set(line.itemId, { qty: (entry?.qty ?? 0n) + qty, line: entry?.line ?? line })
    }
  }
  for (const { qty, line } of wanted.values()) {
    const available = parseQuantity(line.available) ?? 0n
    if (qty > available) {
      const unit = line.unit ? ` ${line.unit}` : ""
      problems.push({
        lineKey: line.key,
        message: `Only ${available > 0n ? formatQuantity(available) : 0}${unit} of ${line.description} in stock.`,
      })
    }
  }

  const discountText = cart.discount.trim()
  if (discountText) {
    const discount = parseMoney(discountText)
    if (discount === null) problems.push({ message: "Enter the discount as an amount, e.g. 500." })
    else if (discount > 0n && role !== "owner") problems.push({ message: "Only the owner can give a discount." })
    else {
      const subtotal = cart.lines.reduce((sum, line) => sum + lineAmount(line), 0n)
      if (discount > subtotal) problems.push({ message: "The discount is more than the sale." })
    }
  }
  if (cart.kind === "bespoke" && !cart.customer) problems.push({ message: "Choose the customer for this order." })
  return problems
}

export interface SettledPayment {
  method: TenderMethod
  amount: bigint
  tendered: bigint | null
  reference: string | null
}

export interface Settlement {
  payments: SettledPayment[]
  paid: bigint
  change: bigint
  remaining: bigint
  errors: string[]
}

/**
 * Applies the tenders to a total: M-Pesa and card first at face value, then cash up to what is
 * still owed. Cash above that is change. Nothing here can make the payments exceed the total.
 */
export function settle(tenders: Tender[], total: bigint): Settlement {
  const errors: string[] = []
  const payments: SettledPayment[] = []
  let nonCash = 0n
  let cashGiven = 0n

  for (const tender of tenders) {
    const text = tender.amount.trim()
    const amount = parseMoney(text)
    const label = tender.method === "mpesa" ? "M-Pesa" : tender.method === "card" ? "Card" : "Cash"
    // A row left blank simply isn't used (e.g. the default cash row when the customer paid by M-Pesa).
    if (!text) continue
    if (amount === null || amount === 0n) {
      errors.push(`${label}: enter an amount like 1500 or 1500.50.`)
      continue
    }
    if (tender.method === "cash") {
      cashGiven += amount
      continue
    }
    const reference = tender.reference.trim().toUpperCase()
    if (tender.method === "mpesa" && !MPESA_RE.test(reference)) {
      errors.push("Enter the M-Pesa confirmation code from the SMS, e.g. SGK7QX2M9L.")
    }
    nonCash += amount
    payments.push({ method: tender.method, amount, tendered: null, reference: reference || null })
  }

  if (nonCash > total) {
    errors.push(`M-Pesa and card add up to more than ${formatMoney(total)}.`)
  }
  const owedAfterNonCash = total - nonCash > 0n ? total - nonCash : 0n
  const cashApplied = cashGiven < owedAfterNonCash ? cashGiven : owedAfterNonCash
  if (cashGiven > 0n && cashApplied === 0n && nonCash <= total) {
    errors.push("The total is already covered. Remove the cash amount.")
  }
  if (cashApplied > 0n) {
    payments.push({ method: "cash", amount: cashApplied, tendered: cashGiven, reference: null })
  }
  const paid = nonCash + cashApplied
  return {
    payments,
    paid,
    change: cashGiven - cashApplied,
    remaining: total - paid > 0n ? total - paid : 0n,
    errors,
  }
}

/** Can this sale be charged with this settlement? Returns the reason it can't, or null. */
export function chargeBlocker(kind: SaleKind, totals: Totals, settlement: Settlement, role: Role): string | null {
  if (settlement.errors.length) return settlement.errors[0]!
  if (kind === "retail") {
    if (settlement.paid < totals.total) return `${formatMoney(settlement.remaining)} still to pay. A sale must be paid in full.`
    return null
  }
  if (settlement.paid < totals.deposit && role !== "owner") {
    return `The deposit is at least ${formatMoney(totals.deposit)}.`
  }
  return null
}

export interface OrderPayload {
  id: string
  kind: SaleKind
  customer_id: string | null
  measurement_id: string | null
  items: { inventory_item_id: string | null; description: string; quantity: string; unit_price: string; notes: string | null }[]
  discount: string
  due_date: string | null
  notes: string | null
  payments: { method: TenderMethod; amount: string; tendered: string | null; reference: string | null; allow_duplicate_reference: boolean }[]
  confirm: true
}

export function buildOrderPayload(cart: Cart, settlement: Settlement, allowDuplicateReference = false): OrderPayload {
  return {
    id: cart.saleId,
    kind: cart.kind,
    customer_id: cart.customer?.id ?? null,
    measurement_id: cart.kind === "bespoke" ? cart.measurementId : null,
    items: cart.lines.map((line) => ({
      inventory_item_id: line.itemId,
      description: line.description.trim(),
      quantity: formatQuantity(parseQuantity(line.quantity) ?? 0n),
      unit_price: toApiMoney(parseMoney(line.unitPrice) ?? 0n),
      notes: line.notes.trim() || null,
    })),
    discount: toApiMoney(parseMoney(cart.discount) ?? 0n),
    due_date: cart.kind === "bespoke" && cart.dueDate ? cart.dueDate : null,
    notes: cart.notes.trim() || null,
    payments: settlement.payments.map((p) => ({
      method: p.method,
      amount: toApiMoney(p.amount),
      tendered: p.tendered === null ? null : toApiMoney(p.tendered),
      reference: p.reference,
      allow_duplicate_reference: allowDuplicateReference,
    })),
    confirm: true,
  }
}
