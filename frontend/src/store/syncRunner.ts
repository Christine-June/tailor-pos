import { api, isServerReachable, onReachability } from "@/lib/api"
import { backoffMs, runSync, type SyncResult } from "@/lib/sync"
import type { AppStore } from "./index"
import { attempted, needsAttention, synced } from "./outboxSlice"

type Listener = (status: SyncStatus) => void
export interface SyncStatus {
  running: boolean
  /** When the last attempt couldn't reach the server. */
  lastFailure: string | null
  nextTryAt: string | null
}

let status: SyncStatus = { running: false, lastFailure: null, nextTryAt: null }
const listeners = new Set<Listener>()
let trigger: (() => void) | null = null

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next }
  listeners.forEach((l) => l(status))
}

export function getSyncStatus() {
  return status
}
export function onSyncStatus(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** "Sync now" button, and called after anything is queued. */
export function syncNow() {
  trigger?.()
}

const POLL_MS = 30_000
const PROBE_MS = 15_000

export function startSync(store: AppStore) {
  let again = false
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const pendingCount = () => {
    const { auth, outbox } = store.getState()
    return outbox.entries.filter((e) => e.state === "pending" && e.shopId === auth.shop?.id).length
  }

  async function run() {
    if (status.running) {
      again = true
      return
    }
    const { auth, outbox } = store.getState()
    if (!auth.refreshToken || !auth.shop || pendingCount() === 0) return
    clearTimeout(retryTimer)
    setStatus({ running: true, nextTryAt: null })
    let result: SyncResult = "done"
    try {
      result = await runSync(outbox.entries, auth.shop.id, {
        // Sent exactly as queued; the stored id makes a repeat harmless.
        send: (entry) => api.post(entry.path, entry.body),
        onAttempt: (id) => store.dispatch(attempted(id)),
        onSynced: (note) => store.dispatch(synced(note)),
        onAttention: (id, code, message) => store.dispatch(needsAttention({ id, code, message })),
      })
    } finally {
      if (result === "retry-later") {
        failures += 1
        const wait = backoffMs(failures)
        retryTimer = setTimeout(() => void run(), wait)
        setStatus({ running: false, lastFailure: new Date().toISOString(), nextTryAt: new Date(Date.now() + wait).toISOString() })
      } else {
        failures = 0
        setStatus({ running: false, lastFailure: null })
      }
    }
    if (again || (result === "done" && pendingCount() > 0)) {
      again = false
      if (result === "done") void run()
    }
  }

  trigger = () => void run()
  const resume = () => {
    failures = 0
    void run()
  }
  window.addEventListener("online", resume)
  // Any request that gets through (e.g. the board refreshing) means the server is back.
  onReachability((reachable) => reachable && resume())
  // While the server is unreachable, check quietly every 15 s so the banner clears and the
  // outbox sends as soon as it's back, even if nobody touches the screen.
  setInterval(() => {
    if (!isServerReachable() && document.visibilityState === "visible") {
      api.get("/health", { auth: false }).catch(() => undefined)
    }
  }, PROBE_MS)
  setInterval(() => {
    if (document.visibilityState === "visible" && !status.nextTryAt) void run()
  }, POLL_MS)

  // Something new in the outbox, or someone signed in: try straight away.
  let lastPending = pendingCount()
  let lastToken = store.getState().auth.refreshToken
  store.subscribe(() => {
    const pending = pendingCount()
    const token = store.getState().auth.refreshToken
    if ((pending > lastPending || token !== lastToken) && pending > 0) setTimeout(() => void run(), 0)
    lastPending = pending
    lastToken = token
  })

  void run()
}
