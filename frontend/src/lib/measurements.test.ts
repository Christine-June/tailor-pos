import { describe, expect, it } from "vitest"

import { compareFittings, convert, formatMeasure, groupValues, labelFor, parseMeasure, slugify, validateFitting, type FieldDef } from "./measurements"

const fields: FieldDef[] = [
  { group: "Upper body", key: "neck", label: "Neck" },
  { group: "Upper body", key: "chest", label: "Chest" },
  { group: "Lower body", key: "waist", label: "Waist" },
]

describe("measurement values", () => {
  it("parses up to 2 decimals between 0 and 1000", () => {
    expect(parseMeasure("15.5")).toBe(1550n)
    expect(parseMeasure("15,25")).toBe(1525n)
    expect(parseMeasure("999.99")).toBe(99999n)
    for (const bad of ["0", "1000", "1.234", "-2", "abc", ""]) expect(parseMeasure(bad)).toBeNull()
  })

  it("formats without trailing zeros", () => {
    expect(formatMeasure(1550n)).toBe("15.5")
    expect(formatMeasure(1600n)).toBe("16")
    expect(formatMeasure(-25n)).toBe("-0.25")
  })

  it("converts between inches and centimetres", () => {
    expect(convert(100n, "in", "cm")).toBe(254n)
    expect(convert(4000n, "in", "cm")).toBe(10160n)
    expect(convert(10160n, "cm", "in")).toBe(4000n)
    expect(convert(100n, "cm", "in")).toBe(39n) // 0.3937 -> 0.39
  })

  it("makes safe keys for custom measurements", () => {
    expect(slugify("Cuff (left)")).toBe("cuff_left")
    expect(slugify("  Agbada sleeve width ")).toBe("agbada_sleeve_width")
    expect(slugify("!!!")).toBeNull()
    expect(labelFor("cuff_left", fields)).toBe("Cuff left")
    expect(labelFor("neck", fields)).toBe("Neck")
  })
})

describe("fitting form", () => {
  it("skips blanks, normalises numbers and flags bad ones", () => {
    const result = validateFitting({ neck: "15.50", chest: "", waist: "abc", cuff_left: "9" })
    expect(result.values).toEqual({ neck: "15.5", cuff_left: "9" })
    expect(Object.keys(result.errors)).toEqual(["waist"])
    expect(result.empty).toBe(false)
  })

  it("knows when nothing was entered", () => {
    expect(validateFitting({ neck: "", chest: " " }).empty).toBe(true)
  })

  it("groups values in catalogue order with custom ones last", () => {
    const groups = groupValues({ waist: "34.00", cuff_left: "9.00", neck: "15.50" }, fields)
    expect(groups.map((g) => g.group)).toEqual(["Upper body", "Lower body", "Other"])
    expect(groups[0]!.rows).toEqual([{ key: "neck", label: "Neck", value: "15.5" }])
  })
})

describe("comparing fittings", () => {
  it("highlights changes, additions and removals", () => {
    const rows = compareFittings(
      { unit: "in", values: { neck: "15.50", chest: "40.00", waist: "34.00" } },
      { unit: "in", values: { neck: "15.50", chest: "41.25", hips: "39.00" } },
      fields,
    )
    expect(rows.map((r) => [r.key, r.kind, r.delta])).toEqual([
      ["neck", "same", null],
      ["chest", "changed", "+1.25"],
      ["waist", "removed", null],
      ["hips", "added", null],
    ])
  })

  it("compares across units without false changes", () => {
    const rows = compareFittings({ unit: "in", values: { chest: "40" } }, { unit: "cm", values: { chest: "101.6", waist: "86" } }, fields)
    expect(rows[0]).toMatchObject({ key: "chest", kind: "same", before: "40", after: "101.6" })
    const smaller = compareFittings({ unit: "cm", values: { waist: "90" } }, { unit: "in", values: { waist: "34" } }, fields)
    expect(smaller[0]).toMatchObject({ kind: "changed", delta: "-1.43" }) // 90 cm = 35.43 in
  })
})
