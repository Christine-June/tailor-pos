import { useEffect, useState } from "react"
import { ArrowLeft, GitCompareArrows, Lock, Mail, Pencil, Phone, Plus, RefreshCw, Ruler, StickyNote } from "lucide-react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, formatDay, formatPhone, STATUS_LABEL } from "@/lib/format"
import { groupValues, type FieldDef } from "@/lib/measurements"
import { cents, formatMoney } from "@/lib/money"
import type { Customer, Measurement, Order, Page, Role } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useMeasurementFields } from "@/hooks/useMeasurementFields"
import { CustomerFormDialog } from "./CustomerFormDialog"

export function useCustomerData(customerId: string) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [fittings, setFittings] = useState<Measurement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    Promise.all([
      api.get<Customer>(`/customers/${customerId}`, { signal: controller.signal }),
      api.get<Page<Measurement>>(`/customers/${customerId}/measurements`, { signal: controller.signal }),
    ])
      .then(([c, m]) => {
        setCustomer(c)
        setFittings(m.items)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
    return () => controller.abort()
  }, [customerId, reloadKey])

  return { customer, setCustomer, fittings, error, reload: () => setReloadKey((k) => k + 1) }
}

export function CustomerProfile({ role, timeZone }: { role: Role; timeZone: string }) {
  const { customerId = "" } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const fields = useMeasurementFields()
  const { customer, setCustomer, fittings, error, reload } = useCustomerData(customerId)
  const [tab, setTab] = useState<"fittings" | "orders">("fittings")
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const staff = role !== "tailor"
  const highlight = params.get("new")

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/customers">Back to customers</Link>
          </Button>
          <Button variant="outline" onClick={reload}>
            <RefreshCw /> Try again
          </Button>
        </div>
      </div>
    )
  }
  if (!customer || !fittings || !fields) {
    return <div className="mx-auto h-40 max-w-4xl animate-pulse rounded-xl bg-muted" aria-busy="true" />
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]))
  }
  function compare(a: string, b: string) {
    // Older first: the API lists newest first.
    const [older, newer] = fittings!.findIndex((f) => f.id === a) > fittings!.findIndex((f) => f.id === b) ? [a, b] : [b, a]
    navigate(`compare?a=${older}&b=${newer}`)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/customers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>

      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {(customer.first_name[0] ?? "") + (customer.last_name[0] ?? "")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{customer.full_name}</h2>
              {customer.archived && <Badge variant="secondary">Archived</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {customer.phone && (
                <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-3.5" /> {formatPhone(customer.phone)}
                </a>
              )}
              {customer.email && (
                <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Mail className="size-3.5" /> {customer.email}
                </a>
              )}
              <span>Customer since {formatDay(customer.created_at, timeZone)}</span>
            </div>
            {customer.notes && (
              <p className="mt-2 flex gap-1.5 text-sm">
                <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> {customer.notes}
              </p>
            )}
          </div>
          {staff && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> <span className="hidden sm:inline">Edit</span>
            </Button>
          )}
        </div>
      </section>

      <div className="flex items-center gap-2 border-b">
        {(staff ? (["fittings", "orders"] as const) : (["fittings"] as const)).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "fittings" ? `Measurements (${fittings.length})` : "Orders"}
          </button>
        ))}
        {tab === "fittings" && (
          <Button size="sm" className="mb-1.5 ml-auto" asChild>
            <Link to="fittings/new">
              <Plus /> New fitting
            </Link>
          </Button>
        )}
      </div>

      {tab === "orders" ? (
        <CustomerOrders customerId={customer.id} timeZone={timeZone} />
      ) : fittings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Ruler className="size-8" aria-hidden="true" />
          <p className="text-sm">No measurements yet.</p>
          <Button asChild className="mt-1">
            <Link to="fittings/new">Take measurements</Link>
          </Button>
        </div>
      ) : (
        <>
          {fittings.length > 1 && (
            <p className="text-sm text-muted-foreground">Tick two fittings to compare them side by side.</p>
          )}
          <ol className="space-y-3">
            {fittings.map((f, i) => (
              <FittingCard
                key={f.id}
                fitting={f}
                fields={fields}
                timeZone={timeZone}
                latest={i === 0}
                highlight={f.id === highlight}
                selectable={fittings.length > 1}
                selected={selected.includes(f.id)}
                onToggle={() => toggle(f.id)}
                onComparePrevious={i < fittings.length - 1 ? () => compare(fittings[i + 1]!.id, f.id) : undefined}
              />
            ))}
          </ol>
          {selected.length === 2 && (
            <div className="sticky bottom-4 flex justify-center">
              <Button size="lg" className="shadow-lg" onClick={() => compare(selected[0]!, selected[1]!)}>
                <GitCompareArrows /> Compare the 2 selected fittings
              </Button>
            </div>
          )}
        </>
      )}

      <CustomerFormDialog
        open={editing}
        customer={customer}
        canArchive={staff}
        onClose={() => setEditing(false)}
        onSaved={(c) => {
          setCustomer(c)
          setEditing(false)
        }}
        onOpenExisting={(c) => {
          setEditing(false)
          navigate(`/customers/${c.id}`)
        }}
      />
    </div>
  )
}

