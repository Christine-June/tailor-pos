import { describe, expect, it } from "vitest"

import { buildAdjustment, buildItemBody, OWNER_ONLY_LOSS, reasonsFor, type ItemDraft } from "./stock"
import { formatAmount, isWholeUnit, perUnit, unitWord, wholeNumberProblem } from "./units"

describe("unit words", () => {
  it("says pieces and metres, singular for exactly one", () => {
    expect(formatAmount("4.000", "pcs")).toBe("4 pieces")
    expect(formatAmount("1.000", "pcs")).toBe("1 piece")
    expect(formatAmount(2500n, "m")).toBe("2.5 metres")
    expect(formatAmount("1.000", "m")).toBe("1 metre")
    expect(formatAmount("0.000", "pcs")).toBe("0 pieces")
    expect(formatAmount("-2.000", "pcs")).toBe("-2 pieces")
    expect(formatAmount("7.000", "job")).toBe("7 jobs")
    expect(unitWord("set", "1")).toBe("set")
    expect(perUnit("pcs")).toBe("piece")
  })

  it("only pieces, sets, pairs, rolls and jobs must be whole", () => {
    expect(isWholeUnit("pcs")).toBe(true)
    expect(isWholeUnit("m")).toBe(false)
    expect(wholeNumberProblem(1500n, "pcs")).toMatch(/whole number/)
    expect(wholeNumberProblem(2000n, "pcs")).toBeNull()
    expect(wholeNumberProblem(1500n, "m")).toBeNull()
  })
})

describe("stock forms with whole-number units", () => {
  const draft: ItemDraft = {
    name: "Shirt", sku: "", kind: "retail", category: "", unit: "pcs", sellPrice: "3200", costPrice: "",
    trackStock: true, openingQuantity: "3", reorderLevel: "1",
  }

  it("rejects half a shirt when adding or receiving stock", () => {
    expect(buildItemBody(draft, true)).toMatchObject({ body: { unit: "pcs", opening_quantity: "3" } })
    expect(buildItemBody({ ...draft, openingQuantity: "2.5" }, true)).toEqual({ error: "Counted in pieces, so use a whole number (1, 2, 3...)." })
    expect(buildAdjustment({ reason: "purchase", amount: "0.5", sign: "add" }, "3.000", "pcs")).toHaveProperty("error")
    expect(buildAdjustment({ reason: "purchase", amount: "4", sign: "add" }, "3.000", "pcs")).toMatchObject({ after: 7000n })
    expect(buildAdjustment({ reason: "waste", amount: "5", sign: "add" }, "3.000", "pcs")).toEqual({ error: "Only 3 pieces in stock." })
  })

  it("lets a cashier receive stock but not take it off", () => {
    const cashier = (input: Parameters<typeof buildAdjustment>[0]) => buildAdjustment(input, "3.000", "pcs", false)
    expect(cashier({ reason: "purchase", amount: "2", sign: "add" })).toMatchObject({ after: 5000n })
    expect(cashier({ reason: "waste", amount: "1", sign: "add" })).toEqual({ error: OWNER_ONLY_LOSS })
    expect(cashier({ reason: "adjustment", amount: "1", sign: "remove" })).toEqual({ error: OWNER_ONLY_LOSS })
    expect(cashier({ reason: "stock_count", amount: "2", sign: "add" })).toEqual({ error: OWNER_ONLY_LOSS })
    expect(cashier({ reason: "stock_count", amount: "4", sign: "add" })).toMatchObject({ after: 4000n })
    expect(reasonsFor(false).map((r) => r.reason)).not.toContain("waste")
  })

  it("still lets cloth be cut to any length", () => {
    expect(buildAdjustment({ reason: "waste", amount: "0.25", sign: "add" }, "3.000", "m")).toMatchObject({ after: 2750n })
  })
})
