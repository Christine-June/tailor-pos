import { describe, expect, it } from "vitest"

import { buildAdjustment, buildItemBody, parseSignedQuantity, type ItemDraft } from "./stock"

describe("stock adjustments", () => {
  it("adds received stock", () => {
    expect(buildAdjustment({ reason: "purchase", amount: "12.5", sign: "add" }, "30.000")).toEqual({
      body: { reason: "purchase", delta: "12.5" },
      after: 42500n,
    })
  })

  it("removes damaged stock but never below zero", () => {
    expect(buildAdjustment({ reason: "waste", amount: "0.75", sign: "add" }, "2.000")).toMatchObject({ body: { delta: "-0.75" }, after: 1250n })
    expect(buildAdjustment({ reason: "waste", amount: "3", sign: "add" }, "2.000")).toEqual({ error: "Only 2 in stock." })
  })

  it("sends a shelf count as the counted quantity, including zero", () => {
    expect(buildAdjustment({ reason: "stock_count", amount: "38.25", sign: "add" }, "42.500")).toEqual({
      body: { reason: "stock_count", counted_quantity: "38.25" },
      after: 38250n,
    })
    expect(buildAdjustment({ reason: "stock_count", amount: "0", sign: "add" }, "4")).toMatchObject({ body: { counted_quantity: "0" }, after: 0n })
  })

  it("lets a correction go either way", () => {
    expect(buildAdjustment({ reason: "adjustment", amount: "1", sign: "remove" }, "5")).toMatchObject({ body: { delta: "-1" } })
    expect(buildAdjustment({ reason: "adjustment", amount: "x", sign: "add" }, "5")).toHaveProperty("error")
  })

  it("reads signed quantities, including stock that went negative offline", () => {
    expect(parseSignedQuantity("-1.500")).toBe(-1500n)
    expect(parseSignedQuantity("2")).toBe(2000n)
    expect(parseSignedQuantity("-")).toBeNull()
  })
})

describe("item form", () => {
  const draft: ItemDraft = {
    name: " Silk lining ",
    sku: "",
    kind: "fabric",
    category: "Fabric",
    unit: "m",
    sellPrice: "1200",
    costPrice: "",
    trackStock: true,
    openingQuantity: "25",
    reorderLevel: "5",
  }

  it("builds a new item with opening stock", () => {
    expect(buildItemBody(draft, true)).toEqual({
      body: {
        name: "Silk lining",
        sku: null,
        kind: "fabric",
        category: "Fabric",
        unit: "m",
        sell_price: "1200",
        cost_price: "0",
        track_stock: true,
        reorder_level: "5",
        opening_quantity: "25",
      },
    })
  })

  it("never tracks stock for a service and skips opening stock on edit", () => {
    const service = buildItemBody({ ...draft, kind: "service", unit: "job" }, true)
    expect(service).toMatchObject({ body: { track_stock: false } })
    expect((service as { body: Record<string, unknown> }).body).not.toHaveProperty("opening_quantity")
    expect((buildItemBody(draft, false) as { body: Record<string, unknown> }).body).not.toHaveProperty("opening_quantity")
  })

  it("explains what's wrong", () => {
    expect(buildItemBody({ ...draft, name: "" }, true)).toEqual({ error: "Give the item a name." })
    expect(buildItemBody({ ...draft, sellPrice: "12.345" }, true)).toHaveProperty("error")
  })
})
