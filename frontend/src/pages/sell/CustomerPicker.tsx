import { useEffect, useState, type FormEvent } from "react"
import { Loader2, Search, UserPlus, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDebounced } from "@/hooks/useDebounced"
import { ApiError, api, errorMessage, isRetryable } from "@/lib/api"
import { formatPhone, normalizeKenyanPhone, searchCustomers } from "@/lib/format"
import { customerEntry, knownOffline, localCustomer } from "@/lib/offline"
import type { Customer, Page } from "@/lib/types"
import { uuid } from "@/lib/uuid"
import { useAppDispatch, useAppSelector } from "@/store"
import { customerAdded } from "@/store/cacheSlice"
import { enqueued } from "@/store/outboxSlice"

/** Search existing customers or add one in a few seconds, without leaving the sale. */
export function CustomerDialog({ open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (customer: Customer) => void }) {
  const [mode, setMode] = useState<"search" | "new">("search")
  useEffect(() => {
    if (open) setMode("search")
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "search" ? "Choose customer" : "New customer"}
      description={mode === "search" ? "Search by name or phone number." : "Name and phone are enough. Add more on the Customers page."}
    >
      {mode === "search" ? <CustomerSearch onChoose={onChoose} onNew={() => setMode("new")} /> : <QuickAdd onCreated={onChoose} onBack={() => setMode("search")} />}
    </Dialog>
  )
}

function CustomerSearch({ onChoose, onNew }: { onChoose: (c: Customer) => void; onNew: () => void }) {
  const [query, setQuery] = useState("")
  const term = useDebounced(query.trim(), 250)
  const [results, setResults] = useState<Customer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const cached = useAppSelector((s) => s.cache.customers)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    api
      .get<Page<Customer>>(`/customers?limit=20&q=${encodeURIComponent(term)}`, { signal: controller.signal })
      .then((page) => {
        setResults(page.items)
        setOffline(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        if (isRetryable(err) && cached) {
          setResults(searchCustomers(cached.items, term))
          setOffline(true)
        } else setError(errorMessage(err))
      })
    return () => controller.abort()
    // The cached list is a fallback only; it shouldn't re-run the search.
  }, [term])

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or 07xx xxx xxx" className="h-11 pl-9" aria-label="Search customers" />
      </div>
      <Button variant="outline" className="w-full justify-start" onClick={onNew}>
        <UserPlus /> New customer
      </Button>
      {offline && <p className="text-xs text-warning-foreground">Offline: searching customers saved on this device.</p>}
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : results === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : results.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No customers match “{term}”.</p>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Customers">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChoose(c)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {(c.first_name[0] ?? "") + (c.last_name[0] ?? "")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.full_name}</span>
                  <span className="block text-xs text-muted-foreground">{formatPhone(c.phone) || "No phone"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function QuickAdd({ onCreated, onBack }: { onCreated: (c: Customer) => void; onBack: () => void }) {
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<Customer | null>(null)
  // One id per form, so a double tap or a retry after a timeout creates one customer.
  const [id] = useState(uuid)
  const dispatch = useAppDispatch()
  const shop = useAppSelector((s) => s.auth.shop)!
  const user = useAppSelector((s) => s.auth.user)!

  function saveOffline() {
    const normalized = phone.trim() ? normalizeKenyanPhone(phone) : null
    if (phone.trim() && !normalized) {
      setError("Enter a valid phone number, e.g. 0712 345 678")
      setBusy(false)
      return
    }
    const customer = localCustomer(id, first.trim(), last.trim(), normalized)
    dispatch(enqueued(customerEntry(customer, shop.id, user.name)))
    dispatch(customerAdded(customer))
    onCreated(customer)
  }

  async function save(allowDuplicate: boolean) {
    setBusy(true)
    setError(null)
    if (knownOffline()) {
      saveOffline()
      return
    }
    try {
      const customer = await api.post<Customer>("/customers", {
        id,
        first_name: first.trim(),
        last_name: last.trim(),
        phone: phone.trim() || null,
        allow_duplicate_phone: allowDuplicate,
      })
      onCreated(customer)
    } catch (err) {
      if (err instanceof ApiError && err.code === "duplicate_phone") {
        setDuplicate((err.details as { existing: Customer }).existing)
      } else if (isRetryable(err)) {
        saveOffline()
        return
      } else {
        setError(errorMessage(err))
      }
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!first.trim()) {
      setError("Enter the customer's first name.")
      return
    }
    void save(false)
  }

  if (duplicate) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          <strong>{duplicate.full_name}</strong> already uses {formatPhone(duplicate.phone)}. Is this the same person?
        </p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => onCreated(duplicate)}>
            <UserRound /> Yes, use {duplicate.first_name}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void save(true)}>
            {busy && <Loader2 className="animate-spin" />}
            No, add a new customer anyway
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="cust-first">First name</Label>
          <Input id="cust-first" autoFocus maxLength={50} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cust-last">Last name</Label>
          <Input id="cust-last" maxLength={50} value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cust-phone">Phone</Label>
        <Input id="cust-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="off" />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save customer
        </Button>
      </div>
    </form>
  )
}
