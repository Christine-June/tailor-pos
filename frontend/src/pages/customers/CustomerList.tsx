import { useEffect, useState } from "react"
import { ChevronRight, Loader2, RefreshCw, Search, UserPlus } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDebounced } from "@/hooks/useDebounced"
import { api, errorMessage } from "@/lib/api"
import { formatDay, formatPhone } from "@/lib/format"
import type { Customer, Page } from "@/lib/types"
import { CustomerFormDialog } from "./CustomerFormDialog"

const PAGE_SIZE = 50

export function CustomerList({ timeZone }: { timeZone: string }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get("q") ?? "")
  const term = useDebounced(query.trim(), 250)
  const [items, setItems] = useState<Customer[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  // Keeps the search in the URL, so Back from a profile returns to the same results.
  useEffect(() => {
    setParams(term ? { q: term } : {}, { replace: true })
  }, [term, setParams])

  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setError(null)
    api
      .get<Page<Customer>>(`/customers?limit=${PAGE_SIZE}&q=${encodeURIComponent(term)}`, { signal: controller.signal })
      .then((page) => {
        setItems(page.items)
        setTotal(page.total ?? page.items.length)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
    return () => controller.abort()
  }, [term, reloadKey])

  async function loadMore() {
    if (!items) return
    setLoadingMore(true)
    try {
      const page = await api.get<Page<Customer>>(`/customers?limit=${PAGE_SIZE}&offset=${items.length}&q=${encodeURIComponent(term)}`)
      setItems([...items, ...page.items])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, phone or email" className="h-11 pl-9" aria-label="Search customers" />
        </div>
        <Button size="lg" onClick={() => setCreating(true)}>
          <UserPlus /> New customer
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : items === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading customers">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {term ? `No customers match “${term}”.` : "No customers yet. Add your first one."}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "customer" : "customers"}
          </p>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {items.map((c) => (
              <li key={c.id}>
                <Link to={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/60">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                    {(c.first_name[0] ?? "") + (c.last_name[0] ?? "")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.full_name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[formatPhone(c.phone), c.email].filter(Boolean).join(" · ") || "No contact details"}
                    </span>
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">Since {formatDay(c.created_at, timeZone)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <div className="text-center">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" />}
                Show more
              </Button>
            </div>
          )}
        </>
      )}

      <CustomerFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(c) => navigate(c.id)}
        onOpenExisting={(c) => navigate(c.id)}
      />
    </div>
  )
}
