import { useSyncExternalStore } from "react"

import { useAppSelector } from "@/store"
import { getSyncStatus, onSyncStatus } from "@/store/syncRunner"

/** The outbox for the signed-in shop, split the way the UI shows it. */
export function useOutbox() {
  const shopId = useAppSelector((s) => s.auth.shop?.id)
  const entries = useAppSelector((s) => s.outbox.entries)
  const recent = useAppSelector((s) => s.outbox.recent)
  const mine = entries.filter((e) => e.shopId === shopId)
  return {
    pending: mine.filter((e) => e.state === "pending"),
    failed: mine.filter((e) => e.state === "failed"),
    recent,
    total: mine.length,
  }
}

export function useSyncStatus() {
  return useSyncExternalStore(onSyncStatus, getSyncStatus)
}
