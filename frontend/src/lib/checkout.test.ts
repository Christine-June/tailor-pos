import { describe, expect, it } from "vitest"

import { buildOrderPayload, cartProblems, cartTotals, chargeBlocker, settle, type Cart, type CartLine, type Tender } from "./checkout"
import type { Customer } from "./types"

const shop = { vat_registered: false, vat_rate: "16.00", min_deposit_pct: "30.00" }
const customer = { id: "c1", full_name: "Wanjiru Kamau" } as Customer

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key: Math.random().toString(),
    itemId: "suiting",
    description: "Italian wool suiting",
    unit: "m",
    quantity: "3.5",
    unitPrice: "3500.00",
    listPrice: "3500.00",
    trackStock: true,
    available: "42.5",
    notes: "",
    ...overrides,
  }
}

function cart(overrides: Partial<Cart> = {}): Cart {
  return { saleId: "sale-1", kind: "retail", lines: [line()], customer: null, measurementId: null, discount: "", dueDate: "", notes: "", ...overrides }
}

let n = 0
const tender = (method: Tender["method"], amount: string, reference = ""): Tender => ({ key: String(n++), method, amount, reference })

describe("cart totals", () => {
  it("adds fractional metres and services", () => {
    const totals = cartTotals(cart({ lines: [line(), line({ itemId: null, description: "Suit labour", quantity: "1", unitPrice: "15000", listPrice: null, trackStock: false })] }), shop)
    expect(totals.subtotal).toBe(2725000n)
    expect(totals.total).toBe(2725000n)
  })

  it("applies the discount and VAT", () => {
    const totals = cartTotals(cart({ discount: "250" }), { ...shop, vat_registered: true })
    expect(totals.total).toBe(1200000n)
    expect(totals.vat).toBe(165517n)
  })

  it("asks a bespoke order for the minimum deposit, a sale for the full amount", () => {
    expect(cartTotals(cart({ kind: "bespoke" }), shop).deposit).toBe(367500n)
    expect(cartTotals(cart(), shop).deposit).toBe(1225000n)
  })
})

describe("cart problems", () => {
  it("is happy with a normal sale", () => {
    expect(cartProblems(cart(), "cashier")).toEqual([])
  })

  it("stops a cashier selling below list price or discounting", () => {
    const problems = cartProblems(cart({ lines: [line({ unitPrice: "3000" })], discount: "100" }), "cashier")
    expect(problems.map((p) => p.message)).toEqual([
      "Only the owner can sell Italian wool suiting below KES 3,500.00.",
      "Only the owner can give a discount.",
    ])
    expect(cartProblems(cart({ lines: [line({ unitPrice: "3000" })], discount: "100" }), "owner")).toEqual([])
  })

  it("adds up the same fabric across lines before checking stock", () => {
    const problems = cartProblems(cart({ lines: [line({ quantity: "3", available: "6.25" }), line({ quantity: "3.5", available: "6.25" })] }), "cashier")
    expect(problems).toHaveLength(1)
    expect(problems[0]!.message).toBe("Only 6.25 m of Italian wool suiting in stock.")
  })

  it("requires a customer for a bespoke order and catches bad input", () => {
    const messages = cartProblems(cart({ kind: "bespoke", lines: [line({ quantity: "abc" })], discount: "99999" }), "owner").map((p) => p.message)
    expect(messages).toContain("Enter a quantity for Italian wool suiting.")
    expect(messages).toContain("The discount is more than the sale.")
    expect(messages).toContain("Choose the customer for this order.")
  })

  it("rejects an empty cart", () => {
    expect(cartProblems(cart({ lines: [] }), "owner")[0]!.message).toBe("Add at least one item.")
  })
})

describe("settling payment", () => {
  it("gives change on cash", () => {
    const s = settle([tender("cash", "15000")], 1225000n)
    expect(s.errors).toEqual([])
    expect(s.payments).toEqual([{ method: "cash", amount: 1225000n, tendered: 1500000n, reference: null }])
    expect(s.change).toBe(275000n)
    expect(s.remaining).toBe(0n)
  })

  it("splits M-Pesa and cash, applying cash last", () => {
    const s = settle([tender("cash", "5000"), tender("mpesa", "10000", "sgk7qx2m9l")], 1225000n)
    expect(s.errors).toEqual([])
    expect(s.payments).toEqual([
      { method: "mpesa", amount: 1000000n, tendered: null, reference: "SGK7QX2M9L" },
      { method: "cash", amount: 225000n, tendered: 500000n, reference: null },
    ])
    expect(s.change).toBe(275000n)
  })

  it("checks the M-Pesa code and overpayment by M-Pesa or card", () => {
    expect(settle([tender("mpesa", "100", "123")], 10000n).errors[0]).toMatch(/M-Pesa confirmation code/)
    expect(settle([tender("card", "200")], 10000n).errors[0]).toMatch(/more than KES 100.00/)
  })

  it("rejects cash that isn't needed and ignores blank rows", () => {
    expect(settle([tender("card", "100"), tender("cash", "50")], 10000n).errors).toEqual(["The total is already covered. Remove the cash amount."])
    const s = settle([tender("cash", ""), tender("mpesa", "100", "SGK7QX2M9L")], 10000n)
    expect(s.errors).toEqual([])
    expect(s.paid).toBe(10000n)
    expect(settle([tender("cash", "0")], 10000n).errors[0]).toMatch(/enter an amount/)
  })

  it("leaves a balance on a part payment", () => {
    const s = settle([tender("cash", "4000")], 1225000n)
    expect(s.paid).toBe(400000n)
    expect(s.remaining).toBe(825000n)
    expect(s.change).toBe(0n)
  })
})

describe("charging", () => {
  const totals = cartTotals(cart({ kind: "bespoke" }), shop)

  it("needs a sale paid in full", () => {
    expect(chargeBlocker("retail", cartTotals(cart(), shop), settle([tender("cash", "100")], 1225000n), "owner")).toMatch(/still to pay/)
  })

  it("needs the deposit on an order, unless the owner waives it", () => {
    const low = settle([tender("cash", "1000")], totals.total)
    expect(chargeBlocker("bespoke", totals, low, "cashier")).toBe("The deposit is at least KES 3,675.00.")
    expect(chargeBlocker("bespoke", totals, low, "owner")).toBeNull()
    expect(chargeBlocker("bespoke", totals, settle([tender("cash", "3675")], totals.total), "cashier")).toBeNull()
  })

  it("builds the API payload with exact strings", () => {
    const c = cart({ kind: "bespoke", customer, measurementId: "m1", dueDate: "2026-12-01", notes: " Slim fit " })
    const payload = buildOrderPayload(c, settle([tender("mpesa", "5000", "SGK7QX2M9L")], totals.total))
    expect(payload).toEqual({
      id: "sale-1",
      kind: "bespoke",
      customer_id: "c1",
      measurement_id: "m1",
      items: [{ inventory_item_id: "suiting", description: "Italian wool suiting", quantity: "3.5", unit_price: "3500.00", notes: null }],
      discount: "0.00",
      due_date: "2026-12-01",
      notes: "Slim fit",
      payments: [{ method: "mpesa", amount: "5000.00", tendered: null, reference: "SGK7QX2M9L", allow_duplicate_reference: false }],
      confirm: true,
    })
  })
})
