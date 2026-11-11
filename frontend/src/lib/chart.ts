/** Small, dependency-free helpers for the dashboard charts. */

/** Round a maximum up to a tidy axis top, e.g. 23,480 -> 25,000; 7 -> 8. */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * power >= value) return step * power
  }
  return 10 * power
}

/**
 * A smooth line through the points that never overshoots (monotone cubic), so a day with no sales
 * never dips below zero on the chart.
 */
export function smoothPath(points: [number, number][]): string {
  const n = points.length
  if (n === 0) return ""
  if (n === 1) return `M${points[0]![0]},${points[0]![1]}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]![0] - points[i]![0])
    slope.push((points[i + 1]![1] - points[i]![1]) / dx[i]!)
  }
  const tangent: number[] = [slope[0]!]
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!
    const b = slope[i]!
    tangent.push(a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b))
  }
  tangent.push(slope[n - 2]!)
  let d = `M${points[0]![0]},${points[0]![1]}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!
    const [x1, y1] = points[i + 1]!
    const h = dx[i]! / 3
    d += ` C${x0 + h},${y0 + tangent[i]! * h} ${x1 - h},${y1 - tangent[i + 1]! * h} ${x1},${y1}`
  }
  return d
}

/** Percentage change, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}
