import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import { formatDate, formatDateTime, formatPhone, METHOD_LABEL, trimZeros } from "@/lib/format"
import { cents, formatMoney } from "@/lib/money"
import { offlineRef } from "@/lib/offline"
import type { Order, Shop } from "@/lib/types"

/**
 * The customer receipt, laid out like the thermal one. On screen it's a preview; when printing,
 * a print stylesheet hides the app and prints only #print-root at receipt width.
 */
export function Receipt({ order, shop }: { order: Order; shop: Shop }) {
  const cur = shop.currency
  const balance = cents(order.balance)
  const qty = trimZeros
  return (
    <div className="receipt mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <p className="text-[14px] font-bold">{shop.name}</p>
        {shop.address && <p>{shop.address}</p>}
        {shop.phone && <p>{shop.phone}</p>}
        {shop.kra_pin && <p>PIN: {shop.kra_pin}</p>}
      </div>
      <div className="mt-3 flex justify-between">
        <span>{order.kind === "bespoke" ? "Order" : "Receipt"}</span>
        {/* An offline sale has no number until it syncs; the reference ties the two together. */}
        <span>{order.number ? `#${order.number}` : `Ref ${offlineRef(order.id)}`}</span>
      </div>
      {!order.number && <p>Saved offline; order number to follow</p>}
      <p>{formatDateTime(order.created_at, shop.timezone)}</p>
      {order.customer && (
        <>
          <p>Customer: {order.customer.full_name}</p>
          {order.customer.phone && <p>Phone: {formatPhone(order.customer.phone)}</p>}
        </>
      )}
      {order.created_by && <p>Served by: {order.created_by}</p>}
      <hr className="my-2 border-dashed border-black" />
      {order.items.map((item) => (
        <div key={item.id} className="mb-1">
          <p>{item.description}</p>
          <div className="flex justify-between pl-2">
            <span>
              {qty(item.quantity)}
              {item.unit ? ` ${item.unit}` : ""} x {formatMoney(item.unit_price, "").trim()}
            </span>
            <span>{formatMoney(item.line_total, "").trim()}</span>
          </div>
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      {cents(order.discount) > 0n && (
        <>
          <Row label="Subtotal" value={formatMoney(order.subtotal, cur)} />
          <Row label="Discount" value={"-" + formatMoney(order.discount, cur)} />
        </>
      )}
      <Row label="TOTAL" value={formatMoney(order.total, cur)} bold />
      {shop.vat_registered && cents(order.tax_amount) > 0n && <Row label={`Includes VAT ${qty(shop.vat_rate)}%`} value={formatMoney(order.tax_amount, cur)} />}
      <div className="mt-2" />
      {order.payments.map((p) => (
        <div key={p.id}>
          <Row label={`${p.kind === "refund" ? "Refund " : ""}${METHOD_LABEL[p.method] ?? p.method}${p.reference ? " " + p.reference : ""}`} value={formatMoney(p.amount, cur)} />
          {p.change && cents(p.change) > 0n && <Row label="  Change" value={formatMoney(p.change, cur)} />}
        </div>
      ))}
      <Row label="Paid" value={formatMoney(order.amount_paid, cur)} />
      {balance > 0n ? (
        <div className="mt-2 text-center font-bold">
          <p>BALANCE DUE</p>
          <p className="text-[16px]">{formatMoney(balance, cur)}</p>
        </div>
      ) : (
        <Row label="Balance" value={formatMoney(0n, cur)} bold />
      )}
      {order.due_date && <p className="mt-2 font-bold">Collection: {formatDate(order.due_date)}</p>}
      <p className="mt-3 text-center">{shop.receipt_footer || "Thank you"}</p>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}>
      <span className="whitespace-pre">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

/** Mounts a document where the print stylesheet looks for it. Only one may be mounted at a time. */
export function PrintRoot({ children }: { children: ReactNode }) {
  return createPortal(
    <div id="print-root" aria-hidden="true">
      {children}
    </div>,
    document.body,
  )
}

export function PrintableReceipt({ order, shop }: { order: Order; shop: Shop }) {
  return (
    <PrintRoot>
      <Receipt order={order} shop={shop} />
    </PrintRoot>
  )
}
