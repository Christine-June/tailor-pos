import { useState } from "react"

import { cents, formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

interface Day {
  date: string
  net_takings: string
}

const weekday = (iso: string) => new Intl.DateTimeFormat("en-KE", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
const longDay = (iso: string) => new Intl.DateTimeFormat("en-KE", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))

/**
 * Net takings per day: one series, so one colour and no legend (the heading names it).
 * Hover or focus a day for its exact amount; screen readers get the same numbers as a table.
 */
export function TakingsChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null)
  const values = days.map((d) => cents(d.net_takings))
  const max = values.reduce((m, v) => (v > m ? v : m), 0n)
  // Refund-only days can be negative; draw them as empty rather than below the axis.
  const pct = (v: bigint) => (max > 0n && v > 0n ? Number((v * 1000n) / max) / 10 : 0)
  const shown = active ?? values.length - 1

  return (
    <figure className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <figcaption className="text-sm font-medium">Takings, last {days.length} days</figcaption>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {days[shown] && (
            <>
              {longDay(days[shown].date)}: <span className="font-semibold text-foreground tabular-nums">{formatMoney(values[shown]!)}</span>
            </>
          )}
        </p>
      </div>
      <div className="relative mt-4 h-40" aria-hidden="true" onMouseLeave={() => setActive(null)}>
        {/* Recessive guide at the top value; the baseline anchors the bars. */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
        {/* Left edge: today's bar is always on the right and would sit under the label. */}
        <span className="absolute -top-2.5 left-0 bg-card pr-1 text-[11px] text-muted-foreground tabular-nums">{formatMoney(max)}</span>
        <div className="absolute inset-x-0 bottom-0 border-t border-border" />
        <div className="absolute inset-0 flex items-end gap-2 px-1">
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              tabIndex={-1}
              className="group flex h-full flex-1 cursor-default items-end justify-center"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
            >
              <span
                className={cn(
                  "block w-full max-w-10 rounded-t-[4px] bg-primary/70 transition-colors",
                  (active === i || (active === null && i === days.length - 1)) && "bg-primary",
                )}
                style={{ height: `${pct(values[i]!)}%`, minHeight: values[i]! > 0n ? 2 : 0 }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 px-1 text-center text-[11px] text-muted-foreground" aria-hidden="true">
        {days.map((d, i) => (
          <span key={d.date} className={cn("flex-1", i === days.length - 1 && "font-medium text-foreground")}>
            {i === days.length - 1 ? "Today" : weekday(d.date)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Net takings per day</caption>
        <tbody>
          {days.map((d, i) => (
            <tr key={d.date}>
              <th scope="row">{longDay(d.date)}</th>
              <td>{formatMoney(values[i]!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
