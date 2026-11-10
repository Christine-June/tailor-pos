import { Badge } from "@/components/ui/badge"
import { STATUS_LABEL } from "@/lib/format"
import type { OrderStatus } from "@/lib/types"

const VARIANT: Record<OrderStatus, "default" | "secondary" | "accent" | "destructive" | "success" | "outline"> = {
  draft: "outline",
  confirmed: "secondary",
  cutting: "accent",
  stitching: "accent",
  fitting: "accent",
  alterations: "accent",
  ready: "success",
  completed: "default",
  cancelled: "destructive",
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status] ?? status}</Badge>
}
