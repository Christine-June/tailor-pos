import { BrowserRouter, Route, Routes } from "react-router-dom"

import { AppLayout } from "@/components/layout/AppLayout"
import { HomeRedirect, RequireAuth, RequireRole } from "@/components/RouteGuards"
import { NAV } from "@/lib/nav"
import { ComingSoonPage } from "@/pages/ComingSoonPage"
import { LoginPage } from "@/pages/LoginPage"
import { NotFoundPage } from "@/pages/NotFoundPage"

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
                <RequireRole path={item.to}>
                  <ComingSoonPage item={item} />
                </RequireRole>
              }
            />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
