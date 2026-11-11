import { useEffect, useId, useRef, useState } from "react"

import { niceMax, smoothPath } from "@/lib/chart"

export interface Point {
  label: string
  /** Shown in the tooltip, e.g. "Mon 9 Nov". */
  detail: string
  value: number
  /** Formatted value for the tooltip. */
  display: string
}

const HEIGHT = 280
const PAD = { top: 16, right: 22, bottom: 28, left: 52 }

/**
 * One series as a smooth line over a soft blue fill. Hover or tap a day for its exact value;
 * a hidden table gives screen readers the same numbers.
 */
export function AreaChart({ points, formatAxis, caption }: { points: Point[]; formatAxis: (v: number) => string; caption: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [active, setActive] = useState<number | null>(null)
  const gradient = useId()

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(240, Math.floor(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const max = niceMax(Math.max(...points.map((p) => p.value), 0))
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1))
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / max) * plotH
  const coords = points.map((p, i) => [x(i), y(p.value)] as [number, number])
  const line = smoothPath(coords)
  const area = coords.length ? `${line} L${coords[coords.length - 1]![0]},${PAD.top + plotH} L${coords[0]![0]},${PAD.top + plotH} Z` : ""
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const shown = active ?? points.length - 1
  const tip = points[shown]

  function nearest(clientX: number) {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || points.length === 0) return
    const rel = clientX - rect.left - PAD.left
    const i = Math.round((rel / plotW) * (points.length - 1))
    setActive(Math.min(points.length - 1, Math.max(0, i)))
  }

  return (
    <figure className="relative min-w-0">
      <div
        ref={box}
        // The SVG takes its width from this box, never the other way round, so it fits any screen.
        className="relative w-full min-w-0 overflow-hidden select-none"
        onPointerMove={(e) => nearest(e.clientX)}
        onPointerDown={(e) => nearest(e.clientX)}
        onPointerLeave={() => setActive(null)}
        aria-hidden="true"
      >
        <svg width={width} height={HEIGHT} className="block max-w-full overflow-visible">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "4 4"} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#${gradient})`} />
          <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {tip && (
            <g>
              <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--primary)" strokeOpacity="0.35" />
              <circle cx={x(shown)} cy={y(tip.value)} r="5" fill="var(--card)" stroke="var(--primary)" strokeWidth="2.5" />
            </g>
          )}
          {points.map((p, i) => (
            <text key={p.detail} x={x(i)} y={HEIGHT - 6} textAnchor="middle" className={`text-[11px] ${i === shown ? "fill-foreground font-medium" : "fill-muted-foreground"}`}>
              {p.label}
            </text>
          ))}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border bg-card px-3 py-1.5 text-xs whitespace-nowrap shadow-md"
            style={{ left: Math.min(Math.max(x(shown), 70), width - 70), top: y(tip.value) - 10 }}
          >
            <p className="text-muted-foreground">{tip.detail}</p>
            <p className="font-semibold tabular-nums">{tip.display}</p>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.detail}>
              <th scope="row">{p.detail}</th>
              <td>{p.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
