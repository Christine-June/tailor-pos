/**
 * Sends the outbox to the server, oldest first.
 * - Success: the entry leaves the outbox and a note records what the server made of it.
 * - Can't reach the server: stop and try again later; nothing is lost.
 * - Session ended: stop; the outbox waits for the next sign-in.
 * - Refused for a reason a retry won't fix (e.g. the M-Pesa code was already used): the entry is
 *   marked "needs attention" for a person, and the rest of the queue carries on.
 */
import { ApiError } from "./api"
import { formatMoney } from "./money"
import type { OutboxEntry, SyncedNote } from "@/store/outboxSlice"

export type SyncResult = "done" | "retry-later" | "stopped"

export interface SyncHooks {
  send: (entry: OutboxEntry) => Promise<unknown>
  onAttempt: (id: string) => void
  onSynced: (note: Omit<SyncedNote, "at">) => void
  onAttention: (id: string, code: string, message: string) => void
}

interface OrderLike {
  id: string
  number: number
  status: string
  balance?: string
}

export function describeSynced(entry: OutboxEntry, response: unknown): Omit<SyncedNote, "at"> {
  if (entry.kind === "order") {
    const order = response as OrderLike
    if (order?.status === "draft") {
      return {
        id: entry.id,
        label: entry.label,
        orderId: order.id,
        warning: true,
        message: `Order #${order.number} was saved as a draft because the deposit is below the minimum. Take more deposit or confirm it on the order page.`,
      }
    }
    return { id: entry.id, label: entry.label, orderId: order?.id, warning: false, message: `Recorded as order #${order?.number}.` }
  }
  if (entry.kind === "payment") {
    const order = response as OrderLike
    return { id: entry.id, label: entry.label, orderId: order?.id ?? entry.orderId, warning: false, message: `Added to order #${order?.number}${order?.balance ? `; balance now ${formatMoney(order.balance)}` : ""}.` }
  }
  return { id: entry.id, label: entry.label, warning: false, message: "Customer saved." }
}

export async function runSync(entries: OutboxEntry[], shopId: string, hooks: SyncHooks): Promise<SyncResult> {
  const queue = entries.filter((e) => e.shopId === shopId)
  const blocked = new Set(queue.filter((e) => e.state === "failed").map((e) => e.id))

  for (const entry of queue) {
    if (entry.state !== "pending") continue
    // Oldest first, so a customer or order made offline is sent before what refers to it. If that
    // record needs attention, its dependants wait with it rather than failing as "not found".
    if (entry.dependsOn && blocked.has(entry.dependsOn)) {
      blocked.add(entry.id)
      continue
    }
    hooks.onAttempt(entry.id)
    try {
      const response = await hooks.send(entry)
      hooks.onSynced(describeSynced(entry, response))
    } catch (err) {
      if (!(err instanceof ApiError)) return "retry-later"
      // Unreachable, rate-limited or a server-side fault: none of these are the record's fault.
      if (err.isRetryable || err.status === 429 || err.status >= 500) return "retry-later"
      if (err.status === 401) return "stopped"
      hooks.onAttention(entry.id, err.code, err.message)
      blocked.add(entry.id)
    }
  }
  return "done"
}

/** Wait before the next try after the server couldn't be reached: 5 s, 10 s, 20 s … up to a minute. */
export function backoffMs(failures: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, failures - 1), 60_000)
}
