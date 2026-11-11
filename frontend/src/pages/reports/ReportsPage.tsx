import { NavLink, Route, Routes } from "react-router-dom"

import { NotFoundPage } from "@/pages/NotFoundPage"
import { cn } from "@/lib/utils"
import { useAppSelector } from "@/store"
import { CashUp } from "./CashUp"
import { Dashboard } from "./Dashboard"

// Absolute paths: inside a "/reports/*" route, relative links resolve from the current sub-page.
const TABS = [
  { to: "/reports", label: "Dashboard", end: true },
  { to: "/reports/cash-up", label: "Daily cash-up", end: false },
]

export function ReportsPage() {
  const shop = useAppSelector((s) => s.auth.shop)!
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <nav className="flex gap-2 border-b" aria-label="Reports">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="cash-up" element={<CashUp shop={shop} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  )
}
