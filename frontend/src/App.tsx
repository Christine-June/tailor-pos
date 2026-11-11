import type { ReactNode } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"

import { AppLayout } from "@/components/layout/AppLayout"
import { HomeRedirect, RequireAuth, RequireRole } from "@/components/RouteGuards"
import { NAV } from "@/lib/nav"
import { ComingSoonPage } from "@/pages/ComingSoonPage"
import { LoginPage } from "@/pages/LoginPage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { CustomersPage } from "@/pages/customers/CustomersPage"
import { OrdersPage } from "@/pages/orders/OrdersPage"
import { ReportsPage } from "@/pages/reports/ReportsPage"
import { SellPage } from "@/pages/sell/SellPage"
import { SettingsPage } from "@/pages/settings/SettingsPage"
import { StockPage } from "@/pages/stock/StockPage"
import { SyncPage } from "@/pages/SyncPage"
import { WorkshopPage } from "@/pages/workshop/WorkshopPage"

// Screens built so far; the rest show which phase builds them.
const PAGES: Record<string, ReactNode> = {
  "/sell": <SellPage />,
  "/customers": <CustomersPage />,
  "/orders": <OrdersPage />,
  "/workshop": <WorkshopPage />,
  "/stock": <StockPage />,
  "/reports": <ReportsPage />,
  "/settings": <SettingsPage />,
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          {NAV.map((item) => (
            <Route
              key={item.to}
              path={item.to.slice(1) + "/*"}
              element={
                <RequireRole path={item.to}>{PAGES[item.to] ?? <ComingSoonPage item={item} />}</RequireRole>
              }
            />
          ))}
          {/* Every role can see what this device still has to send. */}
          <Route path="sync" element={<SyncPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
