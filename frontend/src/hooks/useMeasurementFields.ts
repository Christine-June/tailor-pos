import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import type { FieldDef } from "@/lib/measurements"

// The catalogue never changes while the app is open, so fetch it once.
let cache: FieldDef[] | null = null
let pending: Promise<FieldDef[]> | null = null

export function useMeasurementFields(): FieldDef[] | null {
  const [fields, setFields] = useState(cache)
  useEffect(() => {
    if (cache) return
    pending ??= api
      .get<{ items: FieldDef[] }>("/measurement-fields")
      .then((r) => (cache = r.items))
      .finally(() => {
        pending = null
      })
    let alive = true
    pending.then((f) => alive && setFields(f)).catch(() => alive && setFields([]))
    return () => {
      alive = false
    }
  }, [])
  return fields
}
