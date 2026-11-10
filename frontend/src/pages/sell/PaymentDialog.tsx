import { useEffect, useState } from "react"
import { Banknote, CreditCard, Loader2, Smartphone, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ApiError, api, errorMessage } from "@/lib/api"
import { buildOrderPayload, chargeBlocker, settle, type Cart, type Tender, type TenderMethod, type Totals } from "@/lib/checkout"
import { formatMoney, parseMoney, toApiMoney } from "@/lib/money"
import type { Order, Role } from "@/lib/types"
import { cn } from "@/lib/utils"
import { uuid } from "@/lib/uuid"

const METHODS: { method: TenderMethod; label: string; icon: typeof Banknote }[] = [
  { method: "cash", label: "Cash", icon: Banknote },
  { method: "mpesa", label: "M-Pesa", icon: Smartphone },
  { method: "card", label: "Card", icon: CreditCard },
]

const newTender = (method: TenderMethod, amount = ""): Tender => ({ key: uuid(), method, amount, reference: "" })

/** Amounts a cashier is likely to be handed for a given total: the next 100, 500 and 1,000. */
export function cashSuggestions(due: bigint): bigint[] {
  if (due <= 0n) return []
  const out = new Set<bigint>()
  for (const step of [10000n, 50000n, 100000n]) {
    const up = ((due + step - 1n) / step) * step
    if (up > due) out.add(up)
  }
  return [...out].sort((a, b) => (a < b ? -1 : 1)).slice(0, 3)
}

interface PaymentDialogProps {
  open: boolean
  cart: Cart
  totals: Totals
  role: Role
  onClose: () => void
  onPaid: (order: Order, change: bigint) => void
}

