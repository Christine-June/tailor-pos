import { describe, expect, it } from "vitest"

import { buildOrderPayload, cartTotals, settle, type Cart } from "./checkout"
import { customerEntry, localCustomer, localOrderPreview, offlineRef, orderEntry, paymentEntry } from "./offline"

const shop = { vat_registered: false, vat_rate: "16.00", min_deposit_pct: "30.00" }
const now = new Date("2026-11-10T10:00:00Z")

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    saleId: "3f6ae4c2-b2a7-45f3-97bf-3fd3e074c854",
    kind: "retail",
    lines: [
      { key: "1", itemId: "tie", description: "Silk tie", unit: "pcs", quantity: "2", unitPrice: "1500.00", listPrice: "1500.00", trackStock: true, available: "20", notes: "" },
    ],
    customer: null,
    measurementId: null,
    discount: "",
    dueDate: "",
    notes: "",
    ...overrides,
  }
}

describe("offline sales", () => {
  it("queues the sale with its own id and the offline flag", () => {
    const c = cart()
    const totals = cartTotals(c, shop)
    const s = settle([{ key: "t", method: "cash", amount: "5000", reference: "" }], totals.total)
    const entry = orderEntry(buildOrderPayload(c, s), c, totals, "shop-1", "Demo Cashier", now)
    expect(entry).toMatchObject({ id: c.saleId, kind: "order", path: "/orders", label: "Sale · KES 3,000.00 · Walk-in", createdAt: now.toISOString() })
    expect(entry.body).toMatchObject({ id: c.saleId, offline: true, payments: [{ method: "cash", amount: "3000.00", tendered: "5000.00" }] })
    expect(entry.dependsOn).toBeUndefined()
  })

  it("makes a sale for a customer added offline wait for that customer", () => {
    const customer = localCustomer("cust-1", "Akinyi", "Otieno", "+254711000111", now)
    const c = cart({ customer })
    const totals = cartTotals(c, shop)
    const entry = orderEntry(buildOrderPayload(c, settle([], totals.total)), c, totals, "shop-1", "x", now)
    expect(entry.dependsOn).toBe("cust-1")
    expect(customerEntry(customer, "shop-1", "x", now)).toMatchObject({
      id: "cust-1",
      path: "/customers",
      body: { id: "cust-1", first_name: "Akinyi", allow_duplicate_phone: true },
    })
  })

  it("builds a receipt preview that adds up", () => {
    const c = cart()
    const totals = cartTotals(c, shop)
    const s = settle([{ key: "t", method: "cash", amount: "5000", reference: "" }], totals.total)
    const order = localOrderPreview(c, s, totals, shop, "Demo Cashier", now)
    expect(order).toMatchObject({ number: 0, total: "3000.00", amount_paid: "3000.00", balance: "0.00", status: "completed", created_offline: true })
    expect(order.items[0]).toMatchObject({ quantity: "2", unit_price: "1500.00", line_total: "3000.00" })
    expect(order.payments[0]).toMatchObject({ amount: "3000.00", tendered: "5000.00", change: "2000.00" })
    expect(offlineRef(order.id)).toBe("3F6AE4C2")
  })

  it("shows the balance due on an offline deposit", () => {
    const c = cart({ kind: "bespoke", dueDate: "2026-12-01" })
    const totals = cartTotals(c, shop)
    const order = localOrderPreview(c, settle([{ key: "t", method: "cash", amount: "1000", reference: "" }], totals.total), totals, shop, "x", now)
    expect(order).toMatchObject({ status: "confirmed", balance: "2000.00", payment_status: "partial", due_date: "2026-12-01" })
  })

  it("queues a payment behind its order", () => {
    const entry = paymentEntry("order-1", 7, { id: "pay-1", method: "mpesa", amount: "500.00", reference: "SGK7QX2M9L" }, "shop-1", "x", now)
    expect(entry).toMatchObject({ id: "pay-1", path: "/orders/order-1/payments", orderId: "order-1", dependsOn: "order-1", label: "Payment · KES 500.00 on order #7" })
  })
})
