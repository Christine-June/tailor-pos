import { useEffect, useState } from "react"
import { Minus, Plus, ShoppingBag, Trash2, UserRound, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { cartProblems, cartTotals, lineAmount, type CartLine } from "@/lib/checkout"
import { formatDateTime, formatPhone, todayIn, trimZeros } from "@/lib/format"
import { formatMoney, formatQuantity, parseQuantity } from "@/lib/money"
import type { Measurement, Page, Role, Shop } from "@/lib/types"
import { cn } from "@/lib/utils"
import { cartCleared, customerChosen, detailsChanged, kindChanged, lineChanged, lineRemoved, measurementChosen } from "@/store/cartSlice"
import { useAppDispatch, useAppSelector } from "@/store"
import { isMeasured } from "./ItemGrid"

interface CartPanelProps {
  shop: Shop
  role: Role
  onChooseCustomer: () => void
  onCharge: () => void
}

export function CartPanel({ shop, role, onChooseCustomer, onCharge }: CartPanelProps) {
  const cart = useAppSelector((s) => s.cart)
  const dispatch = useAppDispatch()
  const totals = cartTotals(cart, shop)
  const problems = cartProblems(cart, role)
  const lineProblems = new Map(problems.filter((p) => p.lineKey).map((p) => [p.lineKey!, p.message]))
  const generalProblems = problems.filter((p) => !p.lineKey && cart.lines.length > 0)
  const isOwner = role === "owner"
  const bespoke = cart.kind === "bespoke"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="grid flex-1 grid-cols-2 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Type of sale">
          {(
            [
              ["retail", "Sale"],
              ["bespoke", "Custom order"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={cart.kind === kind}
              onClick={() => dispatch(kindChanged(kind))}
              className={cn(
                "rounded-md py-1.5 text-sm font-medium transition-colors",
                cart.kind === kind ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {(cart.lines.length > 0 || cart.customer) && (
          <Button variant="ghost" size="sm" onClick={() => dispatch(cartCleared())} aria-label="Clear cart">
            <Trash2 /> <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Customer */}
        {cart.customer ? (
          <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
              <UserRound className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{cart.customer.full_name}</p>
              <p className="text-xs text-muted-foreground">{formatPhone(cart.customer.phone) || "No phone"}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onChooseCustomer}>
              Change
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => dispatch(customerChosen({ customer: null }))} aria-label="Remove customer">
              <X />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className={cn("w-full justify-start", bespoke && "border-dashed border-primary/60")}
            onClick={onChooseCustomer}
          >
            <UserRound /> {bespoke ? "Choose customer (required)" : "Add customer (optional)"}
          </Button>
        )}

        {bespoke && cart.customer && <MeasurementSelect customerId={cart.customer.id} value={cart.measurementId} timeZone={shop.timezone} />}

        {bespoke && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="due-date">Collection date</Label>
              <Input id="due-date" type="date" min={todayIn(shop.timezone)} value={cart.dueDate} onChange={(e) => dispatch(detailsChanged({ dueDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-notes">Notes for the workshop</Label>
              <Input id="order-notes" maxLength={4000} value={cart.notes} onChange={(e) => dispatch(detailsChanged({ notes: e.target.value }))} placeholder="e.g. Slim fit, side vents" />
            </div>
          </div>
        )}

        {/* Lines */}
        {cart.lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ShoppingBag className="size-8" aria-hidden="true" />
            <p className="text-sm">Tap items to add them.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card" aria-label="Cart">
            {cart.lines.map((line) => (
              <CartRow key={line.key} line={line} canEditPrice={isOwner || line.itemId === null} problem={lineProblems.get(line.key)} />
            ))}
          </ul>
        )}

        {isOwner && cart.lines.length > 0 && (
          <div className="flex items-center gap-3">
            <Label htmlFor="discount" className="shrink-0">
              Discount (KES)
            </Label>
            <Input
              id="discount"
              inputMode="decimal"
              value={cart.discount}
              onChange={(e) => dispatch(detailsChanged({ discount: e.target.value }))}
              placeholder="0"
              className="h-9 text-right"
            />
          </div>
        )}
      </div>

      <div className="space-y-3 border-t bg-card p-3">
        <dl className="space-y-1 text-sm">
          {totals.discount > 0n && (
            <>
              <div className="flex justify-between text-muted-foreground">
                <dt>Subtotal</dt>
                <dd>{formatMoney(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Discount</dt>
                <dd>-{formatMoney(totals.discount)}</dd>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between">
            <dt className="font-medium">Total</dt>
            <dd className="text-2xl font-semibold">{formatMoney(totals.total)}</dd>
          </div>
          {totals.vat > 0n && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <dt>Includes VAT</dt>
              <dd>{formatMoney(totals.vat)}</dd>
            </div>
          )}
          {bespoke && totals.total > 0n && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <dt>Minimum deposit ({trimZeros(shop.min_deposit_pct)}%)</dt>
              <dd>{formatMoney(totals.deposit)}</dd>
            </div>
          )}
        </dl>
        {generalProblems.length > 0 && (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {generalProblems.map((p) => (
              <li key={p.message}>{p.message}</li>
            ))}
          </ul>
        )}
        <Button size="lg" className="w-full" disabled={problems.length > 0} onClick={onCharge}>
          {bespoke ? "Take payment" : "Charge"} {totals.total > 0n && formatMoney(totals.total)}
        </Button>
      </div>
    </div>
  )
}

function CartRow({ line, canEditPrice, problem }: { line: CartLine; canEditPrice: boolean; problem?: string }) {
  const dispatch = useAppDispatch()
  const measured = line.unit !== null && isMeasured({ unit: line.unit, kind: "retail" })
  const qty = parseQuantity(line.quantity)
  const change = (changes: Partial<Pick<CartLine, "quantity" | "unitPrice">>) => dispatch(lineChanged({ key: line.key, changes }))
  const step = (delta: bigint) => {
    const next = (qty ?? 0n) + delta
    if (next <= 0n) dispatch(lineRemoved(line.key))
    else change({ quantity: formatQuantity(next) })
  }

  return (
    <li className="p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-medium">{line.description}</p>
          {line.notes && <p className="truncate text-xs text-muted-foreground">{line.notes}</p>}
        </div>
        <p className="shrink-0 text-sm font-semibold">{formatMoney(lineAmount(line))}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {measured ? (
          <div className="flex items-center gap-1.5">
            <Input
              inputMode="decimal"
              value={line.quantity}
              onChange={(e) => change({ quantity: e.target.value.replace(",", ".") })}
              className="h-8 w-20 text-right"
              aria-label={`Quantity of ${line.description} in ${line.unit}`}
              aria-invalid={qty === null}
            />
            <span className="text-xs text-muted-foreground">{line.unit}</span>
          </div>
        ) : (
          <div className="flex items-center rounded-md border">
            <button type="button" className="flex size-8 items-center justify-center hover:bg-accent" onClick={() => step(-1000n)} aria-label={`One less ${line.description}`}>
              <Minus className="size-3.5" />
            </button>
            <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">
              {line.quantity}
            </span>
            <button type="button" className="flex size-8 items-center justify-center hover:bg-accent" onClick={() => step(1000n)} aria-label={`One more ${line.description}`}>
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
        <span className="text-xs text-muted-foreground">×</span>
        {canEditPrice ? (
          <Input
            inputMode="decimal"
            value={line.unitPrice}
            onChange={(e) => change({ unitPrice: e.target.value })}
            className="h-8 w-28 text-right"
            aria-label={`Price of ${line.description}`}
          />
        ) : (
          <span className="text-sm text-muted-foreground">{formatMoney(line.unitPrice)}</span>
        )}
        <Button variant="ghost" size="icon" className="ml-auto size-8 text-muted-foreground hover:text-destructive" onClick={() => dispatch(lineRemoved(line.key))} aria-label={`Remove ${line.description}`}>
          <Trash2 />
        </Button>
      </div>
      {problem && <p className="mt-1.5 text-xs text-destructive">{problem}</p>}
    </li>
  )
}

function MeasurementSelect({ customerId, value, timeZone }: { customerId: string; value: string | null; timeZone: string }) {
  const dispatch = useAppDispatch()
  const [records, setRecords] = useState<Measurement[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setRecords(null)
    setFailed(false)
    api
      .get<Page<Measurement>>(`/customers/${customerId}/measurements`, { signal: controller.signal })
      .then((page) => {
        setRecords(page.items)
        // Default to the latest fitting, newest first from the API.
        if (page.items.length && !value) dispatch(measurementChosen(page.items[0]!.id))
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
    // Reload only when the customer changes, not when the selection does.
  }, [customerId])

  if (failed) return <p className="text-xs text-destructive">Couldn't load measurements. The order can still be saved without them.</p>
  if (records === null) return <div className="h-9 animate-pulse rounded-md bg-muted" />
  if (records.length === 0) {
    return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">No measurements on record yet. Add them from the Customers page and link them to this order later.</p>
  }
  const selected = records.find((r) => r.id === value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor="measurement">Cut from measurements</Label>
      <select
        id="measurement"
        value={value ?? ""}
        onChange={(e) => dispatch(measurementChosen(e.target.value || null))}
        className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="">None for now</option>
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {(r.label || "Fitting") + " · " + formatDateTime(r.recorded_at, timeZone)}
          </option>
        ))}
      </select>
      {selected && (
        <p className="text-xs text-muted-foreground">
          {Object.entries(selected.values)
            .slice(0, 5)
            .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
            .join(" · ")}{" "}
          ({selected.unit})
        </p>
      )}
    </div>
  )
}
