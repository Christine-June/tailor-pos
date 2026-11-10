/**
 * Money and quantities without floating point.
 * Amounts are bigint cents; quantities are bigint thousandths (the API allows 3 decimals, e.g. 2.375 m).
 * The server sends and receives both as decimal strings.
 */

const MONEY_RE = /^\d{1,10}(\.\d{0,2})?$/
const QTY_RE = /^\d{1,9}(\.\d{0,3})?$/

function parseScaled(text: string, decimals: number): bigint {
  const [whole = "0", frac = ""] = text.split(".")
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")
}

function formatScaled(value: bigint, decimals: number): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toString()
  const frac = (abs % base).toString().padStart(decimals, "0")
  return `${negative ? "-" : ""}${whole}${decimals ? "." + frac : ""}`
}

/** Cents from user input or an API string. Returns null for anything that isn't a valid non-negative amount. */
export function parseMoney(text: string | null | undefined): bigint | null {
  const value = (text ?? "").trim().replace(/,/g, "")
  if (!value || !MONEY_RE.test(value) || value === ".") return null
  return parseScaled(value, 2)
}

/** Cents from an API value that is known to be valid (e.g. "3500.00", "-200.00"). */
export function cents(text: string | null | undefined): bigint {
  const value = (text ?? "0").trim()
  if (value.startsWith("-")) return -(parseMoney(value.slice(1)) ?? 0n)
  return parseMoney(value) ?? 0n
}

/** "1234.50": the form the API expects. */
export function toApiMoney(value: bigint): string {
  return formatScaled(value, 2)
}

/** "KES 1,234.50" */
export function formatMoney(value: bigint | string, currency = "KES"): string {
  const amount = typeof value === "string" ? cents(value) : value
  const [whole, frac] = formatScaled(amount < 0n ? -amount : amount, 2).split(".")
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${amount < 0n ? "-" : ""}${currency} ${grouped}.${frac}`
}

/** Thousandths from user input. Returns null for invalid or zero quantities. */
export function parseQuantity(text: string | null | undefined): bigint | null {
  const value = (text ?? "").trim()
  if (!value || !QTY_RE.test(value) || value === ".") return null
  const parsed = parseScaled(value, 3)
  return parsed > 0n ? parsed : null
}

/** "2.5" rather than "2.500"; for display and for the API. */
export function formatQuantity(value: bigint): string {
  const text = formatScaled(value, 3)
  return text.replace(/\.?0+$/, "")
}

/** quantity x unit price, rounded half-up to the cent, exactly as the server does. */
export function lineTotal(quantity: bigint, unitPrice: bigint): bigint {
  const product = quantity * unitPrice // thousandths of a cent
  return (product + 500n) / 1000n
}

/** Rounded half-up percentage of an amount, as the server computes the deposit. */
export function percentOf(amount: bigint, percent: string): bigint {
  const pct = parseMoney(percent) ?? 0n // percent in hundredths
  return (amount * pct + 5000n) / 10000n
}

/** VAT already included in a VAT-inclusive amount, as the server computes it. */
export function includedVat(amount: bigint, ratePercent: string): bigint {
  const rate = parseMoney(ratePercent) ?? 0n // hundredths of a percent
  if (rate === 0n) return 0n
  const numerator = amount * rate
  const denominator = 10000n + rate
  return (numerator * 2n + denominator) / (denominator * 2n)
}
