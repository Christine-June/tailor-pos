import { describe, expect, it, vi } from "vitest"

import outboxReducer, {
  attempted,
  discarded,
  emptyOutbox,
  enqueued,
  mpesaFixed,
  mpesaReferences,
  needsAttention,
  retryRequested,
  synced,
  type OutboxEntry,
} from "@/store/outboxSlice"
import { ApiError } from "./api"
import { backoffMs, describeSynced, runSync } from "./sync"

function entry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id,
    kind: "order",
    shopId: "shop-1",
    createdBy: "Demo Cashier",
    path: "/orders",
    body: { id },
    label: `Sale ${id}`,
    createdAt: "2026-11-10T10:00:00Z",
    attempts: 0,
    state: "pending",
    error: null,
    ...overrides,
  }
}

function hooks(send: (e: OutboxEntry) => Promise<unknown>) {
  return { send: vi.fn(send), onAttempt: vi.fn(), onSynced: vi.fn(), onAttention: vi.fn() }
}

describe("runSync", () => {
  it("sends everything in order and reports each result", async () => {
    const h = hooks(async (e) => ({ id: e.id, number: e.id === "a" ? 11 : 12, status: "completed" }))
    expect(await runSync([entry("a"), entry("b")], "shop-1", h)).toBe("done")
    expect(h.send.mock.calls.map(([e]) => e.id)).toEqual(["a", "b"])
    expect(h.onSynced.mock.calls.map(([n]) => n.message)).toEqual(["Recorded as order #11.", "Recorded as order #12."])
  })

  it("stops at the first unreachable server, keeping the rest queued", async () => {
    const h = hooks(async () => {
      throw new ApiError(0, "network", "offline")
    })
    expect(await runSync([entry("a"), entry("b")], "shop-1", h)).toBe("retry-later")
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.onAttention).not.toHaveBeenCalled()
  })

  it("treats a gateway error as unreachable, not as a refusal", async () => {
    const h = hooks(async () => {
      throw new ApiError(503, "server_error", "down")
    })
    expect(await runSync([entry("a")], "shop-1", h)).toBe("retry-later")
    const crash = hooks(async () => {
      throw new ApiError(500, "server_error", "bug")
    })
    expect(await runSync([entry("a")], "shop-1", crash)).toBe("retry-later")
    expect(crash.onAttention).not.toHaveBeenCalled()
  })

  it("flags a refused entry for a person and carries on with the next", async () => {
    const h = hooks(async (e) => {
      if (e.id === "a") throw new ApiError(409, "duplicate_reference", "M-Pesa code already recorded.")
      return { id: e.id, number: 5, status: "completed" }
    })
    expect(await runSync([entry("a"), entry("b")], "shop-1", h)).toBe("done")
    expect(h.onAttention).toHaveBeenCalledWith("a", "duplicate_reference", "M-Pesa code already recorded.")
    expect(h.onSynced).toHaveBeenCalledTimes(1)
  })

  it("holds payments back while their order needs attention", async () => {
    const h = hooks(async () => ({}))
    const order = entry("o1", { state: "failed" })
    const payment = entry("p1", { kind: "payment", orderId: "o1", dependsOn: "o1", path: "/orders/o1/payments" })
    const second = entry("p2", { kind: "payment", orderId: "o1", dependsOn: "p1", path: "/orders/o1/payments" })
    const unrelated = entry("x")
    await runSync([order, payment, second, unrelated], "shop-1", h)
    expect(h.send.mock.calls.map(([e]) => e.id)).toEqual(["x"])
  })

  it("stops when the session has ended", async () => {
    const h = hooks(async () => {
      throw new ApiError(401, "unauthorized", "Sign in")
    })
    expect(await runSync([entry("a"), entry("b")], "shop-1", h)).toBe("stopped")
    expect(h.onAttention).not.toHaveBeenCalled()
  })

  it("only sends the signed-in shop's entries", async () => {
    const h = hooks(async () => ({}))
    await runSync([entry("a", { shopId: "other" })], "shop-1", h)
    expect(h.send).not.toHaveBeenCalled()
  })

  it("warns when an offline order lands as a draft", () => {
    const note = describeSynced(entry("a"), { id: "a", number: 9, status: "draft" })
    expect(note.warning).toBe(true)
    expect(note.message).toMatch(/#9 was saved as a draft/)
  })

  it("backs off up to a minute", () => {
    expect(backoffMs(1)).toBe(5_000)
    expect(backoffMs(3)).toBe(20_000)
    expect(backoffMs(20)).toBe(60_000)
  })
})

describe("fixing an M-Pesa code", () => {
  it("replaces the codes in an offline sale, keeping its id", () => {
    const { attempts: _a, state: _s, error: _e, ...base } = entry("a", {
      body: { id: "a", payments: [{ method: "cash", amount: "100.00" }, { method: "mpesa", amount: "200.00", reference: "SGK7QX2M9" }] },
    })
    let s = outboxReducer(emptyOutbox, enqueued(base))
    expect(mpesaReferences(s.entries[0]!)).toEqual(["SGK7QX2M9"])
    s = outboxReducer(s, mpesaFixed({ id: "a", references: ["SGK7QX2M9L"], allowDuplicate: false }))
    expect(s.entries[0]!.body).toEqual({
      id: "a",
      payments: [
        { method: "cash", amount: "100.00" },
        { method: "mpesa", amount: "200.00", reference: "SGK7QX2M9L", allow_duplicate_reference: false },
      ],
    })
  })

  it("marks a balance payment's code as shared", () => {
    const { attempts: _a, state: _s, error: _e, ...base } = entry("p", { kind: "payment", body: { id: "p", method: "mpesa", amount: "50.00", reference: "SGK7QX2M9L" } })
    const s = outboxReducer(outboxReducer(emptyOutbox, enqueued(base)), mpesaFixed({ id: "p", references: ["SGK7QX2M9L"], allowDuplicate: true }))
    expect(s.entries[0]!.body).toMatchObject({ reference: "SGK7QX2M9L", allow_duplicate_reference: true })
  })
})

describe("outbox state", () => {
  it("queues once per id, tracks attempts, and removes on success", () => {
    const { attempts: _a, state: _s, error: _e, ...base } = entry("a")
    let s = outboxReducer(emptyOutbox, enqueued(base))
    s = outboxReducer(s, enqueued(base))
    expect(s.entries).toHaveLength(1)
    s = outboxReducer(s, attempted("a"))
    expect(s.entries[0]!.attempts).toBe(1)
    s = outboxReducer(s, synced({ id: "a", label: "Sale", message: "Recorded as order #3.", warning: false }))
    expect(s.entries).toHaveLength(0)
    expect(s.recent[0]!.message).toBe("Recorded as order #3.")
  })

  it("moves an entry to needs-attention, back to pending on retry, and away on discard", () => {
    const { attempts: _a, state: _s, error: _e, ...base } = entry("a")
    let s = outboxReducer(emptyOutbox, enqueued(base))
    s = outboxReducer(s, needsAttention({ id: "a", code: "x", message: "Refused" }))
    expect(s.entries[0]).toMatchObject({ state: "failed", error: { message: "Refused" } })
    s = outboxReducer(s, retryRequested("a"))
    expect(s.entries[0]).toMatchObject({ state: "pending", error: null })
    s = outboxReducer(s, discarded("a"))
    expect(s.entries).toEqual([])
  })
})
