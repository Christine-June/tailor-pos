import { useMemo, useState, type FormEvent } from "react"
import { ArrowLeft, Copy, Loader2, Plus, X } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMeasurementFields } from "@/hooks/useMeasurementFields"
import { api, errorMessage } from "@/lib/api"
import { formatDay } from "@/lib/format"
import { convert, formatMeasure, humanize, parseMeasure, slugify, validateFitting, type Unit } from "@/lib/measurements"
import type { Measurement } from "@/lib/types"
import { cn } from "@/lib/utils"
import { uuid } from "@/lib/uuid"
import { useCustomerData } from "./CustomerProfile"

interface CustomRow {
  id: string
  label: string
  value: string
}

export function FittingForm({ defaultUnit, timeZone }: { defaultUnit: Unit; timeZone: string }) {
  const { customerId = "" } = useParams()
  const navigate = useNavigate()
  const fields = useMeasurementFields()
  const { customer, fittings, error: loadError } = useCustomerData(customerId)

  const [unit, setUnit] = useState<Unit>(defaultUnit)
  const [values, setValues] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<CustomRow[]>([])
  const [label, setLabel] = useState("")
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // One id per form: a double tap or a retry saves one fitting, not two.
  const [fittingId] = useState(uuid)

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string }[]>()
    for (const f of fields ?? []) {
      if (!map.has(f.group)) map.set(f.group, [])
      map.get(f.group)!.push(f)
    }
    return [...map.entries()]
  }, [fields])

  const latest = fittings?.[0]

  function setValue(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => {
      const { [key]: _removed, ...rest } = e
      return rest
    })
  }

  function convertAll(from: Unit, to: Unit, source: Record<string, string>) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(source)) {
      const parsed = parseMeasure(v)
      out[k] = parsed === null ? v : formatMeasure(convert(parsed, from, to))
    }
    return out
  }

  function switchUnit(next: Unit) {
    if (next === unit) return
    const filled = Object.values(values).some((v) => v.trim()) || custom.some((c) => c.value.trim())
    if (filled) {
      setValues(convertAll(unit, next, values))
      setCustom((rows) => rows.map((r) => ({ ...r, value: convertAll(unit, next, { x: r.value }).x! })))
      setNotice(`Converted the numbers to ${next === "cm" ? "centimetres" : "inches"}.`)
    }
    setUnit(next)
  }

  function copyFrom(fitting: Measurement) {
    const standard: Record<string, string> = {}
    const extra: CustomRow[] = []
    for (const [k, v] of Object.entries(fitting.values)) {
      const shown = formatMeasure(parseMeasure(v) ?? 0n)
      if (fields?.some((f) => f.key === k)) standard[k] = shown
      else extra.push({ id: uuid(), label: humanize(k), value: shown })
    }
    setUnit(fitting.unit)
    setValues(standard)
    setCustom(extra)
    setErrors({})
    setNotice(`Copied from ${fitting.label || "the fitting"} on ${formatDay(fitting.recorded_at, timeZone)}. Change only what's different.`)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const entries: Record<string, string> = { ...values }
    const keyErrors: Record<string, string> = {}
    for (const row of custom) {
      if (!row.label.trim() && !row.value.trim()) continue
      const key = slugify(row.label)
      if (!key) keyErrors[row.id] = "Give this measurement a name."
      else if (fields?.some((f) => f.key === key)) keyErrors[row.id] = "That's already in the list above."
      else if (key in entries) keyErrors[row.id] = "This name is used twice."
      else if (!row.value.trim()) keyErrors[row.id] = "Enter a value."
      else entries[key] = row.value
    }
    const result = validateFitting(entries)
    // Map custom-field errors back onto their rows.
    for (const row of custom) {
      const key = slugify(row.label)
      if (key && result.errors[key]) keyErrors[row.id] = result.errors[key]!
    }
    const allErrors = { ...result.errors, ...keyErrors }
    setErrors(allErrors)
    if (Object.keys(allErrors).length) {
      setFormError("Check the highlighted measurements.")
      return
    }
    if (result.empty) {
      setFormError("Enter at least one measurement.")
      return
    }
    setBusy(true)
    try {
      const saved = await api.post<Measurement>(`/customers/${customerId}/measurements`, {
        id: fittingId,
        unit,
        values: result.values,
        label: label.trim() || null,
        notes: notes.trim() || null,
      })
      navigate(`/customers/${customerId}?new=${saved.id}`, { replace: true })
    } catch (err) {
      setFormError(errorMessage(err))
      setBusy(false)
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!customer || !fields || !fittings) return <div className="mx-auto h-40 max-w-4xl animate-pulse rounded-xl bg-muted" aria-busy="true" />

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-5 pb-24" noValidate>
      <Link to={`/customers/${customerId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {customer.full_name}
      </Link>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <h2 className="text-xl font-semibold">New fitting</h2>
          <p className="text-sm text-muted-foreground">Fill in what you measured; leave the rest blank. Saved fittings can't be edited, so past orders keep their numbers.</p>
        </div>
        <div className="grid grid-cols-2 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Unit">
          {(["in", "cm"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => switchUnit(u)}
              className={cn("rounded-md px-4 py-1.5 text-sm font-medium", unit === u ? "bg-card shadow-xs" : "text-muted-foreground")}
            >
              {u === "in" ? "Inches" : "Centimetres"}
            </button>
          ))}
        </div>
      </div>

      {latest && (
        <Button type="button" variant="outline" onClick={() => copyFrom(latest)}>
          <Copy /> Start from the last fitting ({formatDay(latest.recorded_at, timeZone)})
        </Button>
      )}
      {notice && <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground" role="status">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="f-label">Name (optional)</Label>
          <Input id="f-label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Wedding suit, second fitting" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-notes">Notes (optional)</Label>
          <Input id="f-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Left shoulder slightly lower" />
        </div>
      </div>

      {groups.map(([group, groupFields]) => (
        <fieldset key={group} className="rounded-xl border bg-card p-4">
          <legend className="px-1 text-sm font-semibold">{group}</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {groupFields.map((f) => (
              <MeasureInput key={f.key} id={`m-${f.key}`} label={f.label} unit={unit} value={values[f.key] ?? ""} error={errors[f.key]} onChange={(v) => setValue(f.key, v)} />
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="rounded-xl border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">Other measurements</legend>
        <p className="mb-3 text-sm text-muted-foreground">Anything not listed above, e.g. cuff, agbada sleeve width, cap size.</p>
        <div className="space-y-2">
          {custom.map((row) => (
            <div key={row.id}>
              <div className="flex items-center gap-2">
                <Input
                  value={row.label}
                  onChange={(e) => setCustom((rows) => rows.map((r) => (r.id === row.id ? { ...r, label: e.target.value } : r)))}
                  placeholder="Name"
                  maxLength={40}
                  className="flex-1"
                  aria-label="Measurement name"
                  aria-invalid={!!errors[row.id]}
                />
                <div className="relative w-28">
                  <Input
                    inputMode="decimal"
                    value={row.value}
                    onChange={(e) => setCustom((rows) => rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
                    placeholder="0"
                    className="pr-9 text-right"
                    aria-label={`${row.label || "Custom measurement"} value`}
                    aria-invalid={!!errors[row.id]}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => setCustom((rows) => rows.filter((r) => r.id !== row.id))} aria-label="Remove">
                  <X />
                </Button>
              </div>
              {errors[row.id] && <p className="mt-1 text-xs text-destructive">{errors[row.id]}</p>}
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setCustom((rows) => [...rows, { id: uuid(), label: "", value: "" }])}>
          <Plus /> Add a measurement
        </Button>
      </fieldset>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="button" variant="outline" className="ml-auto" asChild>
          <Link to={`/customers/${customerId}`}>Cancel</Link>
        </Button>
        <Button type="submit" size="lg" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save fitting
        </Button>
      </div>
    </form>
  )
}

function MeasureInput({ id, label, unit, value, error, onChange }: { id: string; label: string; unit: Unit; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 pr-9 text-right tabular-nums" aria-invalid={!!error} title={error} />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
