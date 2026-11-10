import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

import type { Cart, CartLine, SaleKind } from "@/lib/checkout"
import { formatQuantity, parseQuantity } from "@/lib/money"
import type { Customer, InventoryItem } from "@/lib/types"
import { uuid } from "@/lib/uuid"
import { signedOut } from "./authSlice"

export function emptyCart(kind: SaleKind = "retail"): Cart {
  return { saleId: uuid(), kind, lines: [], customer: null, measurementId: null, discount: "", dueDate: "", notes: "" }
}

const cartSlice = createSlice({
  name: "cart",
  initialState: emptyCart,
  reducers: {
    itemAdded(state, action: PayloadAction<{ item: InventoryItem; quantity: string }>) {
      const { item, quantity } = action.payload
      const existing = state.lines.find((l) => l.itemId === item.id && l.unitPrice === item.sell_price && !l.notes)
      if (existing) {
        const sum = (parseQuantity(existing.quantity) ?? 0n) + (parseQuantity(quantity) ?? 0n)
        existing.quantity = formatQuantity(sum)
        return
      }
      state.lines.push({
        key: uuid(),
        itemId: item.id,
        description: item.name,
        unit: item.unit,
        quantity,
        unitPrice: item.sell_price,
        listPrice: item.sell_price,
        trackStock: item.track_stock,
        available: item.track_stock ? item.quantity_on_hand : null,
        notes: "",
      })
    },
    customLineAdded(state, action: PayloadAction<{ description: string; quantity: string; unitPrice: string; notes?: string }>) {
      const { description, quantity, unitPrice, notes } = action.payload
      state.lines.push({
        key: uuid(),
        itemId: null,
        description,
        unit: null,
        quantity,
        unitPrice,
        listPrice: null,
        trackStock: false,
        available: null,
        notes: notes ?? "",
      })
    },
    lineChanged(state, action: PayloadAction<{ key: string; changes: Partial<Pick<CartLine, "quantity" | "unitPrice" | "notes" | "description">> }>) {
      const line = state.lines.find((l) => l.key === action.payload.key)
      if (line) Object.assign(line, action.payload.changes)
    },
    lineRemoved(state, action: PayloadAction<string>) {
      state.lines = state.lines.filter((l) => l.key !== action.payload)
    },
    kindChanged(state, action: PayloadAction<SaleKind>) {
      state.kind = action.payload
      if (action.payload === "retail") {
        state.measurementId = null
        state.dueDate = ""
      }
    },
    customerChosen(state, action: PayloadAction<{ customer: Customer | null; measurementId?: string | null }>) {
      state.customer = action.payload.customer
      state.measurementId = action.payload.customer ? (action.payload.measurementId ?? null) : null
    },
    measurementChosen(state, action: PayloadAction<string | null>) {
      state.measurementId = action.payload
    },
    detailsChanged(state, action: PayloadAction<Partial<Pick<Cart, "discount" | "dueDate" | "notes">>>) {
      Object.assign(state, action.payload)
    },
    /** After a sale is recorded, or when staff clear the cart. A fresh id means the next sale is a new order. */
    cartCleared(state) {
      return emptyCart(state.kind)
    },
  },
  // The next person to sign in on this device starts with an empty cart.
  extraReducers: (builder) => builder.addCase(signedOut, () => emptyCart()),
})

export const {
  itemAdded,
  customLineAdded,
  lineChanged,
  lineRemoved,
  kindChanged,
  customerChosen,
  measurementChosen,
  detailsChanged,
  cartCleared,
} = cartSlice.actions
export default cartSlice.reducer
