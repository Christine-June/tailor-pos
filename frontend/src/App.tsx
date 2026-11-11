import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react"
import { Loader2 } from "lucide-react"
import { BrowserRouter, Route, Routes } from "react-router-dom"

import { ErrorBoundary } from "@/components/ErrorBoundary"
import { AppLayout } from "@/components/layout/AppLayout"
import { HomeRedirect, RequireAuth, RequireRole } from "@/components/RouteGuards"
import { NAV } from "@/lib/nav"
import { LoginPage } from "@/pages/LoginPage"
import { NotFoundPage } from "@/pages/NotFoundPage"

// Each area loads when first opened, so a cashier's tablet doesn't download Settings to make a
// sale. The service worker still stores every page ahead of time for offline use.
const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  "/sell": lazy(() => import("@/pages/sell/SellPage").then((m) => ({ default: m.SellPage }))),
  "/customers": lazy(() => import("@/pages/customers/CustomersPage").then((m) => ({ default: m.CustomersPage }))),
  "/orders": lazy(() => import("@/pages/orders/OrdersPage").then((m) => ({ default: m.OrdersPage }))),
  "/workshop": lazy(() => import("@/pages/workshop/WorkshopPage").then((m) => ({ default: m.WorkshopPage }))),
  "/stock": lazy(() => import("@/pages/stock/StockPage").then((m) => ({ default: m.StockPage }))),
  "/reports": lazy(() => import("@/pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage }))),
  "/settings": lazy(() => import("@/pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage }))),
}
const SyncPage = lazy(() => import("@/pages/SyncPage").then((m) => ({ default: m.SyncPage })))

function PageLoading() {
  return (
    <div className="flex justify-center py-16 text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
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
            {NAV.map((item) => {
              const Page = PAGES[item.to]!
              return (
                <Route
                  key={item.to}
                  path={item.to.slice(1) + "/*"}
                  element={
                    <RequireRole path={item.to}>
                      {/* A crash on one page leaves the menu working, so staff can move on. */}
                      <ErrorBoundary key={item.to} inline>
                        <Suspense fallback={<PageLoading />}>
                          <Page />
                        </Suspense>
                      </ErrorBoundary>
                    </RequireRole>
                  }
                />
              )
            })}
            {/* Every role can see what this device still has to send. */}
            <Route
              path="sync"
              element={
                <Suspense fallback={<PageLoading />}>
                  <SyncPage />
                </Suspense>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
