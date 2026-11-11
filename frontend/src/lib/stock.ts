/** Stock form rules, kept pure so they can be tested. They mirror the server's validation. */
import { formatQuantity, parseMoney, parseQuantity } from "./money"
import type { ItemKind, MovementReason } from "./types"

export const REASON_LABEL: Record<MovementReason, string> = {
  purchase: "Stock received",
  sale: "Sold",
  order_cancelled: "Order cancelled",
  adjustment: "Correction",
  stock_count: "Stock count",
  waste: "Damaged / offcuts",
  return: "Customer return",
}

/** Reasons staff can pick by hand. Sales and cancellations are recorded by orders. */
export const MANUAL_REASONS: { reason: MovementReason; label: string; direction: "in" | "out" | "either" | "count" }[] = [
  { reason: "purchase", label: "Stock received", direction: "in" },
  { reason: "stock_count", label: "Counted on the shelf", direction: "count" },
  { reason: "waste", label: "Damaged / offcuts", direction: "out" },
  { reason: "return", label: "Customer return", direction: "in" },
  { reason: "adjustment", label: "Correction", direction: "either" },
]

export const KIND_LABEL: Record<ItemKind, string> = { fabric: "Fabric", trim: "Trims", retail: "Ready-made", service: "Service (no stock)" }

const SIGNED_QTY_RE = /^-?\d{1,9}(\.\d{0,3})?$/

/** Signed thousandths from "-2.5", or null. Zero is not a change. */
export function parseSignedQuantity(text: string): bigint | null {
  const value = text.trim()
  if (!SIGNED_QTY_RE.test(value) || value === "-" || value === "." || value === "-.") return null
  const negative = value.startsWith("-")
  const parsed = parseQuantity(negative ? value.slice(1) : value)
  if (parsed === null) return null
  return negative ? -parsed : parsed
}

export interface AdjustInput {
  reason: MovementReason
  /** For "count": what is on the shelf now. Otherwise the amount moved (always positive here). */
  amount: string
  /** For "either" (corrections): add or remove. */
  sign: "add" | "remove"
}

export type AdjustBody = { reason: MovementReason; delta: string; note?: string } | { reason: MovementReason; counted_quantity: string; note?: string }

/** Builds the request for /inventory/:id/adjust, or explains what's wrong. */
export function buildAdjustment(input: AdjustInput, onHand: string): { body: AdjustBody; after: bigint } | { error: string } {
  const spec = MANUAL_REASONS.find((r) => r.reason === input.reason)
  if (!spec) return { error: "Choose a reason." }
  const current = parseSignedQuantity(onHand) ?? 0n
  if (spec.direction === "count") {
    // An empty shelf is a valid count.
    const counted = /^0*\.?0*$/.test(input.amount.trim()) && input.amount.trim() !== "" ? 0n : parseQuantity(input.amount)
    if (counted === null) return { error: "Enter how much is on the shelf, e.g. 12.5." }
    return { body: { reason: input.reason, counted_quantity: formatQuantity(counted) || "0" }, after: counted }
  }
  const amount = parseQuantity(input.amount)
  if (amount === null) return { error: "Enter an amount above 0, up to 3 decimals." }
  const out = spec.direction === "out" || (spec.direction === "either" && input.sign === "remove")
  const delta = out ? -amount : amount
  const after = current + delta
  if (after < 0n) return { error: `Only ${formatQuantity(current > 0n ? current : 0n) || "0"} in stock.` }
  return { body: { reason: input.reason, delta: (out ? "-" : "") + formatQuantity(amount) }, after }
}

export interface ItemDraft {
  name: string
  sku: string
  kind: ItemKind
  category: string
  unit: string
  sellPrice: string
  costPrice: string
  trackStock: boolean
  openingQuantity: string
  reorderLevel: string
}

/** Checks the item form and builds the request body. */
export function buildItemBody(draft: ItemDraft, creating: boolean): { body: Record<string, unknown> } | { error: string } {
  if (!draft.name.trim()) return { error: "Give the item a name." }
  if (!draft.unit.trim()) return { error: "Give a unit, e.g. m, pcs or job." }
  const sell = parseMoney(draft.sellPrice || "0")
  if (sell === null) return { error: "Enter the selling price as an amount, e.g. 3500." }
  const cost = parseMoney(draft.costPrice || "0")
  if (cost === null) return { error: "Enter the cost price as an amount, or leave it blank." }
  const reorder = draft.reorderLevel.trim() ? parseQuantity(draft.reorderLevel) : 0n
  if (reorder === null) return { error: "Enter the reorder level as a quantity, e.g. 10." }
  const opening = draft.openingQuantity.trim() ? parseQuantity(draft.openingQuantity) : 0n
  if (opening === null) return { error: "Enter the opening stock as a quantity, e.g. 25.5." }
  const track = draft.kind !== "service" && draft.trackStock
  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    sku: draft.sku.trim() || null,
    kind: draft.kind,
    category: draft.category.trim() || null,
    unit: draft.unit.trim(),
    sell_price: draft.sellPrice.trim() || "0",
    cost_price: draft.costPrice.trim() || "0",
    track_stock: track,
    reorder_level: formatQuantity(reorder) || "0",
  }
  if (creating && track && opening > 0n) body.opening_quantity = formatQuantity(opening)
  return { body }
}
