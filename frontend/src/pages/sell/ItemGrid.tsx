import { useMemo, useState } from "react"
import { PackagePlus, RefreshCw, Scissors, Search, Shirt, Ruler, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatMoney, formatQuantity, parseQuantity } from "@/lib/money"
import type { InventoryItem, ItemKind } from "@/lib/types"
import { cn } from "@/lib/utils"

const KIND_ICON: Record<ItemKind, typeof Shirt> = { fabric: Ruler, trim: Scissors, retail: Shirt, service: Wrench }

export function isMeasured(item: Pick<InventoryItem, "unit" | "kind">) {
  return item.kind === "fabric" || ["m", "yd", "cm"].includes(item.unit.toLowerCase())
}

interface ItemGridProps {
  items: InventoryItem[] | null
  error: string | null
  onRetry: () => void
  onPick: (item: InventoryItem) => void
  onCustom: () => void
}

export function ItemGrid({ items, error, onRetry, onPick, onCustom }: ItemGridProps) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)

  const categories = useMemo(() => {
    const names = new Set((items ?? []).map((i) => i.category).filter((c): c is string => !!c))
    return [...names].sort()
  }, [items])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (items ?? []).filter(
      (i) => (!category || i.category === category) && (!term || i.name.toLowerCase().includes(term) || i.sku?.toLowerCase().includes(term)),
    )
  }, [items, query, category])

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items or SKU"
          className="h-11 pl-9"
          aria-label="Search items"
        />
      </div>

      {categories.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Categories">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "all"}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                category === c ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {c ?? "All"}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : items === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Loading items">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          <button
            type="button"
            onClick={onCustom}
            className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <PackagePlus className="size-5" aria-hidden="true" />
            Custom item
          </button>
          {visible.map((item) => (
            <ItemCard key={item.id} item={item} onPick={onPick} />
          ))}
          {visible.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              {items.length === 0 ? "No items yet. The owner adds them on the Stock page." : "No items match your search."}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, onPick }: { item: InventoryItem; onPick: (item: InventoryItem) => void }) {
  const Icon = KIND_ICON[item.kind]
  const onHand = parseQuantity(item.quantity_on_hand)
  const out = item.track_stock && onHand === null
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      disabled={out}
      className="group flex min-h-28 flex-col rounded-lg border bg-card p-3 text-left shadow-xs transition-all hover:border-primary/50 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{item.name}</span>
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
      </div>
      <div className="mt-auto pt-2">
        <p className="font-semibold whitespace-nowrap">
          {formatMoney(item.sell_price)}
          {isMeasured(item) && <span className="text-xs font-normal text-muted-foreground"> / {item.unit}</span>}
        </p>
        {item.track_stock && (
          <p className={cn("text-xs", out ? "text-destructive" : item.is_low ? "text-warning-foreground" : "text-muted-foreground")}>
            {out ? "Out of stock" : `${formatQuantity(onHand!)} ${item.unit} left${item.is_low ? " · low" : ""}`}
          </p>
        )}
      </div>
    </button>
  )
}
