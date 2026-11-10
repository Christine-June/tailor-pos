import { useEffect, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney, formatQuantity, lineTotal, parseMoney, parseQuantity } from "@/lib/money"
import type { InventoryItem } from "@/lib/types"

const QUICK_LENGTHS = ["0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5"]

/** Asks how much cloth to cut before adding fabric to the cart. */
export function QuantityDialog({
  item,
  onClose,
  onAdd,
}: {
  item: InventoryItem | null
  onClose: () => void
  onAdd: (item: InventoryItem, quantity: string) => void
}) {
  const [value, setValue] = useState("")
  useEffect(() => setValue(""), [item])

  if (!item) return null
  const qty = parseQuantity(value)
  const price = parseMoney(item.sell_price) ?? 0n
  const available = item.track_stock ? (parseQuantity(item.quantity_on_hand) ?? 0n) : null
  const tooMuch = qty !== null && available !== null && qty > available

  function submit(event: FormEvent) {
    event.preventDefault()
    if (qty !== null && !tooMuch && item) onAdd(item, formatQuantity(qty))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={item.name}
      description={`${formatMoney(item.sell_price)} per ${item.unit}${available !== null ? ` · ${formatQuantity(available)} ${item.unit} in stock` : ""}`}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="qty">How many {item.unit}?</Label>
          <Input
            id="qty"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(",", "."))}
            placeholder="e.g. 2.75"
            className="h-12 text-lg"
            aria-invalid={tooMuch || (value !== "" && qty === null)}
          />
        </div>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
          {QUICK_LENGTHS.map((q) => (
            <Button key={q} type="button" variant={value === q ? "default" : "outline"} className="px-0" onClick={() => setValue(q)}>
              {q}
            </Button>
          ))}
        </div>
        <p className="min-h-5 text-sm" role="status">
          {tooMuch ? (
            <span className="text-destructive">Only {formatQuantity(available!)} {item.unit} in stock.</span>
          ) : value !== "" && qty === null ? (
            <span className="text-destructive">Enter a number with up to 3 decimals.</span>
          ) : qty !== null ? (
            <span className="text-muted-foreground">Line total {formatMoney(lineTotal(qty, price))}</span>
          ) : null}
        </p>
        <Button type="submit" size="lg" className="w-full" disabled={qty === null || tooMuch}>
          Add to cart
        </Button>
      </form>
    </Dialog>
  )
}

/** A line that isn't in the catalogue: the customer's own fabric, a one-off repair, a design fee. */
export function CustomLineDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (line: { description: string; quantity: string; unitPrice: string; notes: string }) => void
}) {
  const [description, setDescription] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [price, setPrice] = useState("")
  const [notes, setNotes] = useState("")
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setDescription("")
      setQuantity("1")
      setPrice("")
      setNotes("")
      setTouched(false)
    }
  }, [open])

  const qty = parseQuantity(quantity)
  const unitPrice = parseMoney(price)
  const valid = description.trim() !== "" && qty !== null && unitPrice !== null

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!valid) return
    onAdd({ description: description.trim(), quantity: formatQuantity(qty!), unitPrice: price.trim(), notes: notes.trim() })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Custom item" description="For anything not in the item list.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="custom-desc">Description</Label>
          <Input
            id="custom-desc"
            autoFocus
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Sew customer's own kitenge"
            aria-invalid={touched && !description.trim()}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="custom-qty">Quantity</Label>
            <Input id="custom-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(",", "."))} aria-invalid={touched && qty === null} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-price">Unit price (KES)</Label>
            <Input id="custom-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" aria-invalid={touched && unitPrice === null} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="custom-notes">Notes for the workshop (optional)</Label>
          <Input id="custom-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Double-stitched side seams" />
        </div>
        {touched && !valid && <p className="text-sm text-destructive">Enter a description, a quantity and a price.</p>}
        <Button type="submit" size="lg" className="w-full">
          Add{qty !== null && unitPrice !== null ? ` · ${formatMoney(lineTotal(qty, unitPrice))}` : ""}
        </Button>
      </form>
    </Dialog>
  )
}
