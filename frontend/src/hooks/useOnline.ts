import { useSyncExternalStore } from "react"

import { isServerReachable, onReachability } from "@/lib/api"

function subscribe(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  const stop = onReachability(callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
    stop()
  }
}

/**
 * Online means the browser has a network and the server answered the last request. The browser's
 * flag alone says "online" on shop Wi-Fi whose internet is down.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine && isServerReachable(), () => true)
}
