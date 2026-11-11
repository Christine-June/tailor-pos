import { describe, expect, it } from "vitest"

import type { Shop } from "@/lib/types"
import { shopPatch } from "./ShopSettings"

const shop = {
  name: "Demo Tailoring Studio",
  address: "Kimathi Street",
  phone: null,
  email: null,
  kra_pin: null,
  receipt_footer: null,
  timezone: "Africa/Nairobi",
  vat_registered: false,
  vat_rate: "16.00",
  min_deposit_pct: "30.00",
  measurement_unit: "in",
} as unknown as Shop

const form = {
  name: "Demo Tailoring Studio",
  address: "Kimathi Street",
  phone: "",
  email: "",
  kra_pin: "",
  receipt_footer: "",
  timezone: "Africa/Nairobi",
  vat_registered: false,
  vat_rate: "16",
  min_deposit_pct: "30",
  measurement_unit: "in" as const,
}

describe("shop settings", () => {
  it("sends only what changed, clearing blanked fields", () => {
    expect(shopPatch(shop, { ...form, min_deposit_pct: "50", address: " ", vat_registered: true })).toEqual({
      body: { min_deposit_pct: "50", address: null, vat_registered: true },
    })
    expect(shopPatch(shop, form)).toEqual({ body: {} })
  })

  it("rejects impossible percentages and a blank name", () => {
    expect(shopPatch(shop, { ...form, min_deposit_pct: "120" })).toHaveProperty("error")
    expect(shopPatch(shop, { ...form, vat_rate: "abc" })).toHaveProperty("error")
    expect(shopPatch(shop, { ...form, name: "  " })).toEqual({ error: "The shop needs a name." })
  })
})
