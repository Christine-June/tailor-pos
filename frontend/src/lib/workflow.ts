/**
 * The order workflow, mirroring ALLOWED_TRANSITIONS in services/orders.py so the UI only offers
 * moves the server will accept. The server still checks every move.
 */
import type { OrderStatus, Role } from "./types"

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["confirmed"],
  confirmed: ["cutting", "ready"],
  cutting: ["confirmed", "stitching"],
  stitching: ["cutting", "fitting", "ready"],
  fitting: ["stitching", "alterations", "ready"],
  alterations: ["fitting", "ready"],
  ready: ["alterations", "fitting", "completed"],
  completed: ["alterations"],
  cancelled: [],
}

/** Board columns, left to right. */
export const BOARD_COLUMNS: OrderStatus[] = ["confirmed", "cutting", "stitching", "fitting", "alterations", "ready"]
const WORKSHOP = new Set<OrderStatus>(BOARD_COLUMNS)

export const COLUMN_TITLE: Record<string, string> = {
  confirmed: "To cut",
  cutting: "Cutting",
  stitching: "Stitching",
  fitting: "Fitting",
  alterations: "Alterations",
  ready: "Ready to collect",
}

export function canMove(role: Role, kind: "retail" | "bespoke", from: OrderStatus, to: OrderStatus): boolean {
  if (from === to || kind === "retail") return false
  if (!TRANSITIONS[from].includes(to)) return false
  if (role === "tailor" && !(WORKSHOP.has(from) && WORKSHOP.has(to))) return false
  if (from === "completed" && role !== "owner") return false
  return true
}

export function allowedMoves(role: Role, kind: "retail" | "bespoke", from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => canMove(role, kind, from, to))
}

/** Words for a move button, e.g. "Start cutting", "Hand over". */
export function moveLabel(from: OrderStatus, to: OrderStatus): string {
  const forward: Record<string, string> = {
    confirmed: from === "draft" ? "Confirm order" : "Back to To cut",
    cutting: from === "confirmed" ? "Start cutting" : "Back to cutting",
    stitching: from === "cutting" ? "Start stitching" : "Back to stitching",
    fitting: "Book fitting",
    alterations: "Needs alterations",
    ready: "Mark ready",
    completed: "Hand over to customer",
  }
  if (from === "completed" && to === "alterations") return "Reopen for alterations"
  return forward[to] ?? to
}

export type DueState = "overdue" | "today" | "soon" | null

/** Compares calendar dates (YYYY-MM-DD) as strings, which sort correctly. */
export function dueState(due: string | null, today: string, status?: OrderStatus): DueState {
  if (!due || status === "ready" || status === "completed" || status === "cancelled") return null
  if (due < today) return "overdue"
  if (due === today) return "today"
  const [y, m, d] = today.split("-").map(Number)
  const soon = new Date(Date.UTC(y!, m! - 1, d! + 2)).toISOString().slice(0, 10)
  return due <= soon ? "soon" : null
}

export interface Movable {
  id: string
  status: OrderStatus
}

/** Optimistic move: the card jumps columns at once and goes back if the server refuses. */
export function moveCard<T extends Movable>(cards: T[], id: string, to: OrderStatus): T[] {
  return cards.map((c) => (c.id === id ? { ...c, status: to } : c))
}

/** Status filters on the orders list. */
export const ORDER_FILTERS: { key: string; label: string; statuses: OrderStatus[] | null }[] = [
  { key: "active", label: "In progress", statuses: ["confirmed", "cutting", "stitching", "fitting", "alterations"] },
  { key: "ready", label: "Ready", statuses: ["ready"] },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "completed", label: "Collected", statuses: ["completed"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { key: "all", label: "All", statuses: null },
]
