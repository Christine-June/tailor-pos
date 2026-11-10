import { formatDate, formatDateTime, trimZeros } from "@/lib/format"
import { groupValues, type FieldDef } from "@/lib/measurements"
import type { JobCard } from "@/lib/types"

/** The workshop ticket: what to make and the exact measurements. Never shows prices. */
export function JobCardDoc({ card, fields, timeZone }: { card: JobCard; fields: FieldDef[]; timeZone: string }) {
  const m = card.measurement
  return (
    <div className="receipt mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
      <p className="text-center text-[18px] font-bold">JOB #{card.number}</p>
      <p className="mt-2 font-bold">{card.customer_name}</p>
      {card.due_date && <p className="font-bold">Due: {formatDate(card.due_date)}</p>}
      {card.assigned_to && <p>Tailor: {card.assigned_to.name}</p>}
      <hr className="my-2 border-dashed border-black" />
      {card.items.map((item, i) => (
        <div key={i} className="mb-1">
          <p>
            {trimZeros(item.quantity)} {item.description}
          </p>
          {item.notes && <p className="pl-2">{item.notes}</p>}
        </div>
      ))}
      {card.notes && (
        <>
          <hr className="my-2 border-dashed border-black" />
          <p>{card.notes}</p>
        </>
      )}
      {m && (
        <>
          <hr className="my-2 border-dashed border-black" />
          <p className="font-bold">MEASUREMENTS ({m.unit})</p>
          <p>Taken {formatDateTime(m.recorded_at, timeZone)}</p>
          {groupValues(m.values, fields).flatMap((g) =>
            g.rows.map((r) => (
              <div key={r.key} className="flex justify-between">
                <span>{r.label}</span>
                <span>{r.value}</span>
              </div>
            )),
          )}
          {m.notes && <p className="mt-1">{m.notes}</p>}
        </>
      )}
    </div>
  )
}
