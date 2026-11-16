import { useSyncExternalStore } from "react"

import { sendableBy } from "@/lib/sync"
import { useAppSelector } from "@/store"
import { getSyncStatus, onSyncStatus } from "@/store/syncRunner"

/** The outbox for the signed-in person, split the way the UI shows it. */
export function useOutbox() {
  const shopId = useAppSelector((s) => s.auth.shop?.id)
  const userId = useAppSelector((s) => s.auth.user?.id)
  const entries = useAppSelector((s) => s.outbox.entries)
  const recent = useAppSelector((s) => s.outbox.recent)
  const mine = entries.filter((e) => sendableBy(e, shopId, userId))
  // Made on this device by a colleague: sent when they next sign in here.
  const others = entries.filter((e) => e.shopId === shopId && !sendableBy(e, shopId, userId))
  return {
    pending: mine.filter((e) => e.state === "pending"),
    failed: mine.filter((e) => e.state === "failed"),
    waitingForOthers: others,
    recent,
    total: mine.length,
  }
}

export function useSyncStatus() {
  return useSyncExternalStore(onSyncStatus, getSyncStatus)
}
