import { useMemo, useState } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"

import { useMeasurementFields } from "@/hooks/useMeasurementFields"
import { formatDateTime } from "@/lib/format"
import { compareFittings, type ChangeKind } from "@/lib/measurements"
import type { Measurement } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useCustomerData } from "./CustomerProfile"

const ROW_STYLE: Record<ChangeKind, string> = {
  same: "",
  changed: "bg-warning/12",
  added: "bg-success/10",
  removed: "bg-muted text-muted-foreground",
}

function fittingName(m: Measurement, timeZone: string) {
  return `${m.label || "Fitting"} · ${formatDateTime(m.recorded_at, timeZone)}`
}

export function CompareFittings({ timeZone }: { timeZone: string }) {
  const { customerId = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const fields = useMeasurementFields()
  const { customer, fittings, error } = useCustomerData(customerId)
  const [onlyChanges, setOnlyChanges] = useState(false)

  // Default: the previous fitting against the latest one.
  const older = fittings?.find((f) => f.id === params.get("a")) ?? fittings?.[1]
  const newer = fittings?.find((f) => f.id === params.get("b")) ?? fittings?.[0]

  const rows = useMemo(() => (older && newer && fields ? compareFittings(older, newer, fields) : []), [older, newer, fields])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!customer || !fittings || !fields) return <div className="mx-auto h-40 max-w-4xl animate-pulse rounded-xl bg-muted" aria-busy="true" />

  const back = (
    <Link to={`/customers/${customerId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> {customer.full_name}
    </Link>
  )
  if (fittings.length < 2 || !older || !newer) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {back}
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Comparing needs at least two fittings.</p>
      </div>
    )
  }

  const changed = rows.filter((r) => r.kind !== "same").length
  const shown = onlyChanges ? rows.filter((r) => r.kind !== "same") : rows
  const select = (which: "a" | "b", id: string) => {
    const next = new URLSearchParams(params)
    next.set("a", which === "a" ? id : older.id)
    next.set("b", which === "b" ? id : newer.id)
    setParams(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {back}
      <h2 className="text-xl font-semibold">Compare fittings</h2>

      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <FittingSelect label="Before" value={older.id} fittings={fittings} timeZone={timeZone} onChange={(id) => select("a", id)} />
        <ArrowRight className="mx-auto mb-2.5 hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
        <FittingSelect label="After" value={newer.id} fittings={fittings} timeZone={timeZone} onChange={(id) => select("b", id)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="font-medium">
          {changed === 0 ? "No differences." : `${changed} ${changed === 1 ? "difference" : "differences"}`}
        </p>
        {older.unit !== newer.unit && (
          <p className="text-muted-foreground">
            Taken in different units; changes are shown in {newer.unit === "cm" ? "centimetres" : "inches"}.
          </p>
        )}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} className="size-4" />
          Only show differences
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Measurement</th>
              <th className="px-4 py-2.5 text-right font-medium">Before ({older.unit})</th>
              <th className="px-4 py-2.5 text-right font-medium">After ({newer.unit})</th>
              <th className="px-4 py-2.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className={cn("border-b last:border-0", ROW_STYLE[r.kind])}>
                <td className="px-4 py-2">
                  {r.label}
                  {r.kind === "added" && <span className="ml-2 text-xs text-success">new</span>}
                  {r.kind === "removed" && <span className="ml-2 text-xs">not measured</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.before ?? "–"}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums", r.kind === "changed" && "font-semibold")}>{r.after ?? "–"}</td>
                <td className={cn("px-4 py-2 text-right font-medium tabular-nums", r.kind === "changed" && "text-warning-foreground")}>{r.delta ?? ""}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  The two fittings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FittingSelect({ label, value, fittings, timeZone, onChange }: { label: string; value: string; fittings: Measurement[]; timeZone: string; onChange: (id: string) => void }) {
  return (
    <label className="space-y-1.5 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm font-normal outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {fittings.map((f) => (
          <option key={f.id} value={f.id}>
            {fittingName(f, timeZone)} ({f.unit})
          </option>
        ))}
      </select>
    </label>
  )
}
