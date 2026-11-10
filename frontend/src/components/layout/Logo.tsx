import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="7" fill="currentColor" className="text-sidebar-active" />
      <circle cx="11" cy="21" r="3.2" fill="none" stroke="var(--brass)" strokeWidth="2" />
      <circle cx="21" cy="21" r="3.2" fill="none" stroke="var(--brass)" strokeWidth="2" />
      <path d="M13.2 18.6 22 8M18.8 18.6 10 8" stroke="#f5f1ea" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
