import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

import { canAccess, homeFor } from "@/lib/nav"
import { useAppSelector } from "@/store"

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAppSelector((s) => s.auth.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

/** The server enforces roles too; this just keeps staff away from pages they can't use. */
export function RequireRole({ path, children }: { path: string; children: ReactNode }) {
  const user = useAppSelector((s) => s.auth.user)!
  if (!canAccess(user.role, path)) return <Navigate to={homeFor(user.role)} replace />
  return children
}

export function HomeRedirect() {
  const user = useAppSelector((s) => s.auth.user)!
  return <Navigate to={homeFor(user.role)} replace />
}
