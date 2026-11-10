import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

import type { Customer, InventoryItem, JobCard } from "@/lib/types"
import { signedOut } from "./authSlice"

/**
 * Last copies of server data the shop needs while offline: the catalogue to sell from, customers
 * to attach to a sale, and the workshop board to read. Refreshed whenever the server answers.
 */
export interface Cached<T> {
  items: T[]
  savedAt: string
  shopId: string
}

export interface CacheState {
  catalog: Cached<InventoryItem> | null
  customers: Cached<Customer> | null
  board: (Cached<JobCard> & { today: string }) | null
}

export const emptyCache: CacheState = { catalog: null, customers: null, board: null }

const cacheSlice = createSlice({
  name: "cache",
  initialState: emptyCache,
  reducers: {
    catalogCached(state, action: PayloadAction<{ items: InventoryItem[]; shopId: string }>) {
      state.catalog = { ...action.payload, savedAt: new Date().toISOString() }
    },
    customersCached(state, action: PayloadAction<{ items: Customer[]; shopId: string }>) {
      state.customers = { ...action.payload, savedAt: new Date().toISOString() }
    },
    /** A customer added offline appears in offline searches straight away. */
    customerAdded(state, action: PayloadAction<Customer>) {
      if (state.customers && !state.customers.items.some((c) => c.id === action.payload.id)) state.customers.items.push(action.payload)
    },
    boardCached(state, action: PayloadAction<{ items: JobCard[]; today: string; shopId: string }>) {
      state.board = { ...action.payload, savedAt: new Date().toISOString() }
    },
  },
  // Customer details shouldn't stay on a shared device after sign-out.
  extraReducers: (builder) => builder.addCase(signedOut, () => emptyCache),
})

export const { catalogCached, customersCached, customerAdded, boardCached } = cacheSlice.actions
export default cacheSlice.reducer
