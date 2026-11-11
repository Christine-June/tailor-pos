import { describe, expect, it } from "vitest"

import { niceMax, percentChange, smoothPath } from "./chart"

describe("chart helpers", () => {
  it("rounds axis tops to tidy numbers", () => {
    expect(niceMax(23480)).toBe(25000)
    expect(niceMax(7)).toBe(8)
    expect(niceMax(100)).toBe(100)
    expect(niceMax(0)).toBe(1)
  })

  it("never overshoots between points, so a zero day stays on the baseline", () => {
    const d = smoothPath([
      [0, 100],
      [10, 100],
      [20, 0],
    ])
    const ys = [...d.matchAll(/[ ,](-?[\d.]+)(?= |$)/g)].map((m) => Number(m[1]))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(100)
    expect(d.startsWith("M0,100")).toBe(true)
  })

  it("compares this week with last", () => {
    expect(percentChange(115, 100)).toBe(15)
    expect(percentChange(90, 100)).toBe(-10)
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(0, 0)).toBe(0)
  })
})
