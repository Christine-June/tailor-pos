import { Route, Routes } from "react-router-dom"

import { NotFoundPage } from "@/pages/NotFoundPage"
import { useAppSelector } from "@/store"
import { OrderDetailPage } from "./OrderDetailPage"
import { OrderList } from "./OrderList"

export function OrdersPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  return (
    <Routes>
      <Route index element={<OrderList timeZone={shop.timezone} />} />
      <Route path=":orderId" element={<OrderDetailPage role={user.role} shop={shop} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
