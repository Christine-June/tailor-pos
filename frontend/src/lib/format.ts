/** Dates and times in the shop's own timezone, whatever the device clock is set to. */
export function formatDateTime(iso: string, timeZone = "Africa/Nairobi"): string {
  return new Intl.DateTimeFormat("en-KE", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))
}

/** A calendar date ("2026-12-01") without shifting it through UTC. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Intl.DateTimeFormat("en-KE", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  )
}

/** Today's date in the shop's timezone as YYYY-MM-DD, for date inputs. */
export function todayIn(timeZone = "Africa/Nairobi"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

export function formatPhone(phone: string | null): string {
  if (!phone) return ""
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone
}

/**
 * Kenyan numbers to +254…, exactly as the server stores them (schemas.normalize_phone), so a
 * customer added offline matches the same person later. Returns null when the number is invalid.
 */
export function normalizeKenyanPhone(raw: string): string | null {
  let phone = raw.replace(/[\s\-().]/g, "")
  if (/^0[17]\d{8}$/.test(phone)) phone = "+254" + phone.slice(1)
  else if (/^254[17]\d{8}$/.test(phone)) phone = "+" + phone
  else if (/^[17]\d{8}$/.test(phone)) phone = "+254" + phone
  return /^\+?\d{7,15}$/.test(phone) ? phone : null
}

/** The same search the server does, over the customer list saved on this device. */
export function searchCustomers<T extends { first_name: string; last_name: string; full_name: string; phone: string | null; email: string | null; archived?: boolean }>(
  customers: T[],
  term: string,
  limit = 20,
): T[] {
  const text = term.trim().toLowerCase()
  const digits = text.replace(/\D/g, "").replace(/^0+/, "")
  return customers
    .filter((c) => !c.archived)
    .filter((c) => !text || c.full_name.toLowerCase().includes(text) || c.email?.toLowerCase().includes(text) || (digits !== "" && c.phone?.includes(digits)))
    .sort((a, b) => a.first_name.localeCompare(b.first_name) || a.last_name.localeCompare(b.last_name))
    .slice(0, limit)
}

/** "3.500" -> "3.5", "16.00" -> "16"; whole numbers without a decimal point are left alone. */
export function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cutting: "Cutting",
  stitching: "Stitching",
  fitting: "Fitting",
  alterations: "Alterations",
  ready: "Ready",
  completed: "Collected",
  cancelled: "Cancelled",
}

/** Short date like "10 Nov 2026" in the shop's timezone. */
export function formatDay(iso: string, timeZone = "Africa/Nairobi"): string {
  return new Intl.DateTimeFormat("en-KE", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso))
}

export const METHOD_LABEL: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", bank: "Bank", other: "Other" }
