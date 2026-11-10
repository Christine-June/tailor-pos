import { configureStore } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import type { Cart } from "@/lib/checkout"
import { configureApi } from "@/lib/api"
import authReducer, { accessTokenRefreshed, emptyAuth, signedOut, type AuthState } from "./authSlice"
import cartReducer, { emptyCart } from "./cartSlice"

// Phase 6 moves persistence to IndexedDB along with the offline outbox. For now the session
// and the open cart live in localStorage, so a page reload doesn't lose either.
const SESSION_KEY = "tailorpos.session.v1"
const CART_KEY = "tailorpos.cart.v1"

function load<T>(key: string, valid: (value: T) => boolean, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback()
    const parsed = JSON.parse(raw) as T
    return parsed && valid(parsed) ? parsed : fallback()
  } catch {
    return fallback()
  }
}

function save(key: string, value: unknown | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing or full storage: state just won't survive a reload.
  }
}

const auth = load<AuthState>(SESSION_KEY, (s) => !!s.refreshToken && !!s.user, () => emptyAuth)
const cart = auth.user ? load<Cart>(CART_KEY, (c) => typeof c.saleId === "string" && Array.isArray(c.lines), () => emptyCart()) : emptyCart()

export const store = configureStore({
  reducer: { auth: authReducer, cart: cartReducer },
  preloadedState: { auth, cart },
})

let last = store.getState()
store.subscribe(() => {
  const state = store.getState()
  if (state.auth !== last.auth) save(SESSION_KEY, state.auth.refreshToken ? state.auth : null)
  if (state.cart !== last.cart) save(CART_KEY, state.cart.lines.length || state.cart.customer ? state.cart : null)
  last = state
})

configureApi({
  getAccessToken: () => store.getState().auth.accessToken,
  getRefreshToken: () => store.getState().auth.refreshToken,
  onAccessToken: (token) => store.dispatch(accessTokenRefreshed(token)),
  onSessionEnded: () => store.dispatch(signedOut()),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
