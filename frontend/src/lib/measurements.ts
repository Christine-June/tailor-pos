/**
 * Measurement rules. Values are handled as whole hundredths (bigint) so 15.5 in never turns into
 * 15.499999 and conversions between inches and centimetres round the same way every time.
 */
import type { Measurement } from "./types"

export type Unit = "in" | "cm"

export interface FieldDef {
  group: string
  key: string
  label: string
}

export const OTHER_GROUP = "Other"
const MAX = 100000n // 1000.00, the server's limit
const KEY_RE = /^[a-z0-9_]{1,40}$/

/** Hundredths from "15.5" (up to 2 decimals, above 0 and below 1000), or null. */
export function parseMeasure(text: string | null | undefined): bigint | null {
  const value = (text ?? "").trim().replace(",", ".")
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(value) || value === ".") return null
  const [whole = "0", frac = ""] = value.split(".")
  const parsed = BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2))
  return parsed > 0n && parsed < MAX ? parsed : null
}

/** "15.5" from 1550n; "16" from 1600n. */
export function formatMeasure(hundredths: bigint): string {
  const negative = hundredths < 0n
  const abs = negative ? -hundredths : hundredths
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`.replace(/\.?0+$/, "")
  return (negative ? "-" : "") + text
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n
  const abs = numerator * sign
  return sign * ((abs * 2n + denominator) / (denominator * 2n))
}

/** Converts hundredths between units (1 in = 2.54 cm), rounding half away from zero. */
export function convert(hundredths: bigint, from: Unit, to: Unit): bigint {
  if (from === to) return hundredths
  return from === "in" ? roundDiv(hundredths * 254n, 100n) : roundDiv(hundredths * 100n, 254n)
}

/** A safe key for a custom measurement: "Cuff (left)" -> "cuff_left". */
export function slugify(label: string): string | null {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return KEY_RE.test(key) ? key : null
}

export function humanize(key: string): string {
  const text = key.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function labelFor(key: string, fields: FieldDef[]): string {
  return fields.find((f) => f.key === key)?.label ?? humanize(key)
}

/** Keys in a stable order: the standard catalogue first, then custom ones alphabetically. */
export function orderKeys(keys: Iterable<string>, fields: FieldDef[]): string[] {
  const set = new Set(keys)
  const standard = fields.map((f) => f.key).filter((k) => set.has(k))
  const custom = [...set].filter((k) => !fields.some((f) => f.key === k)).sort()
  return [...standard, ...custom]
}

export function groupOf(key: string, fields: FieldDef[]): string {
  return fields.find((f) => f.key === key)?.group ?? OTHER_GROUP
}

/** Values grouped for display, in catalogue order, skipping empty groups. */
export function groupValues(values: Record<string, string>, fields: FieldDef[]): { group: string; rows: { key: string; label: string; value: string }[] }[] {
  const groups = new Map<string, { key: string; label: string; value: string }[]>()
  for (const key of orderKeys(Object.keys(values), fields)) {
    const group = groupOf(key, fields)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push({ key, label: labelFor(key, fields), value: formatMeasure(parseMeasure(values[key]) ?? 0n) || values[key]! })
  }
  return [...groups.entries()].map(([group, rows]) => ({ group, rows }))
}

export interface FittingDraft {
  /** Standard and custom keys -> what was typed. */
  values: Record<string, string>
}

/** Checks a fitting form. Blank boxes are skipped; at least one value is required. */
export function validateFitting(entries: Record<string, string>): { values: Record<string, string>; errors: Record<string, string>; empty: boolean } {
  const values: Record<string, string> = {}
  const errors: Record<string, string> = {}
  for (const [key, raw] of Object.entries(entries)) {
    if (!raw.trim()) continue
    if (!KEY_RE.test(key)) {
      errors[key] = "Use letters, numbers and spaces in the name."
      continue
    }
    const parsed = parseMeasure(raw)
    if (parsed === null) errors[key] = "Enter a number above 0 and below 1000, up to 2 decimals."
    else values[key] = formatMeasure(parsed)
  }
  return { values, errors, empty: Object.keys(values).length === 0 && Object.keys(errors).length === 0 }
}

export type ChangeKind = "same" | "changed" | "added" | "removed"

export interface ComparisonRow {
  key: string
  label: string
  group: string
  /** Older value as recorded, in the older fitting's unit. */
  before: string | null
  after: string | null
  /** Newer minus older, in the newer fitting's unit, e.g. "+0.5" or "-1.25". */
  delta: string | null
  kind: ChangeKind
}

/**
 * Lines up two fittings. If they were taken in different units, the older values are converted
 * to the newer unit before working out the change, so 2.54 cm vs 1 in is "same", not "changed".
 */
export function compareFittings(older: Pick<Measurement, "unit" | "values">, newer: Pick<Measurement, "unit" | "values">, fields: FieldDef[]): ComparisonRow[] {
  const keys = orderKeys([...Object.keys(older.values), ...Object.keys(newer.values)], fields)
  return keys.map((key) => {
    const a = parseMeasure(older.values[key])
    const b = parseMeasure(newer.values[key])
    const base = { key, label: labelFor(key, fields), group: groupOf(key, fields), before: a === null ? null : formatMeasure(a), after: b === null ? null : formatMeasure(b) }
    if (a === null && b === null) return { ...base, delta: null, kind: "same" as const }
    if (a === null) return { ...base, delta: null, kind: "added" as const }
    if (b === null) return { ...base, delta: null, kind: "removed" as const }
    const diff = b - convert(a, older.unit, newer.unit)
    if (diff === 0n) return { ...base, delta: null, kind: "same" as const }
    return { ...base, delta: (diff > 0n ? "+" : "") + formatMeasure(diff), kind: "changed" as const }
  })
}
