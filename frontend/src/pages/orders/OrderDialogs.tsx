import { useEffect, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, errorMessage } from "@/lib/api"
import { MPESA_RE } from "@/lib/checkout"
import { formatDateTime, METHOD_LABEL, STATUS_LABEL, todayIn } from "@/lib/format"
import { cents, formatMoney, parseMoney, toApiMoney } from "@/lib/money"
import type { Measurement, OrderDetail, OrderStatus, PaymentMethod, Role, StaffMember } from "@/lib/types"
import { cn } from "@/lib/utils"
import { uuid } from "@/lib/uuid"
import { moveLabel } from "@/lib/workflow"

const METHODS: PaymentMethod[] = ["cash", "mpesa", "card", "bank"]

interface BaseProps {
  open: boolean
  order: OrderDetail
  role: Role
  onClose: () => void
  onDone: (order: OrderDetail, message?: string) => void
}

function useSubmit(onDone: BaseProps["onDone"]) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  async function run(fn: () => Promise<OrderDetail>, message?: string) {
    setBusy(true)
    setError(null)
    try {
      onDone(await fn(), message)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", errorMessage(err)))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function ErrorBox({ error, children }: { error: ApiError | null; children?: ReactNode }) {
  if (!error) return null
  return (
    <div role="alert" className="space-y-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p>{error.isNetwork ? "No connection. Nothing was saved; try again. It won't be recorded twice." : error.message}</p>
      {children}
    </div>
  )
}

function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Payment method">
      {METHODS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={cn("rounded-md py-1.5 text-sm font-medium", value === m ? "bg-card shadow-xs" : "text-muted-foreground")}
        >
          {METHOD_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

/** Collect the balance (or part of it) on an existing order. */
export function TakePaymentDialog({ open, order, role, onClose, onDone }: BaseProps) {
  const balance = cents(order.balance)
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [amount, setAmount] = useState("")
  const [received, setReceived] = useState("")
  const [reference, setReference] = useState("")
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [paymentId, setPaymentId] = useState(uuid)
  const { busy, error, setError, run } = useSubmit(onDone)

  useEffect(() => {
    if (!open) return
    setMethod("cash")
    setAmount(toApiMoney(balance))
    setReceived("")
    setReference("")
    setAllowDuplicate(false)
    setPaymentId(uuid())
    setError(null)
  }, [open])

  const value = parseMoney(amount)
  const cash = parseMoney(received)
  const change = method === "cash" && value !== null && cash !== null && cash > value ? cash - value : 0n
  const ref = reference.trim().toUpperCase()
  const problem =
    value === null || value === 0n
      ? "Enter the amount."
      : value > balance
        ? `The balance is only ${formatMoney(balance)}.`
        : method === "cash" && cash !== null && cash < value
          ? "Cash received is less than the amount."
          : method === "mpesa" && !MPESA_RE.test(ref)
            ? "Enter the M-Pesa code from the SMS."
            : null

  function submit() {
    if (problem) return
    void run(
      () =>
        api.post<OrderDetail>(`/orders/${order.id}/payments`, {
          id: paymentId,
          method,
          amount: toApiMoney(value!),
          tendered: method === "cash" && cash !== null ? toApiMoney(cash) : null,
          reference: method === "cash" ? null : ref || null,
          allow_duplicate_reference: allowDuplicate,
        }),
      `${formatMoney(value!)} received${change > 0n ? `. Give ${formatMoney(change)} change.` : "."}`,
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="Take payment"
      description={`Order #${order.number} · balance ${formatMoney(balance)}`}
      footer={
        <Button size="lg" className="w-full" disabled={!!problem || busy} onClick={submit}>
          {busy && <Loader2 className="animate-spin" />}
          Record {value ? formatMoney(value) : "payment"}
        </Button>
      }
    >
      <div className="space-y-4">
        <MethodPicker value={method} onChange={setMethod} />
        <div className="space-y-1.5">
          <Label htmlFor="pay-amount">Amount</Label>
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-lg" />
        </div>
        {method === "cash" && (
          <div className="space-y-1.5">
            <Label htmlFor="pay-received">Cash received (optional, to work out change)</Label>
            <Input id="pay-received" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} className="h-11" />
            {change > 0n && <p className="text-lg font-semibold text-success">Change: {formatMoney(change)}</p>}
          </div>
        )}
        {method !== "cash" && (
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">{method === "mpesa" ? "M-Pesa code" : "Reference (optional)"}</Label>
            <Input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(method === "mpesa" ? e.target.value.toUpperCase().replace(/\s/g, "") : e.target.value)}
              maxLength={40}
              className="h-11 font-mono"
              autoComplete="off"
            />
          </div>
        )}
        {problem && amount !== "" && <p className="text-sm text-destructive">{problem}</p>}
        <ErrorBox error={error}>
          {error?.code === "duplicate_reference" && role === "owner" && (
            <label className="flex items-center gap-2 text-foreground">
              <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="size-4" />
              This one M-Pesa payment covers more than one order
            </label>
          )}
        </ErrorBox>
      </div>
    </Dialog>
  )
}

/** Owner only: return money. Recorded as a negative ledger row; the original payment stays. */
export function RefundDialog({ open, order, onClose, onDone }: BaseProps) {
  const paid = cents(order.amount_paid)
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [refundId, setRefundId] = useState(uuid)
  const { busy, error, setError, run } = useSubmit(onDone)

  useEffect(() => {
    if (!open) return
    setMethod("cash")
    setAmount("")
    setReference("")
    setNote("")
    setRefundId(uuid())
    setError(null)
  }, [open])

  const value = parseMoney(amount)
  const problem =
    value === null || value === 0n ? "Enter the amount." : value > paid ? `Only ${formatMoney(paid)} has been paid.` : note.trim().length < 3 ? "Say why (at least 3 letters)." : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="Refund"
      description={`Order #${order.number} · paid ${formatMoney(paid)}`}
      footer={
        <Button
          size="lg"
          variant="destructive"
          className="w-full"
          disabled={!!problem || busy}
          onClick={() =>
            void run(
              () => api.post<OrderDetail>(`/orders/${order.id}/refunds`, { id: refundId, method, amount: toApiMoney(value!), reference: reference.trim() || null, note: note.trim() }),
              `Refund of ${formatMoney(value!)} recorded.`,
            )
          }
        >
          {busy && <Loader2 className="animate-spin" />}
          Refund {value ? formatMoney(value) : ""}
        </Button>
      }
    >
      <div className="space-y-4">
        <MethodPicker value={method} onChange={setMethod} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ref-amount">Amount</Label>
            <Input id="ref-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-ref">Reference (optional)</Label>
            <Input id="ref-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref-note">Reason</Label>
          <Input id="ref-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Customer returned the tie" />
        </div>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  )
}

export function CancelDialog({ open, order, role, onClose, onDone }: BaseProps) {
  const paid = cents(order.amount_paid)
  const [reason, setReason] = useState("")
  const [handling, setHandling] = useState<"refund" | "retain">("refund")
  const [method, setMethod] = useState<PaymentMethod>("cash")
  const restockDefault = ["draft", "confirmed"].includes(order.status) || order.kind === "retail"
  const [restock, setRestock] = useState(restockDefault)
  const { busy, error, setError, run } = useSubmit(onDone)
  const hasStock = order.items.some((i) => i.inventory_item_id)

  useEffect(() => {
    if (!open) return
    setReason("")
    setHandling("refund")
    setMethod("cash")
    setRestock(restockDefault)
    setError(null)
  }, [open])

  const blocked = paid > 0n && role !== "owner"
  const problem = blocked ? "Only the owner can cancel an order that has payments." : reason.trim().length < 3 ? "Give a reason." : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={`Cancel order #${order.number}?`}
      description="This can't be undone. The order stays on record as cancelled."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Keep order
          </Button>
          <Button
            variant="destructive"
            disabled={!!problem || busy}
            onClick={() =>
              void run(
                () =>
                  api.post<OrderDetail>(`/orders/${order.id}/cancel`, {
                    reason: reason.trim(),
                    paid_handling: paid > 0n ? handling : null,
                    refund_method: paid > 0n && handling === "refund" ? method : null,
                    restock: hasStock ? restock : null,
                  }),
                "Order cancelled.",
              )
            }
          >
            {busy && <Loader2 className="animate-spin" />}
            Cancel order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {blocked ? (
          <p className="text-sm">
            {formatMoney(paid)} has been paid on this order. Ask the owner to cancel it.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Input id="cancel-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Customer changed their mind" />
            </div>
            {paid > 0n && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{formatMoney(paid)} has been paid. What happens to it?</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="handling" checked={handling === "refund"} onChange={() => setHandling("refund")} className="size-4" />
                  Refund it to the customer
                </label>
                {handling === "refund" && (
                  <div className="pl-6">
                    <MethodPicker value={method} onChange={setMethod} />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="handling" checked={handling === "retain"} onChange={() => setHandling("retain")} className="size-4" />
                  Keep it (e.g. a non-refundable deposit)
                </label>
              </fieldset>
            )}
            {hasStock && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 size-4" />
                <span>
                  Put the items back in stock
                  {!restockDefault && <span className="block text-xs text-muted-foreground">Cloth that has been cut usually can't go back on the shelf.</span>}
                </span>
              </label>
            )}
          </>
        )}
        <ErrorBox error={error} />
      </div>
    </Dialog>
  )
}

/** Confirms a stage change from the order page, with the owner overrides the server allows. */
export function MoveDialog({ open, order, role, to, onClose, onDone, onTakePayment }: BaseProps & { to: OrderStatus | null; onTakePayment: () => void }) {
  const [note, setNote] = useState("")
  const [override, setOverride] = useState(false)
  const { busy, error, setError, run } = useSubmit(onDone)
  useEffect(() => {
    if (!open) return
    setNote("")
    setOverride(false)
    setError(null)
  }, [open, to])
  if (!to) return null

  const balance = cents(order.balance)
  const handover = to === "completed" && balance > 0n
  const lowDeposit = order.status === "draft" && to === "confirmed"
  const blocked = handover && role !== "owner"

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={moveLabel(order.status, to)}
      description={`Order #${order.number}: ${STATUS_LABEL[order.status]} → ${STATUS_LABEL[to]}`}
      footer={
        blocked ? (
          <Button className="w-full" onClick={onTakePayment}>
            Take the balance of {formatMoney(balance)}
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            disabled={busy || (handover && !override)}
            onClick={() =>
              void run(
                () =>
                  api.post<OrderDetail>(`/orders/${order.id}/transition`, {
                    to_status: to,
                    from_status: order.status,
                    note: note.trim() || null,
                    allow_outstanding_balance: handover && override,
                    allow_low_deposit: lowDeposit && override,
                  }),
                `Moved to ${STATUS_LABEL[to]}.`,
              )
            }
          >
            {busy && <Loader2 className="animate-spin" />}
            {moveLabel(order.status, to)}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {handover && (
          <div className="rounded-md bg-warning/15 px-3 py-2 text-sm text-accent-foreground">
            <p>
              <strong>{formatMoney(balance)}</strong> is still owed. Collect it before handing over.
            </p>
            {role === "owner" && (
              <label className="mt-2 flex items-center gap-2 text-foreground">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="size-4" />
                Hand over on credit; the customer will pay later
              </label>
            )}
          </div>
        )}
        {lowDeposit && role === "owner" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="size-4" />
            Confirm even if the deposit is below the minimum
          </label>
        )}
        {!blocked && (
          <div className="space-y-1.5">
            <Label htmlFor="move-note">Note (optional)</Label>
            <Input id="move-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Shorten sleeves by 1 cm" />
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Dialog>
  )
}

/** Collection date, tailor, notes and (until cutting starts) which fitting to cut from. */
export function EditOrderDialog({ open, order, onClose, onDone, staff, timeZone }: BaseProps & { staff: StaffMember[]; timeZone: string }) {
  const [due, setDue] = useState("")
  const [assignee, setAssignee] = useState("")
  const [notes, setNotes] = useState("")
  const [measurementId, setMeasurementId] = useState("")
  const [fittings, setFittings] = useState<Measurement[]>([])
  const { busy, error, setError, run } = useSubmit(onDone)
  const canChangeFitting = !!order.customer && (order.status === "draft" || order.status === "confirmed")

  useEffect(() => {
    if (!open) return
    setDue(order.due_date ?? "")
    setAssignee(order.assigned_to?.id ?? "")
    setNotes(order.notes ?? "")
    setMeasurementId(order.measurement_id ?? "")
    setError(null)
    if (canChangeFitting) {
      api
        .get<{ items: Measurement[] }>(`/customers/${order.customer!.id}/measurements`)
        .then((r) => setFittings(r.items))
        .catch(() => setFittings([]))
    }
  }, [open])

  function save() {
    const body: Record<string, unknown> = {}
    if ((order.due_date ?? "") !== due) body.due_date = due || null
    if ((order.assigned_to?.id ?? "") !== assignee) body.assigned_to_id = assignee || null
    if ((order.notes ?? "") !== notes) body.notes = notes.trim() || null
    if (canChangeFitting && (order.measurement_id ?? "") !== measurementId) body.measurement_id = measurementId || null
    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    void run(() => api.patch<OrderDetail>(`/orders/${order.id}`, body), "Order updated.")
  }

  const tailors = staff.filter((s) => s.role !== "cashier")
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={`Edit order #${order.number}`}
      footer={
        <Button className="w-full" onClick={save} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-due">Collection date</Label>
            <Input id="edit-due" type="date" min={todayIn(timeZone)} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tailor">Tailor</Label>
            <select id="edit-tailor" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="">Not assigned</option>
              {tailors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {canChangeFitting && (
          <div className="space-y-1.5">
            <Label htmlFor="edit-fitting">Cut from measurements</Label>
            <select id="edit-fitting" value={measurementId} onChange={(e) => setMeasurementId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="">None</option>
              {fittings.map((f) => (
                <option key={f.id} value={f.id}>
                  {(f.label || "Fitting") + " · " + formatDateTime(f.recorded_at, timeZone)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Locked once cutting starts.</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="edit-notes">Notes for the workshop</Label>
          <textarea
            id="edit-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={4000}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  )
}
