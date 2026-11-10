import { describe, expect, it } from "vitest"

import { cents, formatMoney, formatQuantity, includedVat, lineTotal, parseMoney, parseQuantity, percentOf, toApiMoney } from "./money"

describe("money", () => {
  it("parses amounts exactly", () => {
    expect(parseMoney("3500")).toBe(350000n)
    expect(parseMoney("0.1")).toBe(10n)
    expect(parseMoney("1,250.05")).toBe(125005n)
    expect(parseMoney(" 12. ")).toBe(1200n)
  })

  it("rejects invalid amounts", () => {
    for (const bad of ["", ".", "-5", "1.234", "abc", "1e3", "12345678901"]) expect(parseMoney(bad)).toBeNull()
  })

  it("reads API strings, including refunds", () => {
    expect(cents("3500.00")).toBe(350000n)
    expect(cents("-200.50")).toBe(-20050n)
    expect(cents(null)).toBe(0n)
  })

  it("formats for people and for the API", () => {
    expect(formatMoney(123456789n)).toBe("KES 1,234,567.89")
    expect(formatMoney("950.00")).toBe("KES 950.00")
    expect(formatMoney(-500n)).toBe("-KES 5.00")
    expect(toApiMoney(5n)).toBe("0.05")
  })

  it("handles fractional metres", () => {
    expect(parseQuantity("2.375")).toBe(2375n)
    expect(parseQuantity("0")).toBeNull()
    expect(parseQuantity("1.2345")).toBeNull()
    expect(formatQuantity(2500n)).toBe("2.5")
    expect(formatQuantity(3000n)).toBe("3")
  })

  it("rounds line totals half-up like the server", () => {
    // 0.333 m x KES 10.05 = 3.34665 -> 3.35
    expect(lineTotal(333n, 1005n)).toBe(335n)
    // 3.5 m x KES 3,500 = 12,250 exactly
    expect(lineTotal(3500n, 350000n)).toBe(1225000n)
    // 0.1 + 0.2 style float traps don't exist here
    expect(lineTotal(100n, 10n) + lineTotal(200n, 10n)).toBe(3n)
  })

  it("computes the deposit and included VAT like the server", () => {
    expect(percentOf(1450000n, "30.00")).toBe(435000n)
    expect(percentOf(1001n, "33.33")).toBe(334n)
    // 11,600 including 16% VAT contains 1,600 VAT
    expect(includedVat(1160000n, "16.00")).toBe(160000n)
    expect(includedVat(100n, "16.00")).toBe(14n)
    expect(includedVat(1000n, "0")).toBe(0n)
  })
})
