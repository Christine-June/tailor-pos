import { useEffect, useState, type ReactNode } from "react"
import { AlertTriangle, CalendarClock, PackageCheck, Phone, RefreshCw } from "lucide-react"
import { Link } from "react-router-dom"

import { StatusBadge } from "@/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatPhone, trimZeros } from "@/lib/format"
import { cents, formatMoney } from "@/lib/money"
import { parseSignedQuantity } from "@/lib/stock"
import type { DailyReport, OrderBrief, Overview } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TakingsChart } from "./TakingsChart"

export function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [today, setToday] = useState<DailyReport | null>(null)
  const [trend, setTrend] = useState<{ date: string; net_takings: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setError(null)
    Promise.all([
      api.get<Overview>("/reports/overview", { signal }),
      api.get<DailyReport>("/reports/daily", { signal }),
      api.get<{ days: { date: string; net_takings: string }[] }>("/reports/trend?days=7", { signal }),
    ])
      .then(([o, d, t]) => {
        setOverview(o)
        setToday(d)
        setTrend(t.days)
      })
      .catch((err) => !signal.aborted && setError(errorMessage(err)))
    return () => controller.abort()
  }, [reloadKey])

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw /> Try again
        </Button>
      </div>
    )
  }
  if (!overview || !today || !trend) return <div className="h-72 animate-pulse rounded-xl bg-muted" aria-busy="true" />

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Taken today" value={formatMoney(today.net_takings)} hint={cents(today.total_refunded) > 0n ? `after ${formatMoney(today.total_refunded)} refunds` : `${today.payments.length} payments`} to="/reports/cash-up" />
        <Tile label="New sales and orders today" value={formatMoney(today.sales_value)} hint={`${today.orders_created} ${today.orders_created === 1 ? "order" : "orders"}`} />
        <Tile
          label="Balances owed"
          value={formatMoney(overview.outstanding_total)}
          hint={`${overview.outstanding_count} ${overview.outstanding_count === 1 ? "order" : "orders"}`}
          to="/orders?status=all&owing=1"
        />
        <Tile label="Ready to collect" value={String(overview.awaiting_collection.length)} hint="call the customer" to="/orders?status=ready" />
      </div>

      <section className="rounded-xl border bg-card p-4">
        <TakingsChart days={trend} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <OrderList
          title="Overdue"
          icon={<AlertTriangle className="size-4 text-destructive" />}
          empty="Nothing overdue."
          orders={overview.overdue}
          tone="danger"
        />
        <OrderList title="Due in the next 3 days" icon={<CalendarClock className="size-4" />} empty="Nothing due soon." orders={overview.due_soon} />
        <OrderList title="Ready to collect" icon={<PackageCheck className="size-4 text-success" />} empty="Nothing waiting for collection." orders={overview.awaiting_collection} showCall />
        <section className="rounded-xl border bg-card">
          <h3 className="flex items-center justify-between border-b px-4 py-3 font-semibold">
            Low stock
            <Link to="/stock" className="text-xs font-normal underline underline-offset-4">
              Stock page
            </Link>
          </h3>
          {overview.low_stock.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Everything is above its warning level.</p>
          ) : (
            <ul className="divide-y text-sm">
              {overview.low_stock.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 px-4 py-2.5">
                  <span>{i.name}</span>
                  <span className={cn("tabular-nums", (parseSignedQuantity(i.quantity_on_hand) ?? 0n) <= 0n ? "text-destructive" : "text-accent-foreground")}>
                    {trimZeros(i.quantity_on_hand)} {i.unit} <span className="text-xs text-muted-foreground">(warn at {trimZeros(i.reorder_level)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Tile({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/50">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border bg-card px-4 py-3">{body}</div>
  )
}

function OrderList({ title, icon, empty, orders, tone, showCall }: { title: string; icon: ReactNode; empty: string; orders: OrderBrief[]; tone?: "danger"; showCall?: boolean }) {
  return (
    <section className="rounded-xl border bg-card">
      <h3 className="flex items-center gap-2 border-b px-4 py-3 font-semibold">
        {icon} {title}
        {orders.length > 0 && <span className={cn("ml-auto rounded-full px-2 text-xs", tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted")}>{orders.length}</span>}
      </h3>
      {orders.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y text-sm">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
              <Link to={`/orders/${o.id}`} className="min-w-0 flex-1 hover:underline">
                <span className="font-medium">#{o.number}</span> {o.customer_name}
                <span className="block text-xs text-muted-foreground">
                  {o.due_date ? `Due ${formatDate(o.due_date)}` : "No date"}
                  {cents(o.balance) > 0n && ` · ${formatMoney(o.balance)} owed`}
                </span>
              </Link>
              {!showCall && <StatusBadge status={o.status} />}
              {showCall && o.customer_phone && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`tel:${o.customer_phone}`} aria-label={`Call ${o.customer_name} on ${formatPhone(o.customer_phone)}`}>
                    <Phone /> Call
                  </a>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
