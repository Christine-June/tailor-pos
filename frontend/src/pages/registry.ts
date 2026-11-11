import { lazy, type ComponentType, type LazyExoticComponent } from "react"

/**
 * Every page's code, loaded on first use. After sign-in the rest are fetched quietly in the
 * background, so moving around the menu is instant and never flashes a loading screen.
 */
const loaders: Record<string, () => Promise<{ default: ComponentType }>> = {
  "/dashboard": () => import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
  "/sell": () => import("@/pages/sell/SellPage").then((m) => ({ default: m.SellPage })),
  "/customers": () => import("@/pages/customers/CustomersPage").then((m) => ({ default: m.CustomersPage })),
  "/orders": () => import("@/pages/orders/OrdersPage").then((m) => ({ default: m.OrdersPage })),
  "/workshop": () => import("@/pages/workshop/WorkshopPage").then((m) => ({ default: m.WorkshopPage })),
  "/stock": () => import("@/pages/stock/StockPage").then((m) => ({ default: m.StockPage })),
  "/reports": () => import("@/pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })),
  "/settings": () => import("@/pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
  "/sync": () => import("@/pages/SyncPage").then((m) => ({ default: m.SyncPage })),
  "/account": () => import("@/pages/AccountPage").then((m) => ({ default: m.AccountPage })),
}

export const PAGES: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(loaders).map(([path, load]) => [path, lazy(load)]),
)

let preloaded = false
export function preloadPages(paths: string[] = Object.keys(loaders)) {
  if (preloaded) return
  preloaded = true
  const run = () => paths.forEach((p) => void loaders[p]?.().catch(() => undefined))
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
