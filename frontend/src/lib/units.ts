/**
 * Units an item is sold in. The server stores a short code ("pcs", "m"); people always see words:
 * "2 pieces", "1 piece", "2.5 metres", "1 job". Pieces, sets, pairs, rolls and jobs are whole numbers.
 * Mirrors backend/app/units.py.
 */
import { formatQuantity, parseQuantity } from "./money"
import type { ItemKind } from "./types"

export interface UnitDef {
  code: string
  one: string
  many: string
  whole: boolean
}

export const UNITS: UnitDef[] = [
  { code: "pcs", one: "piece", many: "pieces", whole: true },
  { code: "m", one: "metre", many: "metres", whole: false },
  { code: "yd", one: "yard", many: "yards", whole: false },
  { code: "set", one: "set", many: "sets", whole: true },
  { code: "pair", one: "pair", many: "pairs", whole: true },
  { code: "roll", one: "roll", many: "rolls", whole: true },
  { code: "job", one: "job", many: "jobs", whole: true },
]

export const DEFAULT_UNIT: Record<ItemKind, string> ={ fabric: "m", trim: "pcs", retail: "pcs", service: "job" }

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]))

export function unitDef(code: string | null | undefined): UnitDef | null {
  return code ? (BY_CODE.get(code) ?? null) : null
}

export function isWholeUnit(code: string | null | undefined): boolean {
  return unitDef(code)?.whole ?? false
}

function toThousandths(quantity: bigint | string): bigint {
  if (typeof quantity === "bigint") return quantity < 0n ? -quantity : quantity
  return parseQuantity(quantity.trim().replace(/^-/, "")) ?? 0n
}

/** "piece" for exactly one, otherwise "pieces". An unknown code is shown as it is. */
export function unitWord(code: string | null | undefined, quantity: bigint | string = 2000n): string {
  const def = unitDef(code)
  if (!def) return code ?? ""
  return toThousandths(quantity) === 1000n ? def.one : def.many
}

/** "2 pieces", "2.5 metres", "-1 piece". Quantity in thousandths or as the API's "3.000". */
export function formatAmount(quantity: bigint | string, code: string | null | undefined): string {
  const negative = typeof quantity === "string" ? quantity.trim().startsWith("-") : quantity < 0n
  const abs = toThousandths(quantity)
  const word = unitWord(code, abs)
  return `${negative && abs !== 0n ? "-" : ""}${formatQuantity(abs)}${word ? ` ${word}` : ""}`
}

/** For prices: "per piece", "per metre". */
export function perUnit(code: string | null | undefined): string {
  return unitDef(code)?.one ?? code ?? ""
}

/** Null when fine; otherwise why this quantity can't be used, e.g. half a shirt. */
export function wholeNumberProblem(quantity: bigint | null, code: string | null | undefined): string | null {
  const def = unitDef(code)
  if (quantity === null || !def?.whole || quantity % 1000n === 0n) return null
  return `Counted in ${def.many}, so use a whole number (1, 2, 3...).`
}
