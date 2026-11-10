import { useAppSelector } from "@/store"
import { WorkshopBoard } from "./WorkshopBoard"

export function WorkshopPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  return <WorkshopBoard role={user.role} userId={user.id} shop={shop} />
}
