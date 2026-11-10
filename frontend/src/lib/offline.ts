/**
 * Turning a sale, payment or new customer into an outbox entry, and the stand-in order shown
 * (and printed) for a sale that hasn't reached the server yet.
 */
import type { OutboxEntry } from "@/store/outboxSlice"
import type { Cart, OrderPayload, Settlement, Totals } from "./checkout"
import { formatQuantity, formatMoney, lineTotal, parseMoney, parseQuantity, toApiMoney } from "./money"
import type { Customer, Order, Shop } from "./types"

type NewEntry = Omit<OutboxEntry, "attempts" | "state" | "error">

/** True when the browser itself knows there's no network, so we needn't wait for a timeout. */
export function knownOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

export function orderEntry(payload: OrderPayload, cart: Cart, totals: Totals, shopId: string, createdBy: string, now = new Date()): NewEntry {
  const who = cart.customer?.full_name ?? "Walk-in"
  return {
    id: payload.id,
    kind: "order",
    shopId,
    createdBy,
    path: "/orders",
    // offline: the server keeps the sale even if stock or prices moved on, as it already happened.
    body: { ...payload, offline: true },
    label: `${cart.kind === "bespoke" ? "Custom order" : "Sale"} · ${formatMoney(totals.total)} · ${who}`,
    dependsOn: cart.customer?.id,
    createdAt: now.toISOString(),
  }
}

export function paymentEntry(
  orderId: string,
  orderNumber: number,
  body: { id: string; method: string; amount: string } & Record<string, unknown>,
  shopId: string,
  createdBy: string,
  now = new Date(),
): NewEntry {
  return {
    id: body.id,
    kind: "payment",
    shopId,
    createdBy,
    path: `/orders/${orderId}/payments`,
    body,
    label: `Payment · ${formatMoney(body.amount)} on order #${orderNumber}`,
    orderId,
    dependsOn: orderId,
    createdAt: now.toISOString(),
  }
}

export function customerEntry(customer: Customer, shopId: string, createdBy: string, now = new Date()): NewEntry {
  return {
    id: customer.id,
    kind: "customer",
    shopId,
    createdBy,
    path: "/customers",
    // A duplicate phone can't be checked offline; it's only a warning, so let it through.
    body: { id: customer.id, first_name: customer.first_name, last_name: customer.last_name, phone: customer.phone, allow_duplicate_phone: true },
    label: `New customer · ${customer.full_name}`,
    createdAt: now.toISOString(),
  }
}

/** A customer as the app will see it until the server has it. */
export function localCustomer(id: string, first: string, last: string, phone: string | null, now = new Date()): Customer {
  return {
    id,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim(),
    phone,
    email: null,
    notes: null,
    archived: false,
    created_at: now.toISOString(),
  }
}

/**
 * What the customer's receipt shows for a sale saved offline. It has no order number yet
 * (number 0); the receipt prints a short reference from the id instead.
 */
export function localOrderPreview(cart: Cart, settlement: Settlement, totals: Totals, shop: Pick<Shop, "vat_registered">, createdBy: string, now = new Date()): Order {
  const at = now.toISOString()
  const paid = settlement.paid
  const balance = totals.total - paid
  return {
    id: cart.saleId,
    number: 0,
    kind: cart.kind,
    status: cart.kind === "retail" ? "completed" : "confirmed",
    customer: cart.customer,
    measurement_id: cart.measurementId,
    measurement: null,
    assigned_to: null,
    created_by: createdBy,
    items: cart.lines.map((line, i) => {
      const qty = parseQuantity(line.quantity) ?? 0n
      const price = parseMoney(line.unitPrice) ?? 0n
      return {
        id: `${cart.saleId}-${i}`,
        inventory_item_id: line.itemId,
        description: line.description,
        unit: line.unit,
        quantity: formatQuantity(qty),
        unit_price: toApiMoney(price),
        line_total: toApiMoney(lineTotal(qty, price)),
        notes: line.notes || null,
      }
    }),
    payments: settlement.payments.map((p, i) => ({
      id: `${cart.saleId}-p${i}`,
      order_id: cart.saleId,
      kind: "payment" as const,
      method: p.method,
      amount: toApiMoney(p.amount),
      tendered: p.tendered === null ? null : toApiMoney(p.tendered),
      change: p.tendered !== null && p.tendered > p.amount ? toApiMoney(p.tendered - p.amount) : null,
      reference: p.reference,
      note: null,
      received_by: createdBy,
      created_at: at,
    })),
    subtotal: toApiMoney(totals.subtotal),
    discount: toApiMoney(totals.discount),
    total: toApiMoney(totals.total),
    tax_amount: toApiMoney(shop.vat_registered ? totals.vat : 0n),
    amount_paid: toApiMoney(paid),
    balance: toApiMoney(balance > 0n ? balance : 0n),
    payment_status: paid <= 0n ? "unpaid" : paid >= totals.total ? "paid" : "partial",
    due_date: cart.kind === "bespoke" && cart.dueDate ? cart.dueDate : null,
    notes: cart.notes || null,
    cancel_reason: null,
    created_offline: true,
    created_at: at,
    completed_at: cart.kind === "retail" ? at : null,
  }
}

/** Short reference printed on an offline receipt, e.g. "3F6AE4C2". */
export function offlineRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase()
}
