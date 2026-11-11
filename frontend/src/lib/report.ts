/**
 * Sends browser crashes to the server (which logs them and forwards to Sentry when configured).
 * Only the error and the page path go: no customer data, no form contents, no tokens.
 */
const MAX_PER_SESSION = 10
let sent = 0
const seen = new Set<string>()

export function reportError(error: unknown, componentStack?: string): void {
  if (!import.meta.env.PROD || sent >= MAX_PER_SESSION) return
  const err = error instanceof Error ? error : new Error(String(error))
  const key = `${err.name}: ${err.message}`
  if (seen.has(key)) return
  seen.add(key)
  sent += 1
  const body = JSON.stringify({
    message: key.slice(0, 500),
    stack: `${err.stack ?? ""}\n${componentStack ?? ""}`.slice(0, 4000),
    // The path pattern only: ids in the URL are opaque, but query strings may hold search terms.
    path: window.location.pathname.slice(0, 200),
    release: __APP_VERSION__,
  })
  try {
    // keepalive lets the report finish even if the page is reloading.
    void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined)
  } catch {
    // Reporting must never cause a second error.
  }
}

export function installGlobalErrorReporting(): void {
  window.addEventListener("error", (event) => reportError(event.error ?? event.message))
  window.addEventListener("unhandledrejection", (event) => {
    // Network failures are expected offline and handled by the outbox.
    const reason = event.reason as { name?: string; code?: string } | undefined
    if (reason?.name === "ApiError" || reason?.name === "AbortError") return
    reportError(event.reason)
  })
}
