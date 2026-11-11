import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { LogoMark } from "@/components/layout/Logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, errorMessage } from "@/lib/api"
import { canAccess, homeFor } from "@/lib/nav"
import type { LoginResponse } from "@/lib/types"
import { signedIn } from "@/store/authSlice"
import { useAppDispatch, useAppSelector } from "@/store"

export function LoginPage() {
  const user = useAppSelector((s) => s.auth.user)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={homeFor(user.role)} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError("Enter your email and password.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await api.post<LoginResponse>("/auth/login", { email: email.trim(), password }, { auth: false })
      dispatch(signedIn(session))
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && canAccess(session.user.role, from) ? from : homeFor(session.user.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <span className="text-lg font-semibold text-white">Tailor POS</span>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-3xl leading-tight font-semibold text-white">Every fitting, deposit and stitch, in one place.</p>
          <p className="mt-4 text-sidebar-foreground/75">
            Take deposits with cash or M-Pesa, keep every customer's measurements on record, and see where each job is in the workshop.
          </p>
        </div>
        <p className="relative z-10 w-fit rounded bg-sidebar px-2 py-1 text-xs text-sidebar-foreground/60">Signed-in sessions stay on this device until you sign out.</p>
        {/* Tape-measure stripe */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 bottom-24 h-14 w-[140%] -rotate-12 bg-brass/90"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 11px, rgba(31,42,68,.55) 11px 12px)" }}
        />
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="size-10" />
            <span className="text-lg font-semibold">Tailor POS</span>
          </div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the account your shop owner created for you.</p>

          <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder="name@yourshop.co.ke"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                aria-invalid={!!error}
                className="h-11"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError(null)
                }}
                aria-invalid={!!error}
                className="h-11"
              />
            </div>
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {import.meta.env.DEV && (
            <p className="mt-8 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Demo: owner@demo.test, cashier@demo.test or tailor@demo.test, password <code>demo-password</code>
            </p>
          )}
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Tailor POS {__APP_VERSION__} ·{" "}
            <a href="/third-party-licenses.txt" target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-foreground">
              Open-source licences
            </a>
          </p>
        </div>
      </section>
    </div>
  )
}
