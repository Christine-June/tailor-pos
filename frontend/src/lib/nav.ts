import {
  BarChart3,
  ClipboardList,
  Package,
  Ruler,
  Scissors,
  Settings,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "./types"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
  /** The checklist phase that builds this page. */
  phase: number
  summary: string
}

const STAFF: Role[] = ["owner", "cashier"]
const EVERYONE: Role[] = ["owner", "cashier", "tailor"]

export const NAV: NavItem[] = [
  { to: "/sell", label: "Sell", icon: ShoppingBag, roles: STAFF, phase: 3, summary: "Item grid, cart, split payments and receipts." },
  { to: "/orders", label: "Orders", icon: ClipboardList, roles: STAFF, phase: 5, summary: "Every order with balances, payments and history." },
  { to: "/customers", label: "Customers", icon: Ruler, roles: EVERYONE, phase: 4, summary: "Profiles and measurement history with side-by-side comparison." },
  { to: "/workshop", label: "Workshop", icon: Scissors, roles: EVERYONE, phase: 5, summary: "Drag-and-drop board from cutting to collection." },
  { to: "/stock", label: "Stock", icon: Package, roles: STAFF, phase: 7, summary: "Fabric, trims and retail stock with a movement history." },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: STAFF, phase: 7, summary: "Daily cash-up, balances owed, overdue jobs, low stock." },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["owner"], phase: 7, summary: "Shop details, VAT, deposits, staff and printer." },
]

export function navFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role))
}

export function canAccess(role: Role, path: string): boolean {
  const item = NAV.find((n) => path === n.to || path.startsWith(n.to + "/"))
  return item ? item.roles.includes(role) : false
}

/** Where each role lands after signing in: tailors go straight to the workshop. */
export function homeFor(role: Role): string {
  return role === "tailor" ? "/workshop" : "/sell"
}
