import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronUp, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { api, errorMessage, isRetryable } from "@/lib/api"
import { cartTotals } from "@/lib/checkout"
import { formatDateTime } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import type { Customer, InventoryItem, Order, Page } from "@/lib/types"
import { catalogCached, customersCached } from "@/store/cacheSlice"
import { cartCleared, customerChosen, customLineAdded, itemAdded } from "@/store/cartSlice"
import { useAppDispatch, useAppSelector } from "@/store"
import { CartPanel } from "./CartPanel"
import { CustomerDialog } from "./CustomerPicker"
import { isMeasured, ItemGrid } from "./ItemGrid"
import { CustomLineDialog, QuantityDialog } from "./LineDialogs"
import { PaymentDialog } from "./PaymentDialog"
import { SaleCompleteDialog } from "./SaleCompleteDialog"

export function SellPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  const cart = useAppSelector((s) => s.cart)
  const dispatch = useAppDispatch()
  const desktop = useMediaQuery("(min-width: 1024px)")

  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [measuring, setMeasuring] = useState<InventoryItem | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [mobileCart, setMobileCart] = useState(false)
  const [completed, setCompleted] = useState<{ order: Order; change: bigint; offline: boolean } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const cachedCatalog = useAppSelector((s) => (s.cache.catalog?.shopId === shop.id ? s.cache.catalog : null))
  const [fromCache, setFromCache] = useState<string | null>(null)

  const loadItems = useCallback(
    (signal?: AbortSignal) => {
      setLoadError(null)
      api
        .get<Page<InventoryItem>>("/inventory?limit=1000", { signal })
        .then((page) => {
          setItems(page.items)
          setFromCache(null)
          dispatch(catalogCached({ items: page.items, shopId: shop.id }))
        })
        .catch((err) => {
          if (signal?.aborted) return
          // Offline: sell from the copy saved on this device.
          if (isRetryable(err) && cachedCatalog) {
            setItems(cachedCatalog.items)
            setFromCache(cachedCatalog.savedAt)
          } else setLoadError(errorMessage(err))
        })
    },
    // The cached copy is only a fallback; reloading when it changes would loop.
    [dispatch, shop.id],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadItems(controller.signal)
    // Keep a copy of the customer list so a sale can still be linked to a customer offline.
    api
      .get<Page<Customer>>("/customers?limit=2000", { signal: controller.signal })
      .then((page) => dispatch(customersCached({ items: page.items, shopId: shop.id })))
      .catch(() => undefined)
    return () => controller.abort()
  }, [loadItems, dispatch, shop.id])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  function flash(message: string) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }

  function pick(item: InventoryItem) {
    if (isMeasured(item)) {
      setMeasuring(item)
      return
    }
    dispatch(itemAdded({ item, quantity: "1" }))
    flash(`Added ${item.name}`)
  }

  function chooseCustomer(customer: Customer) {
    dispatch(customerChosen({ customer }))
    setCustomerOpen(false)
  }

  function paid(order: Order, change: bigint, offline: boolean) {
    setPaying(false)
    setMobileCart(false)
    setCompleted({ order, change, offline })
    dispatch(cartCleared())
    if (!offline) loadItems() // stock levels changed
  }

  const totals = cartTotals(cart, shop)
  const lineCount = cart.lines.length

  const panel = (
    <CartPanel
      shop={shop}
      role={user.role}
      onChooseCustomer={() => setCustomerOpen(true)}
      onCharge={() => setPaying(true)}
    />
  )

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="pb-24 lg:pb-0">
        {fromCache && (
          <p className="mb-3 rounded-md bg-warning/15 px-3 py-2 text-sm text-accent-foreground">
            Offline: showing items and prices saved on this device at {formatDateTime(fromCache, shop.timezone)}. Stock counts may be out of date.
          </p>
        )}
        <ItemGrid items={items} error={loadError} onRetry={() => loadItems()} onPick={pick} onCustom={() => setCustomOpen(true)} />
      </div>

      {/* Desktop and large tablets: cart alongside the items. */}
      {desktop && (
        <aside className="sticky top-[88px] flex h-[calc(100dvh-112px)] flex-col overflow-hidden rounded-xl border bg-background" aria-label="Cart">
          {panel}
        </aside>
      )}

      {/* Phones and small tablets: a bar at the bottom opens the cart. */}
      {!desktop && (
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card p-3 shadow-[0_-4px_12px_rgba(0,0,0,.06)] md:left-[76px]">
        <Button size="lg" className="w-full justify-between" onClick={() => setMobileCart(true)}>
          <span className="flex items-center gap-2">
            <ChevronUp aria-hidden="true" />
            Cart · {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
          <span>{formatMoney(totals.total)}</span>
        </Button>
      </div>
      )}
      {mobileCart && !desktop && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Cart">
          <div className="flex h-14 items-center justify-between border-b px-3">
            <h2 className="font-semibold">Cart</h2>
            <Button variant="ghost" size="icon" onClick={() => setMobileCart(false)} aria-label="Close cart">
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{panel}</div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg animate-in fade-in slide-in-from-bottom-2 lg:bottom-6">
          {toast}
        </div>
      )}

      <QuantityDialog
        item={measuring}
        onClose={() => setMeasuring(null)}
        onAdd={(item, quantity) => {
          dispatch(itemAdded({ item, quantity }))
          setMeasuring(null)
          flash(`Added ${quantity} ${item.unit} ${item.name}`)
        }}
      />
      <CustomLineDialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onAdd={(line) => {
          dispatch(customLineAdded(line))
          setCustomOpen(false)
          flash(`Added ${line.description}`)
        }}
      />
      <CustomerDialog open={customerOpen} onClose={() => setCustomerOpen(false)} onChoose={chooseCustomer} />
      <PaymentDialog open={paying} cart={cart} totals={totals} role={user.role} shop={shop} user={user} onClose={() => setPaying(false)} onPaid={paid} />
      {completed && (
        <SaleCompleteDialog order={completed.order} change={completed.change} offline={completed.offline} shop={shop} onClose={() => setCompleted(null)} />
      )}
    </div>
  )
}
