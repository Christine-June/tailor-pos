import { useEffect, useState, type ReactNode } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Package,
  Plus,
  RefreshCw,
  Ruler,
  Scissors,
  ShoppingBag,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"
import { percentChange } from "@/lib/chart"
import { formatDate, formatDateTime, METHOD_LABEL, STATUS_LABEL, trimZeros } from "@/lib/format"
import { cents, formatMoney } from "@/lib/money"
import type { JobCard, Payment, Role, Shop, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { BOARD_COLUMNS, COLUMN_TITLE, dueState } from "@/lib/workflow"
import { useAppSelector } from "@/store"
import { AreaChart, type Point } from "./AreaChart"

interface Totals {
  takings: string
  orders: number
  sales_value: string
}

interface DashboardData {
  today: string
  this_period: Totals
  previous_period: Totals
  daily: { date: string; takings: string; orders: number }[]
  by_method: { method: string; amount: string; count: number }[]
  top_products: { name: string; quantity: string; unit: string | null; revenue: string }[]
  recent_payments: (Payment & { order_number: number; customer_name: string })[]
  staff: Partial<Record<Role, number>>
  products: { active: number; low: number }
  customers: { total: number; new: number }
  workshop: Partial<Record<string, number>>
  overdue: number
}

const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-KE", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
const METHOD_ICON: Record<string, typeof Wallet> = { cash: Banknote, mpesa: Smartphone, card: CreditCard }

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date()))
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

export function DashboardPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  return user.role === "tailor" ? <TailorDashboard user={user} shop={shop} /> : <ShopDashboard user={user} shop={shop} />
}

