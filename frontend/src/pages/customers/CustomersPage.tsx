import { Route, Routes } from "react-router-dom"

import { useAppSelector } from "@/store"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { CompareFittings } from "./CompareFittings"
import { CustomerList } from "./CustomerList"
import { CustomerProfile } from "./CustomerProfile"
import { FittingForm } from "./FittingForm"

export function CustomersPage() {
  const user = useAppSelector((s) => s.auth.user)!
  const shop = useAppSelector((s) => s.auth.shop)!
  return (
    <Routes>
      <Route index element={<CustomerList timeZone={shop.timezone} />} />
      <Route path=":customerId" element={<CustomerProfile role={user.role} timeZone={shop.timezone} />} />
      <Route path=":customerId/fittings/new" element={<FittingForm defaultUnit={shop.measurement_unit} timeZone={shop.timezone} />} />
      <Route path=":customerId/compare" element={<CompareFittings timeZone={shop.timezone} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
