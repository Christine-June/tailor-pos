import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { GripVertical, Printer, RefreshCw, Search, StickyNote, UserRound } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { JobCardDoc } from "@/components/JobCardDoc"
import { PrintRoot } from "@/components/Receipt"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useMeasurementFields } from "@/hooks/useMeasurementFields"
import { usePrint } from "@/hooks/usePrint"
import { ApiError, api, errorMessage, isRetryable } from "@/lib/api"
import { formatDate, formatDateTime, STATUS_LABEL, trimZeros } from "@/lib/format"
import { useAppDispatch, useAppSelector } from "@/store"
import { boardCached } from "@/store/cacheSlice"
import { groupValues } from "@/lib/measurements"
import type { JobCard, OrderStatus, Role, Shop } from "@/lib/types"
import { cn } from "@/lib/utils"
import { allowedMoves, BOARD_COLUMNS, canMove, COLUMN_TITLE, dueState, moveCard, moveLabel } from "@/lib/workflow"

const REFRESH_MS = 30_000

interface DragState {
  id: string
  from: OrderStatus
  x: number
  y: number
  offsetX: number
  offsetY: number
  width: number
  over: OrderStatus | null
}

export function WorkshopBoard({ role, userId, shop }: { role: Role; userId: string; shop: Shop }) {
  const navigate = useNavigate()
  const fields = useMeasurementFields()
  const [cards, setCards] = useState<JobCard[] | null>(null)
  const [today, setToday] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null)
  const [query, setQuery] = useState("")
  // Off by default: unassigned jobs are common, and a board that looks empty hides work.
  const [mine, setMine] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [open, setOpen] = useState<JobCard | null>(null)
  const [printing, setPrinting] = usePrint<"job">()
  const pending = useRef(new Set<string>())
  const press = useRef<{ id: string; from: OrderStatus; startX: number; startY: number; rect: DOMRect; pointerId: number } | null>(null)
  const justDragged = useRef(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dispatch = useAppDispatch()
  const [staleSince, setStaleSince] = useState<string | null>(null)
  const board = useAppSelector((s) => (s.cache.board?.shopId === shop.id ? s.cache.board : null))
  const cachedBoard = useRef(board)
  cachedBoard.current = board

  const showToast = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    setToast({ text, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), tone === "warn" ? 6000 : 2500)
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<{ items: JobCard[]; today: string }>("/workshop/board", { signal })
      setToday(data.today)
      setError(null)
      setStaleSince(null)
      dispatch(boardCached({ items: data.items, today: data.today, shopId: shop.id }))
      // A card mid-move keeps its local position until the server answers.
      setCards((current) => {
        if (!current || pending.current.size === 0) return data.items
        const local = new Map(current.map((c) => [c.id, c]))
        return data.items.map((c) => (pending.current.has(c.id) ? (local.get(c.id) ?? c) : c))
      })
    } catch (err) {
      if (signal?.aborted) return
      const cached = cachedBoard.current
      // Offline: show the last board saved on this device instead of an error.
      if (isRetryable(err) && cached) {
        setCards((current) => current ?? cached.items)
        setToday((t) => t || cached.today)
        setStaleSince(cached.savedAt)
      } else setError(errorMessage(err))
    }
  }, [dispatch, shop.id])

  // Picks up moves made by other people: every 30 s while visible, and when the tab regains focus.
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !press.current) void load()
    }, REFRESH_MS)
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => {
      controller.abort()
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      clearTimeout(toastTimer.current)
    }
  }, [load])

  async function move(card: JobCard, to: OrderStatus) {
    if (!canMove(role, "bespoke", card.status, to)) {
      showToast(`#${card.number} can't go from ${STATUS_LABEL[card.status]} to ${STATUS_LABEL[to]}.`, "warn")
      return
    }
    const from = card.status
    pending.current.add(card.id)
    setCards((cs) => (cs ? moveCard(cs, card.id, to) : cs))
    try {
      await api.post(`/orders/${card.id}/transition`, { to_status: to, from_status: from })
      showToast(`#${card.number} moved to ${COLUMN_TITLE[to] ?? STATUS_LABEL[to]}.`)
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale_status") {
        // Someone else moved it first: show where it really is rather than overwrite their move.
        const current = (err.details as { current_status?: OrderStatus } | null)?.current_status
        setCards((cs) =>
          cs ? (current && BOARD_COLUMNS.includes(current) ? moveCard(cs, card.id, current) : cs.filter((c) => c.id !== card.id)) : cs,
        )
        showToast(`Someone else already moved #${card.number} to ${current ? STATUS_LABEL[current] : "another stage"}. The board is up to date now.`, "warn")
      } else {
        setCards((cs) => (cs ? moveCard(cs, card.id, from) : cs))
        showToast(err instanceof ApiError && err.isNetwork ? `No connection: #${card.number} wasn't moved.` : errorMessage(err), "warn")
      }
    } finally {
      pending.current.delete(card.id)
      void load()
    }
  }

  // Pointer-based drag: works the same for mouse, pen and touch. On touch, only the grip starts a
  // drag, so swiping across the board still scrolls it.
  function onPointerDown(event: ReactPointerEvent, card: JobCard) {
    if (event.button !== 0) return
    const fromHandle = (event.target as HTMLElement).closest("[data-handle]")
    if (event.pointerType !== "mouse" && !fromHandle) return
    if ((event.target as HTMLElement).closest("select")) return
    const el = (event.currentTarget as HTMLElement)
    press.current = { id: card.id, from: card.status, startX: event.clientX, startY: event.clientY, rect: el.getBoundingClientRect(), pointerId: event.pointerId }
    if (fromHandle) event.preventDefault()
  }

  // Refs, not state, inside the window listeners: a fast flick can end before React re-renders,
  // and the drop must still see that a drag happened and which cards exist.
  const dragRef = useRef<DragState | null>(null)
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const moveRef = useRef(move)
  moveRef.current = move

  useEffect(() => {
    function columnAt(x: number, y: number): OrderStatus | null {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]")
      return (el?.dataset.column as OrderStatus | undefined) ?? null
    }
    function onMove(event: PointerEvent) {
      const p = press.current
      if (!p || event.pointerId !== p.pointerId) return
      if (!dragRef.current && Math.hypot(event.clientX - p.startX, event.clientY - p.startY) < 6) return
      event.preventDefault()
      const board = boardRef.current
      if (board) {
        const r = board.getBoundingClientRect()
        if (event.clientX < r.left + 48) board.scrollBy({ left: -18 })
        else if (event.clientX > r.right - 48) board.scrollBy({ left: 18 })
      }
      dragRef.current = {
        id: p.id,
        from: p.from,
        x: event.clientX,
        y: event.clientY,
        offsetX: p.startX - p.rect.left,
        offsetY: p.startY - p.rect.top,
        width: p.rect.width,
        over: columnAt(event.clientX, event.clientY),
      }
      setDrag(dragRef.current)
    }
    function onUp(event: PointerEvent) {
      const p = press.current
      if (!p || event.pointerId !== p.pointerId) return
      press.current = null
      if (!dragRef.current) return
      dragRef.current = null
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
      setDrag(null)
      const target = columnAt(event.clientX, event.clientY)
      const card = cardsRef.current?.find((c) => c.id === p.id)
      if (card && target && target !== card.status) void moveRef.current(card, target)
    }
    function onCancel() {
      press.current = null
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
    }
  }, [])

  if (error && !cards) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-3" onClick={() => void load()}>
          <RefreshCw /> Try again
        </Button>
      </div>
    )
  }

  const term = query.trim().toLowerCase()
  const visible = (cards ?? []).filter(
    (c) =>
      (!mine || c.assigned_to?.id === userId) &&
      (!term || String(c.number) === term.replace("#", "") || c.customer_name.toLowerCase().includes(term) || c.items.some((i) => i.description.toLowerCase().includes(term))),
  )
  const dragged = drag ? cards?.find((c) => c.id === drag.id) : null

  return (
    <div className={cn("flex flex-col gap-3", drag && "cursor-grabbing select-none")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Job number, customer or item" className="pl-9" aria-label="Search jobs" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4" />
          Only my jobs
        </label>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      {staleSince ? (
        <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
          Offline: this is the board as it was at {formatDateTime(staleSince, shop.timezone)}. Moving cards needs the internet.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Drag a card to the next stage, or use its “Move to” menu. On a touchscreen, drag by the ⋮⋮ grip.</p>
      )}

      {cards === null ? (
        <div className="grid grid-flow-col gap-3 overflow-hidden" aria-busy="true">
          {BOARD_COLUMNS.map((c) => (
            <div key={c} className="h-72 w-64 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div ref={boardRef} className="-mx-4 grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-3 md:-mx-6 md:px-6">
          {BOARD_COLUMNS.map((status) => {
            const column = visible.filter((c) => c.status === status)
            const allowed = drag ? drag.from === status || canMove(role, "bespoke", drag.from, status) : true
            return (
              <section
                key={status}
                data-column={status}
                aria-label={COLUMN_TITLE[status]}
                className={cn(
                  "flex min-h-[60dvh] flex-col rounded-xl border bg-muted/50 transition-colors",
                  drag && !allowed && "opacity-40",
                  drag && allowed && drag.from !== status && "border-dashed border-primary/50",
                  drag?.over === status && allowed && drag.from !== status && "border-solid border-primary bg-primary/5",
                  status === "ready" && "bg-success/5",
                )}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <h3 className="text-sm font-semibold">{COLUMN_TITLE[status]}</h3>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium tabular-nums">{column.length}</span>
                </header>
                <ul className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {column.map((card) => (
                    <BoardCard
                      key={card.id}
                      card={card}
                      today={today}
                      role={role}
                      dragging={drag?.id === card.id}
                      onPointerDown={(e) => onPointerDown(e, card)}
                      onOpen={() => {
                        if (justDragged.current) return
                        if (role === "tailor") setOpen(card)
                        else navigate(`/orders/${card.id}`)
                      }}
                      onMove={(to) => void move(card, to)}
                    />
                  ))}
                  {column.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted-foreground">No jobs</li>}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {drag && dragged && (
        <div className="pointer-events-none fixed z-50 rotate-2 opacity-95 shadow-2xl" style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}>
          <CardBody card={dragged} today={today} />
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2",
            toast.tone === "warn" ? "bg-warning text-black" : "bg-foreground text-background",
          )}
        >
          {toast.text}
        </div>
      )}

      {open && fields && (
        <Dialog
          open
          onClose={() => setOpen(null)}
          title={`Job #${open.number} · ${open.customer_name}`}
          description={`${STATUS_LABEL[open.status]}${open.due_date ? ` · due ${formatDate(open.due_date)}` : ""}`}
          className="sm:max-w-lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setPrinting("job")}>
                <Printer /> Print job card
              </Button>
              {allowedMoves(role, "bespoke", open.status)
                .filter((to) => BOARD_COLUMNS.includes(to))
                .map((to) => (
                  <Button
                    key={to}
                    onClick={() => {
                      void move(open, to)
                      setOpen(null)
                    }}
                  >
                    {moveLabel(open.status, to)}
                  </Button>
                ))}
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <ul className="space-y-1">
              {open.items.map((item, i) => (
                <li key={i}>
                  <span className="font-medium">{trimZeros(item.quantity)} × {item.description}</span>
                  {item.notes && <span className="block text-muted-foreground">{item.notes}</span>}
                </li>
              ))}
            </ul>
            {open.notes && <p className="rounded-md bg-accent px-3 py-2 text-accent-foreground">{open.notes}</p>}
            {open.measurement ? (
              <div>
                <h4 className="mb-2 font-semibold">
                  Measurements ({open.measurement.unit}) · {open.measurement.label || "fitting"}
                </h4>
                {groupValues(open.measurement.values, fields).map((g) => (
                  <dl key={g.group} className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1">
                    {g.rows.map((r) => (
                      <div key={r.key} className="flex justify-between border-b border-dashed pb-0.5">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd className="font-medium tabular-nums">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No measurements linked to this job yet. Ask the front desk.</p>
            )}
          </div>
        </Dialog>
      )}
      {printing === "job" && open && fields && (
        <PrintRoot>
          <JobCardDoc card={open} fields={fields} timeZone={shop.timezone} />
        </PrintRoot>
      )}
    </div>
  )
}

function CardBody({ card, today, menuSpace = false }: { card: JobCard; today: string; menuSpace?: boolean }) {
  const due = dueState(card.due_date, today, card.status)
  return (
    <div className="rounded-lg border bg-card p-3 text-left shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">#{card.number}</span>
        {card.due_date && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px] font-medium",
              due === "overdue" ? "bg-destructive/10 text-destructive" : due === "today" || due === "soon" ? "bg-warning/20 text-warning-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {due === "overdue" ? "Overdue " : due === "today" ? "Today " : ""}
            {due !== "today" && formatDate(card.due_date).replace(/^\w+, /, "").replace(/ \d{4}$/, "")}
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-sm font-medium">{card.customer_name}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{card.items.map((i) => i.description).join(", ")}</p>
      <div className={cn("mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground", menuSpace && "mb-7")}>
        {card.assigned_to ? (
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3" /> {card.assigned_to.name}
          </span>
        ) : (
          <span>Unassigned</span>
        )}
        {card.notes && <StickyNote className="size-3" aria-label="Has notes" />}
        {!card.measurement && <span className="text-destructive">No measurements</span>}
      </div>
    </div>
  )
}

function BoardCard({
  card,
  today,
  role,
  dragging,
  onPointerDown,
  onOpen,
  onMove,
}: {
  card: JobCard
  today: string
  role: Role
  dragging: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onOpen: () => void
  onMove: (to: OrderStatus) => void
}) {
  const moves = allowedMoves(role, "bespoke", card.status).filter((to) => BOARD_COLUMNS.includes(to))
  return (
    <li className={cn("group relative select-none", dragging && "opacity-30")} onPointerDown={onPointerDown}>
      <button type="button" onClick={onOpen} className="block w-full cursor-grab rounded-lg text-left active:cursor-grabbing" aria-label={`Open job ${card.number}, ${card.customer_name}`}>
        <CardBody card={card} today={today} menuSpace={moves.length > 0} />
      </button>
      <span
        data-handle
        className="absolute top-1/2 right-1 flex h-10 w-6 -translate-y-1/2 touch-none items-center justify-center rounded text-muted-foreground/60 hover:bg-muted"
        aria-hidden="true"
      >
        <GripVertical className="size-4" />
      </span>
      {moves.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value as OrderStatus)}
          className="absolute bottom-2 left-3 h-6 max-w-[8rem] rounded border bg-card px-1 text-[11px] text-muted-foreground opacity-80 group-hover:opacity-100 focus:opacity-100"
          aria-label={`Move job ${card.number} to`}
        >
          <option value="">Move to…</option>
          {moves.map((to) => (
            <option key={to} value={to}>
              {COLUMN_TITLE[to]}
            </option>
          ))}
        </select>
      )}
    </li>
  )
}
