import { Component, type ErrorInfo, type ReactNode } from "react"
import { RefreshCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { reportError } from "@/lib/report"

interface Props {
  children: ReactNode
  /** Inside the app layout: keep the menu, replace only the page. */
  inline?: boolean
}

/**
 * Catches a crash in a screen and shows a way out instead of a blank page. Saved sales and the
 * offline outbox live in IndexedDB, so reloading never loses them.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info.componentStack ?? undefined)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    // A new build was deployed and an old page chunk no longer exists: just reload.
    const stale = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message)
    return (
      <div className={this.props.inline ? "mx-auto max-w-md py-16 text-center" : "flex min-h-dvh items-center justify-center p-6 text-center"}>
        <div className="max-w-md space-y-3">
          <TriangleAlert className="mx-auto size-10 text-accent-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{stale ? "A newer version is ready" : "Something went wrong on this screen"}</h2>
          <p className="text-sm text-muted-foreground">
            {stale
              ? "Reload to get the latest version."
              : "Reloading usually fixes it. Sales saved on this device are kept. The problem has been reported."}
          </p>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
        </div>
      </div>
    )
  }
}
