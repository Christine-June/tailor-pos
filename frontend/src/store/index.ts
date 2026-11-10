import { configureStore } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import { configureApi } from "@/lib/api"
import authReducer, { accessTokenRefreshed, emptyAuth, signedOut, type AuthState } from "./authSlice"

// Phase 6 moves persistence to IndexedDB along with the offline outbox. For now the
// session lives in localStorage so a page reload doesn't sign staff out.
const SESSION_KEY = "tailorpos.session.v1"

function loadSession(): AuthState {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return emptyAuth
    const parsed = JSON.parse(raw) as AuthState
    return parsed?.refreshToken && parsed.user ? parsed : emptyAuth
  } catch {
    return emptyAuth
  }
}

function saveSession(state: AuthState) {
  try {
    if (state.refreshToken) localStorage.setItem(SESSION_KEY, JSON.stringify(state))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Private browsing or full storage: the session just won't survive a reload.
  }
}

export const store = configureStore({
  reducer: { auth: authReducer },
  preloadedState: { auth: loadSession() },
})

let lastAuth = store.getState().auth
store.subscribe(() => {
  const auth = store.getState().auth
  if (auth !== lastAuth) {
    lastAuth = auth
    saveSession(auth)
  }
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
