import { Suspense, useEffect, useRef, useState } from "react"
import { AlertTriangle, CalendarDays, ChevronDown, CloudUpload, Loader2, LogOut, Menu, UserRound, Wifi, WifiOff, X } from "lucide-react"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useOnline } from "@/hooks/useOnline"
import { useOutbox, useSyncStatus } from "@/hooks/useSync"
import { api } from "@/lib/api"
import { navFor, NAV, type NavItem } from "@/lib/nav"
import type { Shop, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { preloadPages } from "@/pages/registry"
import { sessionUpdated, signedOut } from "@/store/authSlice"
import { useAppDispatch, useAppSelector } from "@/store"
import { LogoMark } from "./Logo"

const ROLE_LABEL = { owner: "Owner", cashier: "Cashier", tailor: "Tailor" } as const

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

function SideNavLink({ item, compact }: { item: NavItem; compact: boolean }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      title={compact ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl text-sm font-medium transition-colors",
          compact ? "flex-col gap-1 px-1 py-2.5 text-[11px]" : "px-3 py-2.5",
          isActive ? "bg-nav-active text-nav-active-foreground shadow-sm" : "text-nav-foreground hover:bg-nav-hover hover:text-foreground",
        )
      }
    >
      <Icon className={compact ? "size-5" : "size-[18px]"} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  )
}

/** Logo and name: always takes you to your dashboard, inside the app (no page reload). */
function Brand({ showName = true }: { showName?: boolean }) {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="Tailor POS: go to dashboard">
      <LogoMark />
      {showName && (
        <span className="truncate text-[17px] font-semibold tracking-tight">
          Tailor<span className="text-primary">POS</span>
        </span>
      )}
    </Link>
  )
}

function AccountMenu({ user, shop, onSignOut }: { user: User; shop: Shop; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", close)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", close)
    }
  }, [open])

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border bg-card py-1 pr-2 pl-1 shadow-xs transition-colors hover:bg-accent"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(user.name)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium">{user.name}</span>
          <span className="block text-[11px] text-muted-foreground">As {ROLE_LABEL[user.role].toLowerCase()}</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border bg-card p-2 shadow-lg animate-in fade-in zoom-in-95">
          <div className="px-3 py-2">
            <p className="font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ROLE_LABEL[user.role]} · {shop.name}
            </p>
          </div>
          <div className="my-1 border-t" />
          <Link role="menuitem" to="/account" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent">
            <UserRound className="size-4" /> My account
          </Link>
          <button role="menuitem" type="button" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function PageLoading() {
  return (
    <div className="flex justify-center py-16 text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}

export function AppLayout() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  const dispatch = useAppDispatch()
  const online = useOnline()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const outbox = useOutbox()
  const sync = useSyncStatus()
  const unsynced = outbox.total
  const items = navFor(user.role)
  const current =
    NAV.find((n) => location.pathname.startsWith(n.to)) ??
    (location.pathname.startsWith("/sync") ? { label: "Sync" } : location.pathname.startsWith("/account") ? { label: "My account" } : undefined)
  const today = new Intl.DateTimeFormat("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: shop.timezone }).format(new Date())

  // Picks up role or shop changes made elsewhere; a deactivated account is signed out by the API client.
  useEffect(() => {
    const controller = new AbortController()
    api
      .get<{ user: User; shop: Shop }>("/auth/me", { signal: controller.signal })
      .then((data) => dispatch(sessionUpdated(data)))
      .catch(() => undefined)
    return () => controller.abort()
  }, [dispatch])

  // Fetch the other pages' code in the background so the menu switches instantly.
  useEffect(() => preloadPages(), [])
  useEffect(() => setDrawerOpen(false), [location.pathname])

  const signOut = () => (unsynced > 0 ? setConfirmSignOut(true) : dispatch(signedOut()))

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Tablet: icon rail. Desktop: full menu. */}
      <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-nav md:flex md:w-[84px] lg:w-64">
        <div className="flex h-16 items-center justify-center px-4 lg:justify-start lg:px-5">
          <span className="lg:hidden">
            <Brand showName={false} />
          </span>
          <span className="hidden lg:block">
            <Brand />
          </span>
        </div>
        <p className="hidden px-6 pt-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase lg:block">Main menu</p>
        <nav className="flex flex-1 flex-col gap-1 px-2.5 lg:px-4" aria-label="Main">
          {items.map((item) => (
            <div key={item.to}>
              <div className="lg:hidden">
                <SideNavLink item={item} compact />
              </div>
              <div className="hidden lg:block">
                <SideNavLink item={item} compact={false} />
              </div>
            </div>
          ))}
        </nav>
        <div className="hidden p-4 lg:block">
          <div className="rounded-xl bg-accent p-3">
            <p className="truncate text-sm font-semibold text-accent-foreground">{shop.name}</p>
            <p className="truncate text-xs text-muted-foreground">{shop.address ?? shop.currency}</p>
          </div>
        </div>
      </aside>

      {/* Phone: slide-in menu */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/30" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-nav shadow-xl animate-in slide-in-from-left duration-200">
            <div className="flex h-16 items-center justify-between px-4">
              <Brand />
              <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <X />
              </Button>
            </div>
            <nav className="flex flex-col gap-1 px-3" aria-label="Main">
              {items.map((item) => (
                <SideNavLink key={item.to} item={item} compact={false} />
              ))}
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <h1 className="truncate text-lg font-semibold">{current?.label ?? shop.name}</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground lg:inline-flex">
              <CalendarDays className="size-3.5" aria-hidden="true" /> {today}
            </span>
            {(outbox.total > 0 || sync.running) && (
              <Link
                to="/sync"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                  outbox.failed.length ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground",
                )}
                aria-label={`${outbox.pending.length} waiting to sync, ${outbox.failed.length} need attention`}
              >
                {outbox.failed.length ? <AlertTriangle className="size-3.5" /> : sync.running ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
                {outbox.failed.length ? `${outbox.failed.length} need attention` : `${outbox.pending.length} to sync`}
              </Link>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                online ? "bg-success/10 text-success" : "bg-warning/15 text-warning-foreground",
              )}
              role="status"
            >
              {online ? <Wifi className="size-3.5" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
              <span className="hidden sm:inline">{online ? "Online" : "Offline"}</span>
            </span>
            <AccountMenu user={user} shop={shop} onSignOut={signOut} />
          </div>
        </header>
        {!online && (
          <div role="status" className="flex items-center gap-2 border-b bg-warning/15 px-4 py-2 text-sm text-warning-foreground md:px-6">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            <span>You're offline. Sales and payments are saved on this device and sync when the internet is back. Other changes need a connection.</span>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </main>
        <Dialog
          open={confirmSignOut}
          onClose={() => setConfirmSignOut(false)}
          title="Some work hasn't synced yet"
          description={`${unsynced} ${unsynced === 1 ? "item is" : "items are"} saved on this device but not on the server.`}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmSignOut(false)}>
                Stay signed in
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmSignOut(false)
                  dispatch(signedOut())
                }}
              >
                Sign out anyway
              </Button>
            </>
          }
        >
          <p className="text-sm">
            They stay on this device and sync after the next person from your shop signs in here. Staying signed in until they sync is best.{" "}
            <Link to="/sync" className="underline underline-offset-4" onClick={() => setConfirmSignOut(false)}>
              See what's waiting
            </Link>
          </p>
        </Dialog>
      </div>
    </div>
  )
}
