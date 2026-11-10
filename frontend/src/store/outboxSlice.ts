import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

/**
 * Writes made while offline, kept on the device until the server confirms them.
 * Each entry carries the id the server will store, so sending it twice records it once.
 */
export type OutboxKind = "customer" | "order" | "payment"

export interface OutboxEntry {
  /** The record's own id (customer, order or payment), also used as the entry id. */
  id: string
  kind: OutboxKind
  shopId: string
  /** Who made it, for the Sync page. The server records whoever is signed in when it syncs. */
  createdBy: string
  path: string
  body: Record<string, unknown>
  /** e.g. "Sale · KES 1,500.00 · Wanjiru Kamau" */
  label: string
  /** For a payment, the order it belongs to (to show "pending" on the order page). */
  orderId?: string
  /** Another queued record this one needs first, e.g. a customer added offline for this sale. */
  dependsOn?: string
  createdAt: string
  attempts: number
  state: "pending" | "failed"
  error: { code: string; message: string } | null
}

export interface SyncedNote {
  id: string
  label: string
  /** e.g. "Order #12" or "Synced as a draft: the deposit is below the minimum." */
  message: string
  warning: boolean
  orderId?: string
  at: string
}

export interface OutboxState {
  entries: OutboxEntry[]
  /** The last few things that synced, so staff can see the server's order numbers. */
  recent: SyncedNote[]
}

export const emptyOutbox: OutboxState = { entries: [], recent: [] }
const RECENT_LIMIT = 20

const outboxSlice = createSlice({
  name: "outbox",
  initialState: emptyOutbox,
  reducers: {
    enqueued(state, action: PayloadAction<Omit<OutboxEntry, "attempts" | "state" | "error">>) {
      if (state.entries.some((e) => e.id === action.payload.id)) return
      state.entries.push({ ...action.payload, attempts: 0, state: "pending", error: null })
    },
    attempted(state, action: PayloadAction<string>) {
      const entry = state.entries.find((e) => e.id === action.payload)
      if (entry) entry.attempts += 1
    },
    synced(state, action: PayloadAction<Omit<SyncedNote, "at"> & { at?: string }>) {
      state.entries = state.entries.filter((e) => e.id !== action.payload.id)
      state.recent.unshift({ ...action.payload, at: action.payload.at ?? new Date().toISOString() })
      state.recent = state.recent.slice(0, RECENT_LIMIT)
    },
    /** The server refused it for a reason a retry won't fix: a person has to look at it. */
    needsAttention(state, action: PayloadAction<{ id: string; code: string; message: string }>) {
      const entry = state.entries.find((e) => e.id === action.payload.id)
      if (entry) {
        entry.state = "failed"
        entry.error = { code: action.payload.code, message: action.payload.message }
      }
    },
    retryRequested(state, action: PayloadAction<string>) {
      const entry = state.entries.find((e) => e.id === action.payload)
      if (entry) {
        entry.state = "pending"
        entry.error = null
      }
    },
    /** Correct a mistyped M-Pesa code (or mark it as shared) before retrying. Same record id. */
    mpesaFixed(state, action: PayloadAction<{ id: string; references: string[]; allowDuplicate: boolean }>) {
      const entry = state.entries.find((e) => e.id === action.payload.id)
      if (!entry) return
      const refs = [...action.payload.references]
      if (entry.kind === "payment" && entry.body.method === "mpesa") {
        entry.body = { ...entry.body, reference: refs[0] ?? entry.body.reference, allow_duplicate_reference: action.payload.allowDuplicate }
      } else if (entry.kind === "order" && Array.isArray(entry.body.payments)) {
        const payments = entry.body.payments as Record<string, unknown>[]
        entry.body = {
          ...entry.body,
          payments: payments.map((p) =>
            p.method === "mpesa" ? { ...p, reference: refs.shift() ?? p.reference, allow_duplicate_reference: action.payload.allowDuplicate } : p,
          ),
        }
      }
    },
    /** Only after a person confirms: the record never reaches the server. */
    discarded(state, action: PayloadAction<string>) {
      state.entries = state.entries.filter((e) => e.id !== action.payload)
    },
    recentCleared(state) {
      state.recent = []
    },
  },
})

export const { enqueued, attempted, synced, needsAttention, retryRequested, mpesaFixed, discarded, recentCleared } = outboxSlice.actions

/** The M-Pesa codes inside an entry, in order, so they can be corrected. */
export function mpesaReferences(entry: OutboxEntry): string[] {
  if (entry.kind === "payment") return entry.body.method === "mpesa" ? [String(entry.body.reference ?? "")] : []
  const payments = (entry.body.payments as Record<string, unknown>[] | undefined) ?? []
  return payments.filter((p) => p.method === "mpesa").map((p) => String(p.reference ?? ""))
}
export default outboxSlice.reducer
