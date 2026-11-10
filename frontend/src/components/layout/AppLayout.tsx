import { useEffect, useState } from "react"
import { AlertTriangle, CloudUpload, Loader2, LogOut, Menu, Wifi, WifiOff, X } from "lucide-react"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useOnline } from "@/hooks/useOnline"
import { useOutbox, useSyncStatus } from "@/hooks/useSync"
import { api } from "@/lib/api"
import { navFor, NAV, type NavItem } from "@/lib/nav"
import type { Shop, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { sessionUpdated, signedOut } from "@/store/authSlice"
import { useAppDispatch, useAppSelector } from "@/store"
import { LogoMark } from "./Logo"

const ROLE_LABEL = { owner: "Owner", cashier: "Cashier", tailor: "Tailor" } as const

function SideNavLink({ item, compact, onNavigate }: { item: NavItem; compact: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
          compact ? "flex-col gap-1 px-1 py-2.5 text-[11px]" : "px-3 py-2.5",
          isActive
            ? "bg-sidebar-active text-white shadow-[inset_3px_0_0_var(--brass)]"
            : "text-sidebar-foreground/80 hover:bg-sidebar-active/60 hover:text-white",
        )
      }
    >
      <Icon className={compact ? "size-5" : "size-[18px]"} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
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
  const current = NAV.find((n) => location.pathname.startsWith(n.to)) ?? (location.pathname.startsWith("/sync") ? { label: "Sync" } : undefined)

  // Picks up role or shop changes made elsewhere; a deactivated account is signed out by the API client.
  useEffect(() => {
    const controller = new AbortController()
    api
      .get<{ user: User; shop: Shop }>("/auth/me", { signal: controller.signal })
      .then((data) => dispatch(sessionUpdated(data)))
      .catch(() => undefined)
    return () => controller.abort()
  }, [dispatch])

  useEffect(() => setDrawerOpen(false), [location.pathname])

  return (
    <div className="flex min-h-dvh">
      {/* Tablet: icon rail. Desktop: full sidebar. */}
      <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar md:flex md:w-[76px] lg:w-60">
        <div className="flex h-16 items-center gap-2.5 px-4 lg:px-5">
          <LogoMark />
          <span className="hidden truncate font-semibold text-white lg:block">Tailor POS</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 py-2 lg:px-3" aria-label="Main">
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
        <div className="hidden border-t border-white/10 px-5 py-4 lg:block">
          <p className="truncate text-sm font-medium text-white">{shop.name}</p>
          <p className="truncate text-xs text-sidebar-foreground/70">{shop.address ?? shop.currency}</p>
        </div>
      </aside>

      {/* Phone: slide-in drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-sidebar animate-in slide-in-from-left duration-200">
            <div className="flex h-16 items-center justify-between px-4">
              <div className="flex items-center gap-2.5">
                <LogoMark />
                <span className="font-semibold text-white">Tailor POS</span>
              </div>
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <h1 className="truncate text-lg font-semibold">{current?.label ?? shop.name}</h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            {(outbox.total > 0 || sync.running) && (
              <Link
                to="/sync"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
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
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                online ? "bg-success/10 text-success" : "bg-warning/15 text-accent-foreground",
              )}
              role="status"
            >
              {online ? <Wifi className="size-3.5" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
              <span className="hidden sm:inline">{online ? "Online" : "Offline"}</span>
            </span>
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => (unsynced > 0 ? setConfirmSignOut(true) : dispatch(signedOut()))}>
              <LogOut aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        {!online && (
          <div role="status" className="flex items-center gap-2 border-b bg-warning/15 px-4 py-2 text-sm text-accent-foreground md:px-6">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            <span>
              You're offline. Sales and payments are saved on this device and sync when the internet is back. Other changes need a connection.
            </span>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
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
