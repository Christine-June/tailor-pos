import { combineReducers, configureStore } from "@reduxjs/toolkit"
import { useDispatch, useSelector } from "react-redux"

import { configureApi } from "@/lib/api"
import type { Cart } from "@/lib/checkout"
import { openStorage, requestPersistence, type KeyValueStore } from "@/lib/storage"
import authReducer, { accessTokenRefreshed, emptyAuth, signedOut, type AuthState } from "./authSlice"
import cacheReducer, { emptyCache, type CacheState } from "./cacheSlice"
import cartReducer, { emptyCart } from "./cartSlice"
import outboxReducer, { emptyOutbox, type OutboxState } from "./outboxSlice"
import { startSync } from "./syncRunner"

const rootReducer = combineReducers({ auth: authReducer, cart: cartReducer, outbox: outboxReducer, cache: cacheReducer })

export type RootState = ReturnType<typeof rootReducer>

export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({ reducer: rootReducer, preloadedState })
}

export type AppStore = ReturnType<typeof makeStore>
export type AppDispatch = AppStore["dispatch"]
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()

// Each slice is its own IndexedDB record, written only when that slice changes.
const KEYS = { auth: "session", cart: "cart", outbox: "outbox", cache: "cache" } as const
type Persisted = keyof typeof KEYS
// Money waits for nobody: the session and the outbox are written at once; the rest is batched.
const IMMEDIATE = new Set<Persisted>(["auth", "outbox"])

function validAuth(s: AuthState | undefined): s is AuthState {
  return !!s?.refreshToken && !!s.user
}
function validCart(c: Cart | undefined): c is Cart {
  return typeof c?.saleId === "string" && Array.isArray(c.lines)
}
function validOutbox(o: OutboxState | undefined): o is OutboxState {
  return Array.isArray(o?.entries) && Array.isArray(o?.recent)
}

/** Phase 2–5 kept the session and cart in localStorage. Move them over once. */
function readLegacy<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw) localStorage.removeItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

async function loadState(storage: KeyValueStore): Promise<Partial<RootState>> {
  const read = async <T,>(key: string) => {
    try {
      return await storage.get<T>(key)
    } catch {
      return undefined
    }
  }
  const auth = (await read<AuthState>(KEYS.auth)) ?? readLegacy<AuthState>("tailorpos.session.v1")
  const cart = (await read<Cart>(KEYS.cart)) ?? readLegacy<Cart>("tailorpos.cart.v1")
  const outbox = await read<OutboxState>(KEYS.outbox)
  const cache = await read<CacheState>(KEYS.cache)
  const signedIn = validAuth(auth)
  return {
    auth: signedIn ? auth : emptyAuth,
    cart: signedIn && validCart(cart) ? cart : emptyCart(),
    // The outbox survives sign-out: it holds sales the shop has already been paid for.
    outbox: validOutbox(outbox) ? outbox : emptyOutbox,
    cache: signedIn && cache ? cache : emptyCache,
  }
}

function persist(store: AppStore, storage: KeyValueStore) {
  let last = store.getState()
  const timers = new Map<Persisted, ReturnType<typeof setTimeout>>()
  // One write chain per key, so an older value can never land after a newer one.
  const chains = new Map<Persisted, Promise<void>>()

  function write(slice: Persisted) {
    timers.delete(slice)
    const value = store.getState()[slice]
    const keep = slice === "auth" ? !!(value as AuthState).refreshToken : true
    const previous = chains.get(slice) ?? Promise.resolve()
    const next = previous
      .then(() => (keep ? storage.set(KEYS[slice], value) : storage.del(KEYS[slice])))
      .catch((err) => console.error(`Couldn't save ${slice} on this device`, err))
    chains.set(slice, next)
  }

  store.subscribe(() => {
    const state = store.getState()
    for (const slice of Object.keys(KEYS) as Persisted[]) {
      if (state[slice] === last[slice]) continue
      if (IMMEDIATE.has(slice)) write(slice)
      else if (!timers.has(slice)) timers.set(slice, setTimeout(() => write(slice), 300))
    }
    last = state
  })

  // Flush batched writes if the tab is closed or hidden (e.g. the tablet sleeps).
  const flush = () => {
    for (const [slice, timer] of timers) {
      clearTimeout(timer)
      write(slice)
    }
  }
  window.addEventListener("pagehide", flush)
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush())
}

export async function initStore(): Promise<AppStore> {
  const storage = await openStorage()
  const store = makeStore(await loadState(storage))
  persist(store, storage)
  void requestPersistence()

  configureApi({
    getAccessToken: () => store.getState().auth.accessToken,
    getRefreshToken: () => store.getState().auth.refreshToken,
    onAccessToken: (token) => store.dispatch(accessTokenRefreshed(token)),
    onSessionEnded: () => store.dispatch(signedOut()),
  })
  startSync(store)
  return store
}