export function PaymentDialog({ open, cart, totals, role, onClose, onPaid }: PaymentDialogProps) {
  const [tenders, setTenders] = useState<Tender[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const bespoke = cart.kind === "bespoke"

  useEffect(() => {
    if (open) {
      setTenders([newTender("cash")])
      setError(null)
      setAllowDuplicate(false)
      setBusy(false)
    }
  }, [open])

  const settlement = settle(tenders, totals.total)
  const blocker = chargeBlocker(cart.kind, totals, settlement, role)
  const belowDeposit = bespoke && settlement.paid < totals.deposit

  const update = (key: string, changes: Partial<Tender>) => {
    setTenders((ts) => ts.map((t) => (t.key === key ? { ...t, ...changes } : t)))
    setError(null)
  }
  /** What is still owed if this row were left out. */
  const owedExcept = (key: string) => {
    const others = settle(
      tenders.filter((t) => t.key !== key && parseMoney(t.amount) !== null),
      totals.total,
    )
    return totals.total - others.paid
  }

  async function charge() {
    if (blocker) return
    setBusy(true)
    setError(null)
    try {
      const order = await api.post<Order>("/orders", buildOrderPayload(cart, settlement, allowDuplicate))
      onPaid(order, settlement.change)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "error", errorMessage(err)))
      setBusy(false)
    }
  }

  const title = bespoke ? "Take payment" : "Charge"
  const actionLabel = bespoke
    ? settlement.paid >= totals.total
      ? `Confirm order · paid in full`
      : `Confirm order · ${formatMoney(settlement.paid)} now`
    : `Complete sale · ${formatMoney(totals.total)}`

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={title}
      description={bespoke ? `Order total ${formatMoney(totals.total)} · deposit at least ${formatMoney(totals.deposit)}` : `Total ${formatMoney(totals.total)}`}
      className="sm:max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button size="lg" className="flex-1 sm:flex-none" disabled={!!blocker || busy} onClick={() => void charge()}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? "Saving…" : actionLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-3">
          {tenders.map((tender) => {
            const meta = METHODS.find((m) => m.method === tender.method)!
            const Icon = meta.icon
            const owed = owedExcept(tender.key)
            const chips: { label: string; amount: bigint }[] = []
            if (owed > 0n) {
              if (bespoke && totals.deposit > 0n && totals.deposit < totals.total) {
                const depositPart = totals.deposit - (totals.total - owed)
                if (depositPart > 0n) chips.push({ label: "Deposit", amount: depositPart })
              }
              chips.push({ label: bespoke ? "Full" : "Exact", amount: owed })
              if (tender.method === "cash" && !bespoke) for (const s of cashSuggestions(owed)) chips.push({ label: formatMoney(s, "").trim(), amount: s })
            }
            return (
              <li key={tender.key} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{tender.method === "cash" ? "Cash received" : meta.label}</span>
                  {(tenders.length > 1 || bespoke) && (
                    <button
                      type="button"
                      className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setTenders((ts) => ts.filter((t) => t.key !== tender.key))}
                      aria-label={`Remove ${meta.label}`}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <div className={cn("mt-2 grid gap-2", tender.method !== "cash" && "sm:grid-cols-2")}>
                  <Input
                    inputMode="decimal"
                    value={tender.amount}
                    onChange={(e) => update(tender.key, { amount: e.target.value })}
                    placeholder="Amount"
                    className="h-11 text-lg"
                    aria-label={`${meta.label} amount`}
                    autoFocus={tender === tenders[tenders.length - 1]}
                  />
                  {tender.method !== "cash" && (
                    <Input
                      value={tender.reference}
                      onChange={(e) => update(tender.key, { reference: tender.method === "mpesa" ? e.target.value.toUpperCase().replace(/\s/g, "") : e.target.value })}
                      placeholder={tender.method === "mpesa" ? "M-Pesa code, e.g. SGK7QX2M9L" : "Approval code (optional)"}
                      maxLength={tender.method === "mpesa" ? 12 : 40}
                      className="h-11 font-mono uppercase placeholder:font-sans placeholder:normal-case"
                      aria-label={tender.method === "mpesa" ? "M-Pesa confirmation code" : "Card approval code"}
                      autoComplete="off"
                    />
                  )}
                </div>
                {chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {chips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => update(tender.key, { amount: toApiMoney(chip.amount) })}
                        className="rounded-full border bg-secondary px-3 py-1 text-xs font-medium hover:bg-accent"
                      >
                        {chip.label === "Exact" || chip.label === "Full" || chip.label === "Deposit" ? `${chip.label} ${formatMoney(chip.amount)}` : chip.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex flex-wrap gap-2">
          {METHODS.filter((m) => m.method !== "cash" || !tenders.some((t) => t.method === "cash")).map((m) => (
            <Button key={m.method} variant="outline" size="sm" onClick={() => setTenders((ts) => [...ts, newTender(m.method)])}>
              <m.icon /> Add {m.label}
            </Button>
          ))}
        </div>

        <dl className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <dt>Paying now</dt>
            <dd className="font-medium">{formatMoney(settlement.paid)}</dd>
          </div>
          {settlement.remaining > 0n && (
            <div className="flex justify-between">
              <dt>{bespoke ? "Balance on collection" : "Still to pay"}</dt>
              <dd className={cn("font-medium", !bespoke && "text-destructive")}>{formatMoney(settlement.remaining)}</dd>
            </div>
          )}
          {settlement.change > 0n && (
            <div className="flex items-baseline justify-between border-t border-border pt-1.5">
              <dt className="font-medium">Change to give</dt>
              <dd className="text-2xl font-semibold text-success">{formatMoney(settlement.change)}</dd>
            </div>
          )}
        </dl>

        {belowDeposit && role === "owner" && settlement.errors.length === 0 && (
          <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-accent-foreground">
            Below the {formatMoney(totals.deposit)} deposit. As the owner you can confirm the order anyway.
          </p>
        )}
        {blocker && tenders.some((t) => t.amount.trim()) && <p className="text-sm text-destructive">{blocker}</p>}

        {error && (
          <div role="alert" className="space-y-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p>
              {error.isNetwork
                ? "No connection, so the sale wasn't confirmed. Check the internet and press the button again. It won't be recorded twice."
                : error.message}
            </p>
            {error.code === "duplicate_reference" && role === "owner" && (
              <label className="flex items-center gap-2 text-foreground">
                <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="size-4" />
                This one M-Pesa payment covers more than one order
              </label>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
