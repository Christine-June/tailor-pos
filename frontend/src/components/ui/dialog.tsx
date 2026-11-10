import { useEffect, useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** Block closing (e.g. while a payment is being sent). */
  dismissible?: boolean
}

/**
 * Modal dialog. A bottom sheet on phones, centred on larger screens.
 * Escape and the backdrop close it; focus moves in on open and back out on close.
 */
export function Dialog({ open, onClose, title, description, children, footer, className, dismissible = true }: DialogProps) {
  const titleId = useId()
  const descId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const dismissRef = useRef(dismissible)
  dismissRef.current = dismissible

  useEffect(() => {
    if (!open) return
    const active = document.activeElement as HTMLElement | null
    const previous = active && !panel.current?.contains(active) ? active : null
    const { overflow } = document.body.style
    document.body.style.overflow = "hidden"
    // React's autoFocus has already run for a field inside; otherwise focus the panel itself.
    if (!panel.current?.contains(document.activeElement)) {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current
      target?.focus()
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissRef.current) {
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45 animate-in fade-in duration-150" onClick={() => dismissible && onClose()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-xl bg-card text-card-foreground shadow-xl outline-none animate-in slide-in-from-bottom-4 duration-200 sm:max-w-md sm:rounded-xl sm:slide-in-from-bottom-0 sm:zoom-in-95",
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
