import { useCallback, useEffect, useMemo, useState } from "react"
import { History, PackagePlus, Pencil, Plus, RefreshCw, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, errorMessage } from "@/lib/api"
import { trimZeros } from "@/lib/format"
import { formatMoney, lineTotal, parseMoney } from "@/lib/money"
import { KIND_LABEL, parseSignedQuantity } from "@/lib/stock"
import type { InventoryItem, ItemKind, Page } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAppSelector } from "@/store"
import { AdjustDialog, ItemDialog, MovementsDialog } from "./StockDialogs"

export function StockPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  const isOwner = user.role === "owner"
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<ItemKind | "">("")
  const [lowOnly, setLowOnly] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null | "new">(null)
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null)
  const [history, setHistory] = useState<InventoryItem | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setError(null)
    api
      .get<Page<InventoryItem>>("/inventory?limit=2000&include_archived=true", { signal })
      .then((p) => setItems(p.items))
      .catch((err) => !signal?.aborted && setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort(), [items])
  const term = query.trim().toLowerCase()
  const visible = (items ?? []).filter(
    (i) =>
      (showArchived || !i.archived) &&
      (!kind || i.kind === kind) &&
      (!lowOnly || i.is_low) &&
      (!term || i.name.toLowerCase().includes(term) || i.sku?.toLowerCase().includes(term) || i.category?.toLowerCase().includes(term)),
  )
  const active = (items ?? []).filter((i) => !i.archived)
  const lowCount = active.filter((i) => i.is_low).length
  // Value of what's on the shelf at cost: only the owner sees cost prices.
  const stockValue = isOwner
    ? active.reduce((sum, i) => {
        const qty = parseSignedQuantity(i.quantity_on_hand) ?? 0n
        const cost = parseMoney(i.cost_price) ?? 0n
        return i.track_stock && qty > 0n ? sum + lineTotal(qty, cost) : sum
      }, 0n)
    : null

  function saved(item: InventoryItem, message: string) {
    setItems((list) => (list ? (list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item].sort((a, b) => a.name.localeCompare(b.name))) : list))
    setEditing(null)
    setAdjusting(null)
    setFlash(message)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Items for sale" value={String(active.length)} />
        <Stat label="Low or out of stock" value={String(lowCount)} tone={lowCount ? "warn" : undefined} onClick={lowCount ? () => setLowOnly(true) : undefined} />
        {stockValue !== null && <Stat label="Stock value at cost" value={formatMoney(stockValue)} />}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, SKU or category" className="h-11 pl-9" aria-label="Search stock" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind | "")} className="h-11 rounded-md border border-input bg-card px-3 text-sm" aria-label="Type">
            <option value="">All types</option>
            {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="size-4" />
            Low stock
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4" />
            Not sold any more
          </label>
          {isOwner && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> New item
            </Button>
          )}
        </div>
      </div>

      {flash && (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {flash}
        </p>
      )}

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => load()}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : items === null ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <PackagePlus className="size-8" aria-hidden="true" />
          {items.length === 0 ? "No items yet." : "No items match these filters."}
          {items.length === 0 && isOwner && (
            <Button className="mt-2" onClick={() => setEditing("new")}>
              Add your first item
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 text-right font-medium">In stock</th>
                <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Warn at</th>
                <th className="px-4 py-2.5 text-right font-medium">Price</th>
                {isOwner && <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Cost</th>}
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const qty = parseSignedQuantity(i.quantity_on_hand) ?? 0n
                return (
                  <tr key={i.id} className={cn("border-b last:border-0", i.archived && "text-muted-foreground")}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{i.name}</span>
                      {i.archived && <Badge variant="outline" className="ml-2">Not sold</Badge>}
                      <span className="block text-xs text-muted-foreground">
                        {[...new Set([KIND_LABEL[i.kind], i.category, i.sku].filter(Boolean).map((s) => s!))]
                          .filter((s, idx, all) => all.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === idx)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {i.track_stock ? (
                        <>
                          <span className={cn(qty < 0n && "font-medium text-destructive", qty >= 0n && i.is_low && "font-medium text-warning-foreground")}>
                            {trimZeros(i.quantity_on_hand)} {i.unit}
                          </span>
                          {qty < 0n ? (
                            <span className="block text-xs text-destructive">Sold offline beyond stock: count the shelf</span>
                          ) : i.is_low ? (
                            <span className="block text-xs text-warning-foreground">{qty === 0n ? "Out of stock" : "Low"}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not tracked</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-muted-foreground tabular-nums md:table-cell">{i.track_stock ? trimZeros(i.reorder_level) : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMoney(i.sell_price)}
                      <span className="text-xs text-muted-foreground"> /{i.unit}</span>
                    </td>
                    {isOwner && <td className="hidden px-4 py-2.5 text-right text-muted-foreground tabular-nums md:table-cell">{i.cost_price ? formatMoney(i.cost_price) : ""}</td>}
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {i.track_stock && !i.archived && (
                        <Button size="sm" variant="outline" onClick={() => setAdjusting(i)}>
                          Update stock
                        </Button>
                      )}
                      {i.track_stock && (
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => setHistory(i)} aria-label={`Stock history for ${i.name}`}>
                          <History />
                        </Button>
                      )}
                      {isOwner && (
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(i)} aria-label={`Edit ${i.name}`}>
                          <Pencil />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ItemDialog open={editing !== null} item={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={saved} />
      <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} onSaved={saved} />
      <MovementsDialog item={history} timeZone={shop.timezone} onClose={() => setHistory(null)} />
    </div>
  )
}

function Stat({ label, value, tone, onClick }: { label: string; value: string; tone?: "warn"; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div"
  return (
    <Comp onClick={onClick} className={cn("rounded-xl border bg-card px-4 py-3 text-left", onClick && "hover:border-primary/50")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "warn" && "text-warning-foreground")}>{value}</p>
    </Comp>
  )
}
