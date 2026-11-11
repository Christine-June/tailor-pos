import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

import type { LoginResponse, Shop, User } from "@/lib/types"

export interface AuthState {
  user: User | null
  shop: Shop | null
  accessToken: string | null
  refreshToken: string | null
}

export const emptyAuth: AuthState = { user: null, shop: null, accessToken: null, refreshToken: null }

const authSlice = createSlice({
  name: "auth",
  initialState: emptyAuth,
  reducers: {
    signedIn(_state, action: PayloadAction<LoginResponse>) {
      const { user, shop, access_token, refresh_token } = action.payload
      return { user, shop, accessToken: access_token, refreshToken: refresh_token }
    },
    accessTokenRefreshed(state, action: PayloadAction<string>) {
      state.accessToken = action.payload
    },
    /** After a password change: this device keeps working, every other device is signed out. */
    tokensReplaced(state, action: PayloadAction<{ access_token: string; refresh_token: string }>) {
      state.accessToken = action.payload.access_token
      state.refreshToken = action.payload.refresh_token
    },
    sessionUpdated(state, action: PayloadAction<{ user: User; shop: Shop }>) {
      state.user = action.payload.user
      state.shop = action.payload.shop
    },
    signedOut() {
      return emptyAuth
    },
  },
})

export const { signedIn, accessTokenRefreshed, tokensReplaced, sessionUpdated, signedOut } = authSlice.actions
export default authSlice.reducer