function Header({ user, shop, subtitle, action }: { user: User; shop: Shop; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {greeting(shop.timezone)}, {user.name.split(" ")[0]}
        </h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

function Card({ title, subtitle, action, children, className }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="font-semibold">{title}</h3>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

function Kpi({ icon, label, value, change, hint }: { icon: ReactNode; label: string; value: string; change: number | null | undefined; hint?: string }) {
  const up = change !== null && change !== undefined && change >= 0
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{label}</p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">{icon}</span>
      </div>
      <p className="mt-2 truncate text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
        {change === undefined ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : change === null ? (
          <span className="text-muted-foreground">new this week</span>
        ) : (
          <>
            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium", up ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive")}>
              {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {Math.abs(change)}%
            </span>
            <span className="text-muted-foreground">vs last week</span>
          </>
        )}
      </p>
    </div>
  )
}

// The last numbers seen, so coming back to the dashboard shows them at once (no flash of
// placeholders) while fresh ones load quietly. Cleared when another shop signs in.
let lastSeen: { shopId: string; data: DashboardData } | null = null

function ShopDashboard({ user, shop }: { user: User; shop: Shop }) {
  const [data, setData] = useState<DashboardData | null>(lastSeen?.shopId === shop.id ? lastSeen.data : null)
  const [error, setError] = useState<string | null>(null)
  const [series, setSeries] = useState<"takings" | "orders">("takings")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    api
      .get<DashboardData>("/reports/dashboard", { signal: controller.signal })
      .then((fresh) => {
        lastSeen = { shopId: shop.id, data: fresh }
        setData(fresh)
      })
      .catch((err) => !controller.signal.aborted && !lastSeen && setError(errorMessage(err)))
    return () => controller.abort()
  }, [reloadKey, shop.id])

  const header = (
    <Header
      user={user}
      shop={shop}
      subtitle={`Here's how ${shop.name} is doing this week.`}
      action={
        <Button asChild>
          <Link to="/sell">
            <Plus /> New sale
          </Link>
        </Button>
      }
    />
  )

  if (error) {
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        {header}
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-5" aria-busy="true">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  const now = data.this_period
  const before = data.previous_period
  const takingsNow = Number(cents(now.takings))
  const avgNow = now.orders ? cents(now.sales_value) / BigInt(now.orders) : 0n
  const avgBefore = before.orders ? cents(before.sales_value) / BigInt(before.orders) : 0n
  const methodTotal = data.by_method.reduce((s, m) => s + cents(m.amount), 0n)
  const topMax = data.top_products.reduce((m, p) => (cents(p.revenue) > m ? cents(p.revenue) : m), 0n)
  const points: Point[] = data.daily.map((d, i) => ({
    label: i === data.daily.length - 1 ? "Today" : day(d.date, { weekday: "short" }),
    detail: day(d.date, { weekday: "long", day: "numeric", month: "short" }),
    value: series === "takings" ? Number(cents(d.takings)) / 100 : d.orders,
    display: series === "takings" ? formatMoney(d.takings) : `${d.orders} ${d.orders === 1 ? "order" : "orders"}`,
  }))
  const staffTotal = Object.values(data.staff).reduce((a, b) => a + (b ?? 0), 0)
  const inWorkshop = BOARD_COLUMNS.reduce((s, c) => s + (data.workshop[c] ?? 0), 0)

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {header}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi icon={<Wallet className="size-4" />} label="Takings this week" value={formatMoney(now.takings)} change={percentChange(takingsNow, Number(cents(before.takings)))} />
        <Kpi icon={<ShoppingBag className="size-4" />} label="Sales and orders" value={String(now.orders)} change={percentChange(now.orders, before.orders)} />
        <Kpi icon={<ClipboardList className="size-4" />} label="Average order" value={formatMoney(avgNow)} change={percentChange(Number(avgNow), Number(avgBefore))} />
        <Kpi icon={<Users className="size-4" />} label="Customers" value={String(data.customers.total)} change={undefined} hint={`${data.customers.new} new this week`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          title={series === "takings" ? "Takings" : "Orders"}
          subtitle="Last 7 days"
          action={
            <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-xs" role="radiogroup" aria-label="Chart shows">
              {(["takings", "orders"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={series === s}
                  onClick={() => setSeries(s)}
                  className={cn("rounded-md px-3 py-1 font-medium", series === s ? "bg-card shadow-xs" : "text-muted-foreground")}
                >
                  {s === "takings" ? "Takings" : "Orders"}
                </button>
              ))}
            </div>
          }
        >
          <AreaChart
            points={points}
            caption={series === "takings" ? "Takings per day" : "Orders per day"}
            formatAxis={(v) => (series === "takings" ? (v >= 1000 ? `${trimZeros((v / 1000).toFixed(1))}k` : String(Math.round(v))) : String(Math.round(v)))}
          />
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <AccountCard user={user} shop={shop} staffOnDuty={staffTotal} />
          <Card title="Payment methods" subtitle="This week">
            {data.by_method.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet this week.</p>
            ) : (
              <ul className="space-y-3">
                {data.by_method.map((m) => {
                  const Icon = METHOD_ICON[m.method] ?? Wallet
                  const share = methodTotal > 0n ? Number((cents(m.amount) * 1000n) / methodTotal) / 10 : 0
                  return (
                    <li key={m.method}>
                      <div className="flex items-center gap-2 text-sm">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium">{METHOD_LABEL[m.method] ?? m.method}</span>
                        <span className="text-xs text-muted-foreground">{m.count}</span>
                        <span className="ml-auto tabular-nums">{formatMoney(m.amount)}</span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-muted" role="img" aria-label={`${share}% of this week's takings`}>
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(share, 2)}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Workshop" subtitle={`${inWorkshop} jobs in progress`} action={<Link to="/workshop" className="text-xs font-medium text-primary hover:underline">Open board</Link>}>
          <ul className="space-y-2">
            {BOARD_COLUMNS.map((c) => {
              const count = data.workshop[c] ?? 0
              return (
                <li key={c} className="flex items-center gap-3 text-sm">
                  <span className="w-28 text-muted-foreground">{COLUMN_TITLE[c]}</span>
                  <div className="h-2 flex-1 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary/80" style={{ width: inWorkshop ? `${(count / inWorkshop) * 100}%` : 0 }} />
                  </div>
                  <span className="w-6 text-right font-medium tabular-nums">{count}</span>
                </li>
              )
            })}
          </ul>
          {data.overdue > 0 && (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              <CalendarClock className="size-3.5" /> {data.overdue} {data.overdue === 1 ? "job is" : "jobs are"} past the collection date
            </p>
          )}
        </Card>

        <Card title="Top sellers" subtitle="This week, by value">
          {data.top_products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales yet this week.</p>
          ) : (
            <ul className="space-y-3">
              {data.top_products.map((p) => (
                <li key={p.name}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 tabular-nums">{formatMoney(p.revenue)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary/70" style={{ width: topMax > 0n ? `${Number((cents(p.revenue) * 100n) / topMax)}%` : 0 }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {trimZeros(p.quantity)} {p.unit ?? ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent payments" action={<Link to="/reports/cash-up" className="text-xs font-medium text-primary hover:underline">Cash-up</Link>}>
          {data.recent_payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="divide-y">
              {data.recent_payments.map((p) => {
                const Icon = METHOD_ICON[p.method] ?? Wallet
                return (
                  <li key={p.id}>
                    <Link to={`/orders/${p.order_id}`} className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Icon className="size-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.customer_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          #{p.order_number} · {formatDateTime(p.created_at, shop.timezone).split(", ").pop()}
                        </span>
                      </span>
                      <span className={cn("tabular-nums", p.kind === "refund" && "text-destructive")}>{formatMoney(p.amount)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat icon={<Package className="size-4" />} label="Products for sale" value={String(data.products.active)} hint={data.products.low ? `${data.products.low} low on stock` : "All stocked"} to="/stock" warn={data.products.low > 0} />
        <MiniStat icon={<Scissors className="size-4" />} label="Ready to collect" value={String(data.workshop.ready ?? 0)} hint="Call the customers" to="/orders?status=ready" />
        <MiniStat icon={<Users className="size-4" />} label="Staff accounts" value={String(staffTotal)} hint={`${data.staff.owner ?? 0} owner · ${data.staff.cashier ?? 0} cashier · ${data.staff.tailor ?? 0} tailor`} />
      </div>
    </div>
  )
}

function MiniStat({ icon, label, value, hint, to, warn }: { icon: ReactNode; label: string; value: string; hint: string; to?: string; warn?: boolean }) {
  const body = (
    <>
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold tabular-nums">{value}</span>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className={cn("block truncate text-xs", warn ? "text-warning-foreground" : "text-muted-foreground")}>{hint}</span>
      </span>
    </>
  )
  const cls = "flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
  return to ? (
    <Link to={to} className={cn(cls, "transition-colors hover:border-primary/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", cashier: "Cashier", tailor: "Tailor" }

/** Who is signed in, on which shop. */
export function AccountCard({ user, shop, staffOnDuty, link = true }: { user: User; shop: Shop; staffOnDuty?: number; link?: boolean }) {
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return (
    <section className="rounded-2xl border bg-gradient-to-br from-primary to-[oklch(0.45_0.2_265)] p-5 text-primary-foreground shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-white/20 text-lg font-semibold">{initials}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-white/80">{user.email}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium">{ROLE_LABEL[user.role]}</span>
        <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium">{shop.name}</span>
        {staffOnDuty !== undefined && <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium">{staffOnDuty} staff</span>}
      </div>
      {link && (
        <Link to="/account" className="mt-4 inline-block text-sm font-medium underline-offset-4 hover:underline">
          My account →
        </Link>
      )}
    </section>
  )
}

function TailorDashboard({ user, shop }: { user: User; shop: Shop }) {
  const [cards, setCards] = useState<JobCard[] | null>(null)
  const [today, setToday] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<{ items: JobCard[]; today: string }>("/workshop/board", { signal: controller.signal })
      .then((d) => {
        setCards(d.items)
        setToday(d.today)
      })
      .catch((err) => !controller.signal.aborted && setError(errorMessage(err)))
    return () => controller.abort()
  }, [])

  const mine = (cards ?? []).filter((c) => c.assigned_to?.id === user.id)
  const overdue = (cards ?? []).filter((c) => dueState(c.due_date, today, c.status) === "overdue")
  const soon = [...(cards ?? [])]
    .filter((c) => c.status !== "ready" && c.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    .slice(0, 6)

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Header
        user={user}
        shop={shop}
        subtitle="Your workshop today."
        action={
          <Button asChild>
            <Link to="/workshop">
              <Scissors /> Open the board
            </Link>
          </Button>
        }
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !cards ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Kpi icon={<Scissors className="size-4" />} label="My jobs" value={String(mine.length)} change={undefined} hint="assigned to you" />
            <Kpi icon={<ClipboardList className="size-4" />} label="In the workshop" value={String(cards.filter((c) => c.status !== "ready").length)} change={undefined} hint="all tailors" />
            <Kpi icon={<CalendarClock className="size-4" />} label="Overdue" value={String(overdue.length)} change={undefined} hint="past collection date" />
            <Kpi icon={<Ruler className="size-4" />} label="Ready to collect" value={String(cards.filter((c) => c.status === "ready").length)} change={undefined} hint="waiting for customers" />
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title="Due next" subtitle="Soonest collection dates first">
              {soon.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="divide-y">
                  {soon.map((c) => {
                    const due = dueState(c.due_date, today, c.status)
                    return (
                      <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <span className="font-semibold">#{c.number}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{c.customer_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{c.items.map((i) => i.description).join(", ")}</span>
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[c.status]}</span>
                        <span className={cn("w-24 text-right text-xs", due === "overdue" ? "font-medium text-destructive" : due ? "text-warning-foreground" : "text-muted-foreground")}>
                          {formatDate(c.due_date!).replace(/^\w+, /, "").replace(/ \d{4}$/, "")}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
            <AccountCard user={user} shop={shop} />
          </div>
        </>
      )}
    </div>
  )
}
