import { useState } from "react"
import { CheckCircle2, Loader2, Printer, ReceiptText } from "lucide-react"

import { PrintableReceipt, Receipt } from "@/components/Receipt"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { api, errorMessage } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { cents, formatMoney } from "@/lib/money"
import type { Order, Shop } from "@/lib/types"

type PrintState = { status: "idle" | "sending" } | { status: "done"; message: string } | { status: "error"; message: string }

export function SaleCompleteDialog({ order, change, shop, onClose }: { order: Order | null; change: bigint; shop: Shop; onClose: () => void }) {
  const [print, setPrint] = useState<PrintState>({ status: "idle" })
  const [showReceipt, setShowReceipt] = useState(false)
  if (!order) return null

  const balance = cents(order.balance)
  const bespoke = order.kind === "bespoke"

  async function thermalPrint() {
    if (!order) return
    setPrint({ status: "sending" })
    try {
      const res = await api.post<{ status: "queued" | "printed" }>(`/print/orders/${order.id}/receipt`)
      setPrint({ status: "done", message: res.status === "queued" ? "Sent to the shop printer." : "Printed." })
    } catch (err) {
      setPrint({ status: "error", message: errorMessage(err) })
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={bespoke ? `Order #${order.number} confirmed` : `Sale #${order.number} complete`}
      description={order.customer ? order.customer.full_name : "Walk-in customer"}
      footer={
        <Button size="lg" className="w-full" onClick={onClose} autoFocus>
          New sale
        </Button>
      }
    >
      <PrintableReceipt order={order} shop={shop} />
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
          {change > 0n ? (
            <>
              <p className="text-sm text-muted-foreground">Change to give</p>
              <p className="text-4xl font-bold text-success">{formatMoney(change)}</p>
            </>
          ) : (
            <p className="text-lg font-medium">{formatMoney(order.amount_paid)} received</p>
          )}
        </div>

        {bespoke && (
          <dl className="space-y-1 rounded-lg bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <dt>Paid so far</dt>
              <dd>{formatMoney(order.amount_paid)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Balance on collection</dt>
              <dd>{formatMoney(balance)}</dd>
            </div>
            {order.due_date && (
              <div className="flex justify-between">
                <dt>Collection</dt>
                <dd>{formatDate(order.due_date)}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => window.print()}>
            <ReceiptText /> Print receipt
          </Button>
          {shop.printer_mode !== "none" ? (
            <Button variant="outline" onClick={() => void thermalPrint()} disabled={print.status === "sending"}>
              {print.status === "sending" ? <Loader2 className="animate-spin" /> : <Printer />} Thermal printer
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setShowReceipt((v) => !v)}>
              {showReceipt ? "Hide receipt" : "View receipt"}
            </Button>
          )}
        </div>
        {(print.status === "done" || print.status === "error") && (
          <p role="status" className={print.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
            {print.message}
          </p>
        )}
        {shop.printer_mode !== "none" && (
          <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => setShowReceipt((v) => !v)}>
            {showReceipt ? "Hide receipt" : "View receipt"}
          </button>
        )}
        {showReceipt && (
          <div className="rounded-lg border bg-white">
            <Receipt order={order} shop={shop} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