function FittingCard({
  fitting,
  fields,
  timeZone,
  latest,
  highlight,
  selectable,
  selected,
  onToggle,
  onComparePrevious,
}: {
  fitting: Measurement
  fields: FieldDef[]
  timeZone: string
  latest: boolean
  highlight: boolean
  selectable: boolean
  selected: boolean
  onToggle: () => void
  onComparePrevious?: () => void
}) {
  const [open, setOpen] = useState(latest || highlight)
  const groups = groupValues(fitting.values, fields)
  const orders = fitting.orders ?? []
  const count = Object.keys(fitting.values).length

  return (
    <li className={cn("rounded-xl border bg-card transition-shadow", selected && "ring-2 ring-primary", highlight && "ring-2 ring-success")}>
      <div className="flex items-start gap-3 p-4">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-1 size-4 accent-[var(--primary)]"
            aria-label={`Select ${fitting.label || "fitting"} from ${formatDateTime(fitting.recorded_at, timeZone)} for comparison`}
          />
        )}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{fitting.label || "Fitting"}</span>
            {latest && <Badge>Latest</Badge>}
            <Badge variant="outline">{fitting.unit === "in" ? "inches" : "cm"}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatDateTime(fitting.recorded_at, timeZone)}
            {fitting.taken_by && ` · taken by ${fitting.taken_by}`} · {count} {count === 1 ? "measurement" : "measurements"}
          </p>
        </button>
      </div>

      {orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 text-xs">
          <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Used for</span>
          {orders.map((o) => (
            <Badge key={o.id} variant="secondary">
              Order #{o.number} · {STATUS_LABEL[o.status] ?? o.status}
            </Badge>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          {groups.map((g) => (
            <div key={g.group}>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.group}</h4>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                {g.rows.map((r) => (
                  <div key={r.key} className="flex justify-between gap-2 border-b border-dashed pb-1 text-sm">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-medium tabular-nums">
                      {r.value}
                      <span className="text-xs font-normal text-muted-foreground"> {fitting.unit}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {fitting.notes && <p className="rounded-md bg-muted px-3 py-2 text-sm">{fitting.notes}</p>}
          {onComparePrevious && (
            <Button variant="outline" size="sm" onClick={onComparePrevious}>
              <GitCompareArrows /> Compare with the fitting before
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function CustomerOrders({ customerId, timeZone }: { customerId: string; timeZone: string }) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<Page<Order>>(`/customers/${customerId}/orders`, { signal: controller.signal })
      .then((p) => setOrders(p.items))
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
    return () => controller.abort()
  }, [customerId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!orders) return <div className="h-24 animate-pulse rounded-lg bg-muted" />
  if (orders.length === 0) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No orders yet.</p>

  const owed = orders.reduce((sum, o) => sum + cents(o.balance), 0n)
  return (
    <div className="space-y-3">
      {owed > 0n && (
        <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
          Balance owed across orders: <strong>{formatMoney(owed)}</strong>
        </p>
      )}
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {orders.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-accent/60">
            <span className="font-medium">#{o.number}</span>
            <Badge variant={o.status === "cancelled" ? "outline" : "secondary"}>{STATUS_LABEL[o.status] ?? o.status}</Badge>
            <span className="text-muted-foreground">{o.kind === "bespoke" ? "Custom order" : "Sale"}</span>
            <span className="text-muted-foreground">{formatDay(o.created_at, timeZone)}</span>
            <span className="ml-auto text-right">
              {formatMoney(o.total)}
              {cents(o.balance) > 0n && <span className="block text-xs text-destructive">{formatMoney(o.balance)} due</span>}
            </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
