import { describe, expect, it } from "vitest"

import { canAccess, homeFor, navFor } from "./nav"

describe("role navigation", () => {
  it("gives tailors only their dashboard, the workshop and customers", () => {
    expect(navFor("tailor").map((n) => n.label)).toEqual(["Dashboard", "Customers", "Workshop"])
  })

  it("lands everyone on their dashboard after signing in", () => {
    for (const role of ["owner", "cashier", "tailor"] as const) expect(homeFor(role)).toBe("/dashboard")
  })

  it("keeps settings for owners", () => {
    expect(canAccess("owner", "/settings")).toBe(true)
    expect(canAccess("cashier", "/settings")).toBe(false)
  })

  it("blocks tailors from money pages, including sub-paths", () => {
    for (const path of ["/sell", "/orders", "/orders/123", "/reports", "/stock"]) {
      expect(canAccess("tailor", path)).toBe(false)
    }
  })

  it("does not match a path that only shares a prefix", () => {
    expect(canAccess("tailor", "/workshopx")).toBe(false)
  })
})
