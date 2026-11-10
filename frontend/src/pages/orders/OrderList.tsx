import { useEffect, useState } from "react"
import { ChevronRight, Loader2, RefreshCw, Search } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"

import { StatusBadge } from "@/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDebounced } from "@/hooks/useDebounced"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatDay, todayIn } from "@/lib/format"
import { cents, formatMoney } from "@/lib/money"
import type { Order, Page } from "@/lib/types"
import { cn } from "@/lib/utils"
import { dueState, ORDER_FILTERS } from "@/lib/workflow"

const PAGE_SIZE = 50

export function OrderList({ timeZone }: { timeZone: string }) {
  const [params, setParams] = useSearchParams()
  const filter = params.get("status") ?? "active"
  const owing = params.get("owing") === "1"
  const kind = params.get("kind") ?? ""
  const [query, setQuery] = useState(params.get("q") ?? "")
  const term = useDebounced(query.trim(), 300)
  const [items, setItems] = useState<Order[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const today = todayIn(timeZone)

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if ((params.get("q") ?? "") !== term) update({ q: term || null })
    // Only the debounced search term drives the URL here.
  }, [term])

  const queryString = (() => {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE) })
    const statuses = ORDER_FILTERS.find((f) => f.key === filter)?.statuses
    if (statuses) q.set("status", statuses.join(","))
    if (owing) q.set("outstanding", "true")
    if (kind) q.set("kind", kind)
    if (term) q.set("q", term)
    return q.toString()
  })()

  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setError(null)
    api
      .get<Page<Order>>(`/orders?${queryString}`, { signal: controller.signal })
      .then((page) => {
        setItems(page.items)
        setTotal(page.total ?? page.items.length)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
    return () => controller.abort()
  }, [queryString, reloadKey])

  async function loadMore() {
    if (!items) return
    setLoadingMore(true)
    try {
      const page = await api.get<Page<Order>>(`/orders?${queryString}&offset=${items.length}`)
      setItems([...items, ...page.items])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Order number, customer name or phone" className="h-11 pl-9" aria-label="Search orders" />
        </div>
        <select
          value={kind}
          onChange={(e) => update({ kind: e.target.value || null })}
          className="h-11 rounded-md border border-input bg-card px-3 text-sm"
          aria-label="Type of order"
        >
          <option value="">Orders and sales</option>
          <option value="bespoke">Custom orders</option>
          <option value="retail">Sales</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ORDER_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => update({ status: f.key === "active" ? null : f.key })}
            aria-pressed={filter === f.key}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
            )}
          >
            {f.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={owing} onChange={(e) => update({ owing: e.target.checked ? "1" : null })} className="size-4" />
          Balance owing
        </label>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : items === null ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No orders match these filters.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "order" : "orders"}
          </p>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {items.map((o) => {
              const balance = cents(o.balance)
              const due = dueState(o.due_date, today, o.status)
              return (
                <li key={o.id}>
                  <Link to={o.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-accent/60 sm:grid-cols-[4rem_1fr_8rem_9rem_auto]">
                    <span className="font-semibold tabular-nums">#{o.number}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{o.customer?.full_name ?? "Walk-in"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.kind === "bespoke" ? "Custom order" : "Sale"} · {formatDay(o.created_at, timeZone)}
                        {o.items[0] && ` · ${o.items[0].description}${o.items.length > 1 ? ` +${o.items.length - 1}` : ""}`}
                      </span>
                    </span>
                    <span className="hidden sm:block">
                      <StatusBadge status={o.status} />
                      {o.due_date && (
                        <span className={cn("mt-1 block text-xs", due === "overdue" ? "font-medium text-destructive" : due ? "text-accent-foreground" : "text-muted-foreground")}>
                          {due === "overdue" ? "Overdue · " : due === "today" ? "Due today · " : "Due "}
                          {formatDate(o.due_date).replace(/^\w+, /, "")}
                        </span>
                      )}
                    </span>
                    <span className="text-right text-sm">
                      {formatMoney(o.total)}
                      {balance > 0n && o.status !== "cancelled" && <span className="block text-xs font-medium text-destructive">{formatMoney(balance)} due</span>}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="col-span-2 flex items-center gap-2 sm:hidden">
                      <StatusBadge status={o.status} />
                      {due === "overdue" && <span className="text-xs font-medium text-destructive">Overdue</span>}
                    </span>
                  </Link>
                </li>
              )
            })}
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
    </div>
  )
}
