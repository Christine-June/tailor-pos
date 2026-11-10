import { useEffect, useState } from "react"
import { ArrowLeft, Ban, CalendarClock, Pencil, Printer, ReceiptText, RefreshCw, Ruler, Undo2, UserRound, Wallet } from "lucide-react"
import { Link, useParams } from "react-router-dom"

import { JobCardDoc } from "@/components/JobCardDoc"
import { PrintRoot, Receipt } from "@/components/Receipt"
import { StatusBadge } from "@/components/StatusBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMeasurementFields } from "@/hooks/useMeasurementFields"
import { usePrint } from "@/hooks/usePrint"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatDateTime, formatPhone, METHOD_LABEL, STATUS_LABEL, todayIn, trimZeros } from "@/lib/format"
import { cents, formatMoney } from "@/lib/money"
import type { JobCard, OrderDetail, OrderStatus, Role, Shop, StaffMember } from "@/lib/types"
import { cn } from "@/lib/utils"
import { allowedMoves, dueState, moveLabel } from "@/lib/workflow"
import { CancelDialog, EditOrderDialog, MoveDialog, RefundDialog, TakePaymentDialog } from "./OrderDialogs"

type DialogName = "pay" | "refund" | "cancel" | "edit" | "move" | null

export function toJobCard(order: OrderDetail): JobCard {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customer_name: order.customer?.full_name ?? "Walk-in",
    assigned_to: order.assigned_to,
    items: order.items.map((i) => ({ description: i.description, quantity: i.quantity, notes: i.notes })),
    measurement: order.measurement,
    due_date: order.due_date,
    notes: order.notes,
  }
}

