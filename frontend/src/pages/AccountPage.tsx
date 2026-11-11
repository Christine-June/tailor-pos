import { useState, type FormEvent } from "react"
import { KeyRound, Loader2, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, errorMessage } from "@/lib/api"
import { formatPhone } from "@/lib/format"
import { signedOut, tokensReplaced } from "@/store/authSlice"
import { useAppDispatch, useAppSelector } from "@/store"
import { AccountCard } from "./dashboard/DashboardPage"

const ROLE_CAN: Record<string, string> = {
  owner: "Everything: sales, refunds, discounts, prices, stock, reports, staff and settings.",
  cashier: "Sales and payments, orders, customers, stock counts, reports and the workshop.",
  tailor: "The workshop board and customers' measurements. No prices or money.",
}

export function AccountPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  const dispatch = useAppDispatch()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    if (next.length < 8) return setMessage({ text: "The new password needs at least 8 characters.", ok: false })
    if (next !== confirm) return setMessage({ text: "The two new passwords don't match.", ok: false })
    setBusy(true)
    try {
      const tokens = await api.post<{ access_token: string; refresh_token: string }>("/auth/change-password", {
        current_password: current,
        new_password: next,
      })
      dispatch(tokensReplaced(tokens))
      setCurrent("")
      setNext("")
      setConfirm("")
      setMessage({ text: "Password changed. Any other device you were signed in on has been signed out.", ok: true })
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h2 className="text-2xl font-semibold tracking-tight">My account</h2>
      <div className="grid gap-5 md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <AccountCard user={user} shop={shop} link={false} />
          <section className="rounded-2xl border bg-card p-4 text-sm">
            <h3 className="font-semibold">What you can do</h3>
            <p className="mt-1 text-muted-foreground">{ROLE_CAN[user.role]}</p>
            <h3 className="mt-4 font-semibold">Shop</h3>
            <p className="mt-1 text-muted-foreground">
              {shop.name}
              {shop.address && <span className="block">{shop.address}</span>}
              {shop.phone && <span className="block">{formatPhone(shop.phone)}</span>}
            </p>
          </section>
        </div>

        <div className="space-y-5">
          <form onSubmit={changePassword} className="space-y-4 rounded-2xl border bg-card p-5" noValidate>
            <div>
              <h3 className="flex items-center gap-2 font-semibold">
                <KeyRound className="size-4" /> Change password
              </h3>
              <p className="text-sm text-muted-foreground">Changing it signs you out on every other device.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pw-new">New password</Label>
                <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">New password again</Label>
                <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
            {message && (
              <p role="status" className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
                {message.text}
              </p>
            )}
            <Button type="submit" disabled={busy || !current || !next}>
              {busy && <Loader2 className="animate-spin" />}
              Change password
            </Button>
          </form>

          <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-5">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">Sign out</h3>
              <p className="text-sm text-muted-foreground">On a shared tablet, sign out at the end of your shift.</p>
            </div>
            <Button variant="outline" onClick={() => dispatch(signedOut())}>
              <LogOut /> Sign out
            </Button>
          </section>
        </div>
      </div>
    </div>
  )
}
