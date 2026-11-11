import { NavLink, Route, Routes } from "react-router-dom"

import { cn } from "@/lib/utils"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { PrinterSettings } from "./PrinterSettings"
import { ShopSettings } from "./ShopSettings"
import { StaffSettings } from "./StaffSettings"

// Absolute paths: inside a "/settings/*" route, relative links resolve from the current sub-page.
const TABS = [
  { to: "/settings", label: "Shop", end: true },
  { to: "/settings/staff", label: "Staff", end: false },
  { to: "/settings/printer", label: "Printer", end: false },
]

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <nav className="flex gap-2 border-b" aria-label="Settings">
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
        <Route index element={<ShopSettings />} />
        <Route path="staff" element={<StaffSettings />} />
        <Route path="printer" element={<PrinterSettings />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  )
}