export function OrderDetailPage({ role, shop }: { role: Role; shop: Shop }) {
  const { orderId = "" } = useParams()
  const fields = useMeasurementFields()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [dialog, setDialog] = useState<DialogName>(null)
  const [moveTo, setMoveTo] = useState<OrderStatus | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [printing, setPrinting] = usePrint<"receipt" | "job">()
  const [thermal, setThermal] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    api
      .get<OrderDetail>(`/orders/${orderId}`, { signal: controller.signal })
      .then(setOrder)
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
    return () => controller.abort()
  }, [orderId, reloadKey])

  useEffect(() => {
    api
      .get<{ items: StaffMember[] }>("/staff")
      .then((r) => setStaff(r.items))
      .catch(() => undefined)
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/orders">Back to orders</Link>
          </Button>
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      </div>
    )
  }
  if (!order || !fields) return <div className="mx-auto h-48 max-w-5xl animate-pulse rounded-xl bg-muted" aria-busy="true" />

  const balance = cents(order.balance)
  const paid = cents(order.amount_paid)
  const closed = order.status === "cancelled"
  const moves = allowedMoves(role, order.kind, order.status)
  const due = dueState(order.due_date, todayIn(shop.timezone), order.status)

  function done(updated: OrderDetail, message?: string) {
    setOrder(updated)
    setDialog(null)
    setMoveTo(null)
    setFlash(message ?? null)
  }

  async function thermalPrint(kind: "receipt" | "job-card") {
    setThermal("Sending…")
    try {
      const r = await api.post<{ status: string }>(`/print/orders/${order!.id}/${kind}`)
      setThermal(r.status === "queued" ? "Sent to the shop printer." : "Printed.")
    } catch (err) {
      setThermal(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link to="/orders" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Orders
      </Link>

      {/* Header */}
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold">#{order.number}</h2>
              <StatusBadge status={order.status} />
              <Badge variant="outline">{order.kind === "bespoke" ? "Custom order" : "Sale"}</Badge>
              {order.created_offline && <Badge variant="outline">Made offline</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              {order.customer ? (
                <Link to={`/customers/${order.customer.id}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <UserRound className="size-3.5" /> {order.customer.full_name}
                  {order.customer.phone && ` · ${formatPhone(order.customer.phone)}`}
                </Link>
              ) : (
                <span>Walk-in customer</span>
              )}
              {order.due_date && (
                <span className={cn("inline-flex items-center gap-1.5", due === "overdue" && "font-medium text-destructive", due === "today" && "font-medium text-accent-foreground")}>
                  <CalendarClock className="size-3.5" />
                  {due === "overdue" ? "Overdue: " : "Collect "}
                  {formatDate(order.due_date)}
                </span>
              )}
              {order.kind === "bespoke" && <span>Tailor: {order.assigned_to?.name ?? "not assigned"}</span>}
              <span>
                Created {formatDateTime(order.created_at, shop.timezone)}
                {order.created_by && ` by ${order.created_by}`}
              </span>
            </div>
            {order.cancel_reason && <p className="mt-2 text-sm text-destructive">Cancelled: {order.cancel_reason}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Balance</p>
            <p className={cn("text-2xl font-semibold", balance > 0n ? "text-destructive" : "text-success")}>{formatMoney(balance)}</p>
            <p className="text-xs text-muted-foreground">
              of {formatMoney(order.total)} · paid {formatMoney(paid)}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {balance > 0n && !closed && (
            <Button onClick={() => setDialog("pay")}>
              <Wallet /> Take payment
            </Button>
          )}
          {moves.map((to) => (
            <Button
              key={to}
              variant={to === "completed" || moves.length === 1 ? "default" : "outline"}
              onClick={() => {
                setMoveTo(to)
                setDialog("move")
              }}
            >
              {moveLabel(order.status, to)}
            </Button>
          ))}
          {!closed && order.kind === "bespoke" && (
            <Button variant="outline" onClick={() => setDialog("edit")}>
              <Pencil /> Edit
            </Button>
          )}
          <Button variant="outline" onClick={() => setPrinting("receipt")}>
            <ReceiptText /> Receipt
          </Button>
          {order.kind === "bespoke" && (
            <Button variant="outline" onClick={() => setPrinting("job")}>
              <Printer /> Job card
            </Button>
          )}
          {shop.printer_mode !== "none" && (
            <Button variant="ghost" onClick={() => void thermalPrint(order.kind === "bespoke" ? "job-card" : "receipt")}>
              <Printer /> Thermal {order.kind === "bespoke" ? "job card" : "receipt"}
            </Button>
          )}
          <span className="ml-auto flex gap-2">
            {role === "owner" && paid > 0n && (
              <Button variant="ghost" onClick={() => setDialog("refund")}>
                <Undo2 /> Refund
              </Button>
            )}
            {!closed && !(order.status === "completed" && order.kind === "bespoke") && (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog("cancel")}>
                <Ban /> Cancel order
              </Button>
            )}
          </span>
        </div>
        {(flash || thermal) && (
          <p role="status" className="mt-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {flash ?? thermal}
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* Items */}
          <section className="overflow-hidden rounded-xl border bg-card">
            <h3 className="border-b px-4 py-3 font-semibold">Items</h3>
            <ul className="divide-y">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.description}</p>
                    <p className="text-muted-foreground">
                      {trimZeros(item.quantity)}
                      {item.unit ? ` ${item.unit}` : ""} × {formatMoney(item.unit_price)}
                    </p>
                    {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                  </div>
                  <p className="font-medium">{formatMoney(item.line_total)}</p>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t bg-muted/40 px-4 py-3 text-sm">
              {cents(order.discount) > 0n && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Subtotal</dt>
                    <dd>{formatMoney(order.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Discount</dt>
                    <dd>-{formatMoney(order.discount)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd>{formatMoney(order.total)}</dd>
              </div>
              {cents(order.tax_amount) > 0n && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <dt>Includes VAT</dt>
                  <dd>{formatMoney(order.tax_amount)}</dd>
                </div>
              )}
            </dl>
          </section>

          {order.notes && (
            <section className="rounded-xl border bg-card px-4 py-3 text-sm">
              <h3 className="mb-1 font-semibold">Notes for the workshop</h3>
              <p className="whitespace-pre-line">{order.notes}</p>
            </section>
          )}

          {order.kind === "bespoke" && (order.measurement || !closed) && (
            <section className="rounded-xl border bg-card px-4 py-3 text-sm">
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                <Ruler className="size-4" /> Measurements
              </h3>
              {order.measurement ? (
                <p>
                  Cut from <strong>{order.measurement.label || "fitting"}</strong> taken {formatDateTime(order.measurement.recorded_at, shop.timezone)}.{" "}
                  {order.customer && (
                    <Link className="underline underline-offset-4" to={`/customers/${order.customer.id}`}>
                      See all fittings
                    </Link>
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground">No measurements linked yet. Use Edit to choose a fitting before cutting starts.</p>
              )}
            </section>
          )}
        </div>

        <div className="space-y-5">
          {/* Payments */}
          <section className="overflow-hidden rounded-xl border bg-card">
            <h3 className="border-b px-4 py-3 font-semibold">Payments</h3>
            {order.payments.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing paid yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {order.payments.map((p) => (
                  <li key={p.id} className="px-4 py-2.5">
                    <div className="flex justify-between gap-2">
                      <span className={cn("font-medium", p.kind === "refund" && "text-destructive")}>
                        {p.kind === "refund" ? "Refund · " : ""}
                        {METHOD_LABEL[p.method]}
                        {p.reference && <span className="ml-1 font-mono text-xs text-muted-foreground">{p.reference}</span>}
                      </span>
                      <span className={cn("tabular-nums", p.kind === "refund" && "text-destructive")}>{formatMoney(p.amount)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(p.created_at, shop.timezone)}
                      {p.received_by && ` · ${p.received_by}`}
                      {p.change && cents(p.change) > 0n && ` · change ${formatMoney(p.change)}`}
                      {p.note && ` · ${p.note}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Timeline */}
          <section className="rounded-xl border bg-card">
            <h3 className="border-b px-4 py-3 font-semibold">History</h3>
            <ol className="space-y-3 px-4 py-3 text-sm">
              {[...order.events].reverse().map((e, i) => (
                <li key={i} className="relative border-l-2 border-border pl-3">
                  <p className="font-medium">{e.from_status ? `${STATUS_LABEL[e.from_status]} → ${STATUS_LABEL[e.to_status]}` : `Created as ${STATUS_LABEL[e.to_status]}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.created_at, shop.timezone)}
                    {e.user && ` · ${e.user}`}
                  </p>
                  {e.note && <p className="text-xs">{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <TakePaymentDialog open={dialog === "pay"} order={order} role={role} onClose={() => setDialog(null)} onDone={done} />
      <RefundDialog open={dialog === "refund"} order={order} role={role} onClose={() => setDialog(null)} onDone={done} />
      <CancelDialog open={dialog === "cancel"} order={order} role={role} onClose={() => setDialog(null)} onDone={done} />
      <EditOrderDialog open={dialog === "edit"} order={order} role={role} staff={staff} timeZone={shop.timezone} onClose={() => setDialog(null)} onDone={done} />
      <MoveDialog
        open={dialog === "move"}
        order={order}
        role={role}
        to={moveTo}
        onClose={() => setDialog(null)}
        onDone={done}
        onTakePayment={() => setDialog("pay")}
      />

      {printing === "receipt" && (
        <PrintRoot>
          <Receipt order={order} shop={shop} />
        </PrintRoot>
      )}
      {printing === "job" && (
        <PrintRoot>
          <JobCardDoc card={toJobCard(order)} fields={fields} timeZone={shop.timezone} />
        </PrintRoot>
      )}
    </div>
  )
}
