import { useEffect, useState } from "react"
import { Archive, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, errorMessage } from "@/lib/api"
import { formatDateTime, trimZeros } from "@/lib/format"
import { formatQuantity } from "@/lib/money"
import { buildAdjustment, buildItemBody, KIND_LABEL, MANUAL_REASONS, REASON_LABEL, type ItemDraft } from "@/lib/stock"
import type { InventoryItem, ItemKind, MovementReason, Page, StockMovement } from "@/lib/types"
import { cn } from "@/lib/utils"
import { uuid } from "@/lib/uuid"

const selectClass = "h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
const DEFAULT_UNIT: Record<ItemKind, string> = { fabric: "m", trim: "pcs", retail: "pcs", service: "job" }

function draftFrom(item: InventoryItem | null): ItemDraft {
  return {
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    kind: item?.kind ?? "fabric",
    category: item?.category ?? "",
    unit: item?.unit ?? "m",
    sellPrice: item ? trimZeros(item.sell_price) : "",
    costPrice: item?.cost_price ? trimZeros(item.cost_price) : "",
    trackStock: item?.track_stock ?? true,
    openingQuantity: "",
    reorderLevel: item ? trimZeros(item.reorder_level) : "",
  }
}

/** Owner only: add a catalogue item or change one. Stock levels change through adjustments. */
export function ItemDialog({
  open,
  item,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean
  item: InventoryItem | null
  categories: string[]
  onClose: () => void
  onSaved: (item: InventoryItem, message: string) => void
}) {
  const [draft, setDraft] = useState<ItemDraft>(draftFrom(null))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newId, setNewId] = useState(uuid)
  const creating = !item

  useEffect(() => {
    if (!open) return
    setDraft(draftFrom(item))
    setError(null)
    setBusy(false)
    setNewId(uuid())
  }, [open, item])

  const set = (changes: Partial<ItemDraft>) => {
    setDraft((d) => ({ ...d, ...changes }))
    setError(null)
  }

  async function save() {
    const built = buildItemBody(draft, creating)
    if ("error" in built) {
      setError(built.error)
      return
    }
    setBusy(true)
    try {
      const saved = creating
        ? await api.post<InventoryItem>("/inventory", { id: newId, ...built.body })
        : await api.patch<InventoryItem>(`/inventory/${item!.id}`, built.body)
      onSaved(saved, creating ? `${saved.name} added.` : `${saved.name} updated.`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function toggleArchive() {
    if (!item) return
    setBusy(true)
    try {
      const saved = await api.patch<InventoryItem>(`/inventory/${item.id}`, { archived: !item.archived })
      onSaved(saved, saved.archived ? `${saved.name} is no longer sold. Past sales keep it.` : `${saved.name} is back on sale.`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={creating ? "New item" : `Edit ${item!.name}`}
      className="sm:max-w-lg"
      footer={
        <>
          {!creating && (
            <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={() => void toggleArchive()} disabled={busy}>
              <Archive /> {item!.archived ? "Sell again" : "Stop selling"}
            </Button>
          )}
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {creating ? "Add item" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="item-name">Name</Label>
          <Input id="item-name" autoFocus maxLength={120} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Italian wool suiting" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="item-kind">Type</Label>
            <select
              id="item-kind"
              className={selectClass}
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as ItemKind
                set({ kind, unit: creating ? DEFAULT_UNIT[kind] : draft.unit, trackStock: kind !== "service" })
              }}
            >
              {(Object.keys(KIND_LABEL) as ItemKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-category">Category</Label>
            <Input id="item-category" list="item-categories" maxLength={60} value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Fabric" />
            <datalist id="item-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="item-unit">Unit</Label>
            <Input id="item-unit" maxLength={10} value={draft.unit} onChange={(e) => set({ unit: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-price">Price (KES)</Label>
            <Input id="item-price" inputMode="decimal" value={draft.sellPrice} onChange={(e) => set({ sellPrice: e.target.value })} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-cost">Cost (KES)</Label>
            <Input id="item-cost" inputMode="decimal" value={draft.costPrice} onChange={(e) => set({ costPrice: e.target.value })} placeholder="0" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="item-sku">SKU (optional)</Label>
            <Input id="item-sku" maxLength={40} value={draft.sku} onChange={(e) => set({ sku: e.target.value })} />
          </div>
          {draft.kind !== "service" && (
            <div className="space-y-1.5">
              <Label htmlFor="item-reorder">Warn when stock falls to</Label>
              <Input id="item-reorder" inputMode="decimal" value={draft.reorderLevel} onChange={(e) => set({ reorderLevel: e.target.value })} placeholder="0" />
            </div>
          )}
        </div>
        {draft.kind !== "service" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.trackStock} onChange={(e) => set({ trackStock: e.target.checked })} className="size-4" />
            Track how much is in stock
          </label>
        )}
        {creating && draft.kind !== "service" && draft.trackStock && (
          <div className="space-y-1.5">
            <Label htmlFor="item-opening">In stock now ({draft.unit || "units"})</Label>
            <Input id="item-opening" inputMode="decimal" value={draft.openingQuantity} onChange={(e) => set({ openingQuantity: e.target.value })} placeholder="0" />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** Receive stock, record damage, or set the shelf count. Every change is kept in the history. */
export function AdjustDialog({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: (item: InventoryItem, message: string) => void }) {
  const [reason, setReason] = useState<MovementReason>("purchase")
  const [amount, setAmount] = useState("")
  const [sign, setSign] = useState<"add" | "remove">("add")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setReason("purchase")
    setAmount("")
    setSign("add")
    setNote("")
    setError(null)
    setBusy(false)
  }, [item])

  if (!item) return null
  const spec = MANUAL_REASONS.find((r) => r.reason === reason)!
  const preview = amount.trim() ? buildAdjustment({ reason, amount, sign }, item.quantity_on_hand) : null

  async function save() {
    const built = buildAdjustment({ reason, amount, sign }, item!.quantity_on_hand)
    if ("error" in built) {
      setError(built.error)
      return
    }
    setBusy(true)
    try {
      const saved = await api.post<InventoryItem>(`/inventory/${item!.id}/adjust`, { ...built.body, note: note.trim() || null })
      onSaved(saved, `${saved.name}: now ${trimZeros(saved.quantity_on_hand)} ${saved.unit}.`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Update stock: ${item.name}`}
      description={`In stock now: ${trimZeros(item.quantity_on_hand)} ${item.unit}`}
      footer={
        <Button className="w-full" onClick={() => void save()} disabled={busy || !amount.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          Save
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        noValidate
      >
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">What happened?</legend>
          {MANUAL_REASONS.map((r) => (
            <label
              key={r.reason}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", reason === r.reason && "border-primary bg-primary/5")}
            >
              <input type="radio" name="reason" checked={reason === r.reason} onChange={() => setReason(r.reason)} className="size-4" />
              {r.label}
            </label>
          ))}
        </fieldset>
        {spec.direction === "either" && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Add or remove">
            {(["add", "remove"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sign === s}
                onClick={() => setSign(s)}
                className={cn("rounded-md py-1.5 text-sm font-medium", sign === s ? "bg-card shadow-xs" : "text-muted-foreground")}
              >
                {s === "add" ? "Add" : "Remove"}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="adj-amount">
            {spec.direction === "count" ? `How much is on the shelf? (${item.unit})` : `How much? (${item.unit})`}
          </Label>
          <Input id="adj-amount" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} className="h-11 text-lg" />
          {preview && ("error" in preview ? (
            <p className="text-sm text-destructive">{preview.error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Stock will be {formatQuantity(preview.after < 0n ? -preview.after : preview.after) || "0"} {item.unit}
            </p>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adj-note">Note (optional)</Label>
          <Input id="adj-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "purchase" ? "e.g. Supplier invoice 4471" : "e.g. Water damage"} />
        </div>
        {error && !preview && <p className="text-sm text-destructive">{error}</p>}
        {error && preview && !("error" in preview) && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function MovementsDialog({ item, timeZone, onClose }: { item: InventoryItem | null; timeZone: string; onClose: () => void }) {
  const [rows, setRows] = useState<StockMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!item) return
    const controller = new AbortController()
    setRows(null)
    setError(null)
    api
      .get<Page<StockMovement>>(`/inventory/${item.id}/movements?limit=200`, { signal: controller.signal })
      .then((p) => setRows(p.items))
      .catch((err) => !controller.signal.aborted && setError(errorMessage(err)))
    return () => controller.abort()
  }, [item])

  if (!item) return null
  return (
    <Dialog open onClose={onClose} title={`History: ${item.name}`} description={`In stock now: ${trimZeros(item.quantity_on_hand)} ${item.unit}`} className="sm:max-w-lg">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stock changes yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-medium">When</th>
              <th className="py-2 font-medium">What</th>
              <th className="py-2 text-right font-medium">Change</th>
              <th className="py-2 text-right font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const out = m.quantity_delta.startsWith("-")
              return (
                <tr key={m.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-2 text-xs text-muted-foreground">
                    {formatDateTime(m.created_at, timeZone)}
                    {m.user && <span className="block">{m.user}</span>}
                  </td>
                  <td className="py-2 pr-2">
                    {REASON_LABEL[m.reason]}
                    {m.note && <span className="block text-xs text-muted-foreground">{m.note}</span>}
                  </td>
                  <td className={cn("py-2 text-right tabular-nums", out ? "text-destructive" : "text-success")}>
                    {out ? "" : "+"}
                    {trimZeros(m.quantity_delta)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{trimZeros(m.balance_after)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Dialog>
  )
}
