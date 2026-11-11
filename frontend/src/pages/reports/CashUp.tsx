import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Printer, RefreshCw } from "lucide-react"
import { Link } from "react-router-dom"

import { PrintRoot } from "@/components/Receipt"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePrint } from "@/hooks/usePrint"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatDateTime, METHOD_LABEL, todayIn } from "@/lib/format"
import { cents, formatMoney, parseMoney } from "@/lib/money"
import type { DailyReport, Shop } from "@/lib/types"
import { cn } from "@/lib/utils"

function shiftDay(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

/** End-of-day: what came in by method, the cash drawer check, and every payment to tick off. */
export function CashUp({ shop }: { shop: Shop }) {
  const today = todayIn(shop.timezone)
  const [day, setDay] = useState(today)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [float, setFloat] = useState("")
  const [counted, setCounted] = useState("")
  const [method, setMethod] = useState<string>("")
  const [printing, setPrinting] = usePrint<"cashup">()

  useEffect(() => {
    const controller = new AbortController()
    setReport(null)
    setError(null)
    api
      .get<DailyReport>(`/reports/daily?date=${day}`, { signal: controller.signal })
      .then(setReport)
      .catch((err) => !controller.signal.aborted && setError(errorMessage(err)))
    return () => controller.abort()
  }, [day, reloadKey])

  const cashNet = report ? cents(report.by_method.find((m) => m.method === "cash")?.net ?? "0") : 0n
  const floatValue = parseMoney(float) ?? 0n
  const expected = floatValue + cashNet
  const countedValue = counted.trim() ? parseMoney(counted) : null
  const difference = countedValue === null ? null : countedValue - expected
  const payments = (report?.payments ?? []).filter((p) => !method || p.method === method)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-1">
          <Button variant="outline" size="icon" onClick={() => setDay((d) => shiftDay(d, -1))} aria-label="Previous day">
            <ChevronLeft />
          </Button>
          <div className="space-y-1">
            <Label htmlFor="cashup-day">Day</Label>
            <Input id="cashup-day" type="date" max={today} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" size="icon" onClick={() => setDay((d) => shiftDay(d, 1))} disabled={day >= today} aria-label="Next day">
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => setPrinting("cashup")} disabled={!report}>
          <Printer /> Print cash-up
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : !report ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" aria-busy="true" />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="overflow-hidden rounded-xl border bg-card">
              <h3 className="border-b px-4 py-3 font-semibold">Takings for {formatDate(report.date)}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Method</th>
                    <th className="px-4 py-2 text-right font-medium">Payments</th>
                    <th className="px-4 py-2 text-right font-medium">Received</th>
                    <th className="px-4 py-2 text-right font-medium">Refunded</th>
                    <th className="px-4 py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_method.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-muted-foreground">
                        No payments on this day.
                      </td>
                    </tr>
                  )}
                  {report.by_method.map((m) => (
                    <tr key={m.method} className="border-b">
                      <td className="px-4 py-2">{METHOD_LABEL[m.method]}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.count}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(m.received)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{cents(m.refunded) > 0n ? `-${formatMoney(m.refunded)}` : ""}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="px-4 py-2.5" colSpan={2}>
                      Total
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(report.total_received)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{cents(report.total_refunded) > 0n ? `-${formatMoney(report.total_refunded)}` : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(report.net_takings)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                {report.orders_created} {report.orders_created === 1 ? "sale or order" : "sales and orders"} worth {formatMoney(report.sales_value)} made on this day. Deposits and balances count on the day they were paid.
              </p>
            </section>

            <section className="space-y-3 rounded-xl border bg-card p-4">
              <h3 className="font-semibold">Cash drawer</h3>
              <div className="space-y-1.5">
                <Label htmlFor="float">Float at the start of the day</Label>
                <Input id="float" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" />
              </div>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Cash taken (net)</dt>
                  <dd className="tabular-nums">{formatMoney(cashNet)}</dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>Should be in the drawer</dt>
                  <dd className="tabular-nums">{formatMoney(expected)}</dd>
                </div>
              </dl>
              <div className="space-y-1.5">
                <Label htmlFor="counted">Counted in the drawer</Label>
                <Input id="counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Count the notes and coins" />
              </div>
              {difference !== null && (
                <p
                  role="status"
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium",
                    difference === 0n ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                  )}
                >
                  {difference === 0n ? "The drawer balances." : difference > 0n ? `Over by ${formatMoney(difference)}` : `Short by ${formatMoney(-difference)}`}
                </p>
              )}
              {counted.trim() && countedValue === null && <p className="text-sm text-destructive">Enter the counted amount, e.g. 12500.</p>}
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <h3 className="font-semibold">Every payment</h3>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="ml-auto h-9 rounded-md border border-input bg-card px-2 text-sm" aria-label="Show method">
                <option value="">All methods</option>
                {report.by_method.map((m) => (
                  <option key={m.method} value={m.method}>
                    {METHOD_LABEL[m.method]} only
                  </option>
                ))}
              </select>
            </div>
            {payments.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">None.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Order</th>
                      <th className="px-4 py-2 font-medium">Method</th>
                      <th className="px-4 py-2 font-medium">Reference</th>
                      <th className="px-4 py-2 font-medium">Taken by</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="px-4 py-2 text-muted-foreground tabular-nums">{formatDateTime(p.created_at, shop.timezone).split(", ").pop()}</td>
                        <td className="px-4 py-2">
                          <Link to={`/orders/${p.order_id}`} className="underline-offset-4 hover:underline">
                            #{p.order_number}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          {p.kind === "refund" ? "Refund · " : ""}
                          {METHOD_LABEL[p.method]}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{p.reference ?? ""}</td>
                        <td className="px-4 py-2 text-muted-foreground">{p.received_by ?? ""}</td>
                        <td className={cn("px-4 py-2 text-right tabular-nums", p.kind === "refund" && "text-destructive")}>{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {printing === "cashup" && report && (
        <PrintRoot>
          <div className="receipt mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
            <p className="text-center font-bold">{shop.name}</p>
            <p className="text-center">CASH-UP {formatDate(report.date)}</p>
            <hr className="my-2 border-dashed border-black" />
            {report.by_method.map((m) => (
              <div key={m.method} className="flex justify-between">
                <span>
                  {METHOD_LABEL[m.method]} ({m.count})
                </span>
                <span>{formatMoney(m.net)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold">
              <span>NET TAKINGS</span>
              <span>{formatMoney(report.net_takings)}</span>
            </div>
            <hr className="my-2 border-dashed border-black" />
            <div className="flex justify-between">
              <span>Float</span>
              <span>{formatMoney(floatValue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Expected cash</span>
              <span>{formatMoney(expected)}</span>
            </div>
            {countedValue !== null && (
              <>
                <div className="flex justify-between">
                  <span>Counted</span>
                  <span>{formatMoney(countedValue)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>{difference === 0n ? "Balanced" : difference! > 0n ? "Over" : "Short"}</span>
                  <span>{formatMoney(difference! < 0n ? -difference! : difference!)}</span>
                </div>
              </>
            )}
            <p className="mt-4">Counted by: ____________</p>
          </div>
        </PrintRoot>
      )}
    </div>
  )
}
