import { useEffect, useState } from "react"
import { Loader2, Pencil, UserPlus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, errorMessage } from "@/lib/api"
import type { Role, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAppSelector } from "@/store"
import { Field, Section } from "./ShopSettings"

const ROLES: { role: Role; label: string; hint: string }[] = [
  { role: "owner", label: "Owner", hint: "Everything, including discounts, refunds, prices and settings." },
  { role: "cashier", label: "Cashier", hint: "Sells, takes payments, manages orders, customers and stock counts." },
  { role: "tailor", label: "Tailor", hint: "Workshop board and customers' measurements. Never sees money." },
]

export function StaffSettings() {
  const me = useAppSelector((s) => s.auth.user)!
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<User | "new" | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<{ items: User[] }>("/users", { signal: controller.signal })
      .then((r) => setUsers(r.items))
      .catch((err) => !controller.signal.aborted && setError(errorMessage(err)))
    return () => controller.abort()
  }, [])

  function saved(user: User, message: string) {
    setUsers((list) => (list ? (list.some((u) => u.id === user.id) ? list.map((u) => (u.id === user.id ? user : u)) : [...list, user]) : list))
    setEditing(null)
    setFlash(message)
  }

  return (
    <Section title="Staff" hint="Everyone signs in with their own account, so every sale and payment shows who took it.">
      <div className="flex items-center gap-3">
        {flash && (
          <p role="status" className="text-sm text-success">
            {flash}
          </p>
        )}
        <Button className="ml-auto" onClick={() => setEditing("new")}>
          <UserPlus /> Add staff
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !users ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : (
        <ul className="divide-y rounded-lg border">
          {users.map((u) => (
            <li key={u.id} className={cn("flex items-center gap-3 px-4 py-3", !u.active && "text-muted-foreground")}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {u.name} {u.id === me.id && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                </p>
                <p className="truncate text-sm text-muted-foreground">{u.email}</p>
              </div>
              <Badge variant={u.role === "owner" ? "default" : "secondary"}>{ROLES.find((r) => r.role === u.role)?.label}</Badge>
              {!u.active && <Badge variant="outline">Can't sign in</Badge>}
              <Button variant="ghost" size="icon" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <StaffDialog open={editing !== null} user={editing === "new" ? null : editing} isMe={editing !== "new" && editing?.id === me.id} onClose={() => setEditing(null)} onSaved={saved} />
    </Section>
  )
}

function StaffDialog({ open, user, isMe, onClose, onSaved }: { open: boolean; user: User | null; isMe: boolean; onClose: () => void; onSaved: (u: User, message: string) => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("cashier")
  const [active, setActive] = useState(true)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const creating = !user

  useEffect(() => {
    if (!open) return
    setName(user?.name ?? "")
    setEmail(user?.email ?? "")
    setRole(user?.role ?? "cashier")
    setActive(user?.active ?? true)
    setPassword("")
    setError(null)
    setBusy(false)
  }, [open, user])

  async function save() {
    if (!name.trim()) return setError("Enter their name.")
    if (creating && !email.trim()) return setError("Enter the email they'll sign in with.")
    if ((creating || password) && password.length < 8) return setError("The password needs at least 8 characters.")
    setBusy(true)
    setError(null)
    try {
      if (creating) {
        const u = await api.post<User>("/users", { name: name.trim(), email: email.trim(), role, password })
        onSaved(u, `${u.name} can now sign in with ${u.email}.`)
      } else {
        const body: Record<string, unknown> = {}
        if (name.trim() !== user!.name) body.name = name.trim()
        if (role !== user!.role) body.role = role
        if (active !== user!.active) body.active = active
        if (password) body.password = password
        const u = await api.patch<User>(`/users/${user!.id}`, body)
        onSaved(u, !active && user!.active ? `${u.name} is signed out everywhere and can't sign in.` : password ? `${u.name}'s password changed; they'll sign in again.` : `${u.name} updated.`)
      }
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
      title={creating ? "Add staff" : `Edit ${user!.name}`}
      footer={
        <Button className="w-full" onClick={() => void save()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {creating ? "Add" : "Save"}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field id="u-name" label="Name">
          <Input id="u-name" autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {creating ? (
          <Field id="u-email" label="Email (used to sign in)">
            <Input id="u-email" type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">Signs in as {user!.email}</p>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Role</legend>
          {ROLES.map((r) => (
            <label key={r.role} className={cn("flex cursor-pointer gap-2 rounded-md border px-3 py-2", role === r.role && "border-primary bg-primary/5")}>
              <input type="radio" name="role" checked={role === r.role} onChange={() => setRole(r.role)} className="mt-0.5 size-4" />
              <span className="text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field id="u-password" label={creating ? "Password" : "New password (leave blank to keep)"} hint="At least 8 characters. Give it to them in person.">
          <Input id="u-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        {!creating && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-0.5 size-4" />
            <span>
              Can sign in
              <span className="block text-xs text-muted-foreground">
                Untick when someone leaves: they're signed out at once. Their past sales keep their name.
                {isMe && " This is you: you'd be signed out."}
              </span>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
