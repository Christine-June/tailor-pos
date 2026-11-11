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

export type ItemKind = "fabric" | "trim" | "retail" | "service"

export interface InventoryItem {
  id: string
  sku: string | null
  name: string
  kind: ItemKind
  category: string | null
  unit: string
  sell_price: string
  track_stock: boolean
  quantity_on_hand: string
  reorder_level: string
  is_low: boolean
  archived: boolean
  /** Owner only. */
  cost_price?: string
}

export type MovementReason = "purchase" | "sale" | "order_cancelled" | "adjustment" | "stock_count" | "waste" | "return"

export interface StockMovement {
  id: string
  item_id: string
  order_id: string | null
  reason: MovementReason
  quantity_delta: string
  balance_after: string
  note: string | null
  user: string | null
  created_at: string
}

export interface DailyReport {
  date: string
  by_method: { method: PaymentMethod; received: string; refunded: string; net: string; count: number }[]
  total_received: string
  total_refunded: string
  net_takings: string
  orders_created: number
  sales_value: string
  payments: (Payment & { order_number: number })[]
}

export interface OrderBrief {
  id: string
  number: number
  status: OrderStatus
  customer_name: string
  customer_phone: string | null
  due_date: string | null
  balance: string
}

export interface Overview {
  today: string
  outstanding_count: number
  outstanding_total: string
  overdue: OrderBrief[]
  due_soon: OrderBrief[]
  awaiting_collection: OrderBrief[]
  low_stock: InventoryItem[]
}

export interface PrintJob {
  id: string
  order_id: string | null
  document: string
  status: "queued" | "claimed" | "done" | "failed"
  attempts: number
  error: string | null
  created_at: string
}

export interface Customer {
  id: string
  first_name: string
  last_name: string
  full_name: string
  phone: string | null
  email: string | null
  notes: string | null
  archived: boolean
  created_at: string
}

export interface Measurement {
  id: string
  customer_id: string
  unit: "in" | "cm"
  values: Record<string, string>
  label: string | null
  notes: string | null
  taken_by: string | null
  recorded_at: string
  orders?: { id: string; number: number; status: OrderStatus }[]
}

export type PaymentMethod = "cash" | "mpesa" | "card" | "bank" | "other"
export type OrderStatus =
  | "draft"
  | "confirmed"
  | "cutting"
  | "stitching"
  | "fitting"
  | "alterations"
  | "ready"
  | "completed"
  | "cancelled"

export interface OrderLine {
  id: string
  inventory_item_id: string | null
  description: string
  unit: string | null
  quantity: string
  unit_price: string
  line_total: string
  notes: string | null
}

export interface Payment {
  id: string
  order_id: string
  kind: "payment" | "refund"
  method: PaymentMethod
  amount: string
  tendered: string | null
  change: string | null
  reference: string | null
  note: string | null
  received_by: string | null
  created_at: string
}

export interface Order {
  id: string
  number: number
  kind: "retail" | "bespoke"
  status: OrderStatus
  customer: Customer | null
  measurement_id: string | null
  measurement: Measurement | null
  assigned_to: { id: string; name: string } | null
  created_by: string | null
  items: OrderLine[]
  payments: Payment[]
  subtotal: string
  discount: string
  total: string
  tax_amount: string
  amount_paid: string
  balance: string
  payment_status: "unpaid" | "partial" | "paid"
  due_date: string | null
  notes: string | null
  cancel_reason: string | null
  created_offline: boolean
  created_at: string
  completed_at: string | null
}

export interface OrderEvent {
  from_status: OrderStatus | null
  to_status: OrderStatus
  note: string | null
  user: string | null
  created_at: string
}

export interface OrderDetail extends Order {
  events: OrderEvent[]
}

/** What the workshop sees: no prices or payments. */
export interface JobCard {
  id: string
  number: number
  status: OrderStatus
  customer_name: string
  assigned_to: { id: string; name: string } | null
  items: { description: string; quantity: string; notes: string | null }[]
  measurement: Measurement | null
  due_date: string | null
  notes: string | null
}

export interface StaffMember {
  id: string
  name: string
  role: Role
}

export interface Page<T> {
  items: T[]
  total?: number
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  user: User
  shop: Shop
}
