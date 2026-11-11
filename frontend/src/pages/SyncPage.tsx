import { useState } from "react"
import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useOnline } from "@/hooks/useOnline"
import { useOutbox, useSyncStatus } from "@/hooks/useSync"
import { MPESA_RE } from "@/lib/checkout"
import { formatDateTime } from "@/lib/format"
import { offlineRef } from "@/lib/offline"
import { useAppDispatch, useAppSelector } from "@/store"
import { discarded, mpesaFixed, mpesaReferences, recentCleared, retryRequested, type OutboxEntry } from "@/store/outboxSlice"
import { syncNow } from "@/store/syncRunner"

/** Everything made on this device that hasn't reached the server, and what needs a person. */
export function SyncPage() {
  const shop = useAppSelector((s) => s.auth.shop)!
  const role = useAppSelector((s) => s.auth.user!.role)
  const dispatch = useAppDispatch()
  const online = useOnline()
  const status = useSyncStatus()
  const { pending, failed, recent } = useOutbox()
  const [confirm, setConfirm] = useState<OutboxEntry | null>(null)
  const tz = shop.timezone

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
        {pending.length + failed.length === 0 ? (
          <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
        ) : online ? (
          <CloudUpload className="size-8 text-primary" aria-hidden="true" />
        ) : (
          <CloudOff className="size-8 text-warning-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {pending.length + failed.length === 0
              ? "Everything is synced."
              : `${pending.length} waiting to sync${failed.length ? `, ${failed.length} need${failed.length === 1 ? "s" : ""} attention` : ""}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {status.running
              ? "Sending to the server…"
              : !online
                ? "This device is offline. Saved sales and payments will send by themselves when the internet is back."
                : status.nextTryAt
                  ? `Couldn't reach the server. Trying again at ${formatDateTime(status.nextTryAt, tz)}.`
                  : "Items on this page are stored on this device only until they sync."}
          </p>
        </div>
        <Button variant="outline" onClick={syncNow} disabled={status.running || pending.length === 0}>
          {status.running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
        </Button>
      </section>

      {failed.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive">
            <AlertTriangle className="size-5" /> Needs attention
          </h2>
          <p className="text-sm text-muted-foreground">
            The server refused these. Fix the cause (for example, a mistyped M-Pesa code) and retry, or discard them. Anything that depends on them waits too.
          </p>
          <ul className="space-y-2">
            {failed.map((e) => (
              <li key={e.id} className="rounded-lg border border-destructive/40 bg-card p-3">
                <EntryHeader entry={e} tz={tz} />
                <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{e.error?.message}</p>
                <EntryDetails entry={e} />
                <FailedActions entry={e} isOwner={role === "owner"} onDiscard={() => setConfirm(e)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Waiting to sync</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {pending.map((e) => (
              <li key={e.id} className="p-3">
                <EntryHeader entry={e} tz={tz} />
                {e.attempts > 0 && <p className="text-xs text-muted-foreground">Tried {e.attempts} {e.attempts === 1 ? "time" : "times"}; the server couldn't be reached.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recently synced</h2>
            <Button variant="ghost" size="sm" onClick={() => dispatch(recentCleared())}>
              Clear list
            </Button>
          </div>
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {recent.map((n) => (
              <li key={`${n.id}-${n.at}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{n.label}</span>
                  <span className={n.warning ? "text-warning-foreground" : "text-muted-foreground"}>
                    {n.warning && <AlertTriangle className="mr-1 inline size-3.5" />}
                    {n.message}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(n.at, tz)}</span>
                {n.orderId && (
                  <Link to={`/orders/${n.orderId}`} className="text-xs font-medium underline underline-offset-4">
                    Open order
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Discard for good?"
        description="It will never reach the server and can't be brought back."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm) dispatch(discarded(confirm.id))
                setConfirm(null)
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{confirm.label}</p>
            {confirm.kind !== "customer" && (
              <p className="rounded-md bg-warning/15 px-3 py-2 text-warning-foreground">
                If the customer already paid this money, record it again on the right order or give it back, so the cash drawer still balances.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}

function FailedActions({ entry, isOwner, onDiscard }: { entry: OutboxEntry; isOwner: boolean; onDiscard: () => void }) {
  const dispatch = useAppDispatch()
  const original = mpesaReferences(entry)
  const [codes, setCodes] = useState(original)
  const [shared, setShared] = useState(false)
  const mpesaProblem = entry.error?.code === "duplicate_reference" || entry.error?.code === "invalid_mpesa_reference"
  const valid = codes.every((c) => MPESA_RE.test(c))

  function retry() {
    if (mpesaProblem && original.length) dispatch(mpesaFixed({ id: entry.id, references: codes, allowDuplicate: shared }))
    dispatch(retryRequested(entry.id))
    syncNow()
  }

  return (
    <div className="mt-3 space-y-3">
      {mpesaProblem && original.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Check the M-Pesa code against the customer's SMS</p>
          {codes.map((code, i) => (
            <Input
              key={i}
              value={code}
              onChange={(ev) => setCodes((cs) => cs.map((c, j) => (j === i ? ev.target.value.toUpperCase().replace(/\s/g, "") : c)))}
              maxLength={12}
              className="font-mono"
              aria-label={`M-Pesa code ${i + 1}`}
              aria-invalid={!MPESA_RE.test(code)}
            />
          ))}
          {isOwner && entry.error?.code === "duplicate_reference" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shared} onChange={(ev) => setShared(ev.target.checked)} className="size-4" />
              It's correct: one M-Pesa payment covered more than one order
            </label>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={retry} disabled={mpesaProblem && original.length > 0 && !valid}>
          <RefreshCw /> Retry
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDiscard}>
          <Trash2 /> Discard
        </Button>
      </div>
    </div>
  )
}

function EntryHeader({ entry, tz }: { entry: OutboxEntry; tz: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium">{entry.label}</span>
      <span className="text-xs text-muted-foreground">
        {formatDateTime(entry.createdAt, tz)} · {entry.createdBy}
        {entry.kind === "order" && ` · ref ${offlineRef(entry.id)}`}
      </span>
    </div>
  )
}

function EntryDetails({ entry }: { entry: OutboxEntry }) {
  if (entry.kind !== "order") return null
  const items = (entry.body.items as { description: string; quantity: string }[] | undefined) ?? []
  const payments = (entry.body.payments as { method: string; amount: string; reference: string | null }[] | undefined) ?? []
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <p>{items.map((i) => `${i.quantity} × ${i.description}`).join(", ")}</p>
      {payments.length > 0 && <p>Paid: {payments.map((p) => `${p.method} ${p.amount}${p.reference ? ` (${p.reference})` : ""}`).join(", ")}</p>}
    </div>
  )
}
