import { BrowserRouter, Route, Routes } from "react-router-dom"

import { ErrorBoundary } from "@/components/ErrorBoundary"
import { AppLayout } from "@/components/layout/AppLayout"
import { HomeRedirect, RequireAuth, RequireRole } from "@/components/RouteGuards"
import { NAV } from "@/lib/nav"
import { LoginPage } from "@/pages/LoginPage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { PAGES } from "@/pages/registry"

const SyncPage = PAGES["/sync"]!
const AccountPage = PAGES["/account"]!

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* The layout holds one loading boundary, so the menu and header never disappear. */}
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
                        <Page />
                      </ErrorBoundary>
                    </RequireRole>
                  }
                />
              )
            })}
            {/* Every role: what this device still has to send, and their own account. */}
            <Route path="sync" element={<SyncPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
