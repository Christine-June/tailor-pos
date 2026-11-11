import { useState, type FormEvent, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, errorMessage } from "@/lib/api"
import { trimZeros } from "@/lib/format"
import { parseMoney } from "@/lib/money"
import type { Shop } from "@/lib/types"
import { sessionUpdated } from "@/store/authSlice"
import { useAppDispatch, useAppSelector } from "@/store"

const TIMEZONES = ["Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam", "Africa/Kigali", "Africa/Addis_Ababa", "Africa/Lagos", "Africa/Johannesburg", "UTC"]

type Form = {
  name: string
  address: string
  phone: string
  email: string
  kra_pin: string
  receipt_footer: string
  timezone: string
  vat_registered: boolean
  vat_rate: string
  min_deposit_pct: string
  measurement_unit: "in" | "cm"
}

function formFrom(shop: Shop): Form {
  return {
    name: shop.name,
    address: shop.address ?? "",
    phone: shop.phone ?? "",
    email: shop.email ?? "",
    kra_pin: shop.kra_pin ?? "",
    receipt_footer: shop.receipt_footer ?? "",
    timezone: shop.timezone,
    vat_registered: shop.vat_registered,
    vat_rate: trimZeros(shop.vat_rate),
    min_deposit_pct: trimZeros(shop.min_deposit_pct),
    measurement_unit: shop.measurement_unit,
  }
}

/** Only the fields that changed, in the shape the API takes. Returns an error for bad numbers. */
export function shopPatch(shop: Shop, form: Form): { body: Record<string, unknown> } | { error: string } {
  if (!form.name.trim()) return { error: "The shop needs a name." }
  for (const [label, value] of [
    ["VAT rate", form.vat_rate],
    ["Minimum deposit", form.min_deposit_pct],
  ] as const) {
    const parsed = parseMoney(value)
    if (parsed === null || parsed > 10000n) return { error: `${label} must be a percentage from 0 to 100.` }
  }
  const original = formFrom(shop)
  const body: Record<string, unknown> = {}
  for (const key of Object.keys(form) as (keyof Form)[]) {
    if (form[key] === original[key]) continue
    const value = form[key]
    body[key] = typeof value === "string" ? value.trim() || (["name", "timezone", "vat_rate", "min_deposit_pct", "measurement_unit"].includes(key) ? value : null) : value
  }
  return { body }
}

export function ShopSettings() {
  const shop = useAppSelector((s) => s.auth.shop)!
  const user = useAppSelector((s) => s.auth.user)!
  const dispatch = useAppDispatch()
  const [form, setForm] = useState<Form>(() => formFrom(shop))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const set = (changes: Partial<Form>) => {
    setForm((f) => ({ ...f, ...changes }))
    setMessage(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const built = shopPatch(shop, form)
    if ("error" in built) {
      setMessage({ text: built.error, ok: false })
      return
    }
    if (Object.keys(built.body).length === 0) {
      setMessage({ text: "Nothing changed.", ok: true })
      return
    }
    setBusy(true)
    try {
      const saved = await api.patch<Shop>("/settings/shop", built.body)
      dispatch(sessionUpdated({ user, shop: saved }))
      setForm(formFrom(saved))
      setMessage({ text: "Saved. Receipts and new orders use these settings from now on.", ok: true })
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <Section title="Shop details" hint="Printed at the top of every receipt.">
        <Field id="s-name" label="Shop name">
          <Input id="s-name" maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field id="s-address" label="Address">
          <Input id="s-address" maxLength={200} value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="e.g. Kimathi Street, Nairobi" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="s-phone" label="Phone">
            <Input id="s-phone" maxLength={30} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field id="s-email" label="Email">
            <Input id="s-email" type="email" maxLength={120} value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field id="s-pin" label="KRA PIN">
            <Input id="s-pin" maxLength={20} value={form.kra_pin} onChange={(e) => set({ kra_pin: e.target.value.toUpperCase() })} placeholder="e.g. P051234567X" />
          </Field>
        </div>
        <Field id="s-footer" label="Receipt footer">
          <Input id="s-footer" maxLength={300} value={form.receipt_footer} onChange={(e) => set({ receipt_footer: e.target.value })} placeholder="e.g. Thank you. Bring this receipt when collecting." />
        </Field>
      </Section>

      <Section title="Money and orders">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.vat_registered} onChange={(e) => set({ vat_registered: e.target.checked })} className="size-4" />
          The shop is registered for VAT (prices already include it)
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          {form.vat_registered && (
            <Field id="s-vat" label="VAT rate (%)">
              <Input id="s-vat" inputMode="decimal" value={form.vat_rate} onChange={(e) => set({ vat_rate: e.target.value })} />
            </Field>
          )}
          <Field id="s-deposit" label="Minimum deposit on orders (%)" hint="Cashiers can't confirm an order below this. You can.">
            <Input id="s-deposit" inputMode="decimal" value={form.min_deposit_pct} onChange={(e) => set({ min_deposit_pct: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Workshop and time">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-unit" label="New fittings measured in">
            <select id="s-unit" value={form.measurement_unit} onChange={(e) => set({ measurement_unit: e.target.value as "in" | "cm" })} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              <option value="in">Inches</option>
              <option value="cm">Centimetres</option>
            </select>
          </Field>
          <Field id="s-tz" label="Time zone" hint="Decides when a day starts for the cash-up.">
            <select id="s-tz" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm">
              {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {message && (
          <p role="status" className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
            {message.text}
          </p>
        )}
        <Button type="submit" className="ml-auto" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  )
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
