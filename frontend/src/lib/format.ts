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

/** "3.500" -> "3.5", "16.00" -> "16"; whole numbers without a decimal point are left alone. */
export function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value
}

export const METHOD_LABEL: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", bank: "Bank", other: "Other" }
