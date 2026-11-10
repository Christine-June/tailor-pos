import { useEffect, useState, type FormEvent } from "react"
import { Archive, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, errorMessage } from "@/lib/api"
import { formatPhone } from "@/lib/format"
import type { Customer } from "@/lib/types"
import { uuid } from "@/lib/uuid"

interface Props {
  open: boolean
  /** Edit this customer; omit to create a new one. */
  customer?: Customer | null
  canArchive?: boolean
  onClose: () => void
  onSaved: (customer: Customer) => void
  /** A duplicate phone belongs to this existing customer and staff chose to open them. */
  onOpenExisting?: (customer: Customer) => void
}

export function CustomerFormDialog({ open, customer, canArchive, onClose, onSaved, onOpenExisting }: Props) {
  const editing = !!customer
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<Customer | null>(null)
  const [newId, setNewId] = useState(uuid)

  useEffect(() => {
    if (!open) return
    setFirst(customer?.first_name ?? "")
    setLast(customer?.last_name ?? "")
    setPhone(formatPhone(customer?.phone ?? null))
    setEmail(customer?.email ?? "")
    setNotes(customer?.notes ?? "")
    setError(null)
    setDuplicate(null)
    setBusy(false)
    setNewId(uuid())
  }, [open, customer])

  async function save(allowDuplicate: boolean) {
    setBusy(true)
    setError(null)
    const body = {
      first_name: first.trim(),
      last_name: last.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
      allow_duplicate_phone: allowDuplicate,
    }
    try {
      const saved = editing
        ? await api.patch<Customer>(`/customers/${customer!.id}`, body)
        : await api.post<Customer>("/customers", { id: newId, ...body })
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError && err.code === "duplicate_phone") setDuplicate((err.details as { existing: Customer }).existing)
      else setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function archive() {
    if (!customer) return
    setBusy(true)
    try {
      onSaved(await api.patch<Customer>(`/customers/${customer.id}`, { archived: !customer.archived }))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!first.trim()) {
      setError("Enter a first name.")
      return
    }
    void save(false)
  }

  return (
    <Dialog open={open} onClose={onClose} dismissible={!busy} title={editing ? "Edit customer" : "New customer"}>
      {duplicate ? (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{duplicate.full_name}</strong> already uses {formatPhone(duplicate.phone)}. Family members often share a number, so you can keep both.
          </p>
          <div className="flex flex-col gap-2">
            {onOpenExisting && <Button onClick={() => onOpenExisting(duplicate)}>Open {duplicate.first_name}'s profile</Button>}
            <Button variant="outline" disabled={busy} onClick={() => void save(true)}>
              {busy && <Loader2 className="animate-spin" />}
              Save anyway
            </Button>
            <Button variant="ghost" onClick={() => setDuplicate(null)}>
              Back
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="c-first">First name</Label>
              <Input id="c-first" autoFocus maxLength={50} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-last">Last name</Label>
              <Input id="c-last" maxLength={50} value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">Email (optional)</Label>
              <Input id="c-email" type="email" inputMode="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-notes">Notes (optional)</Label>
            <textarea
              id="c-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Prefers a loose fit; allergic to wool"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {editing && canArchive && (
              <Button type="button" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => void archive()}>
                <Archive /> {customer!.archived ? "Restore" : "Archive"}
              </Button>
            )}
            <Button type="submit" className="ml-auto" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Add customer"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
