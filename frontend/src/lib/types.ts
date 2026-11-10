export type Role = "owner" | "cashier" | "tailor"

export interface User {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
}

export interface Shop {
  id: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  kra_pin: string | null
  receipt_footer: string | null
  currency: string
  timezone: string
  vat_registered: boolean
  vat_rate: string
  min_deposit_pct: string
  measurement_unit: "in" | "cm"
  printer_mode: "none" | "agent" | "network"
  printer_host: string | null
  printer_port: number
  printer_width: 32 | 42 | 48
  agent_configured: boolean
  agent_last_seen: string | null
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  user: User
  shop: Shop
}
