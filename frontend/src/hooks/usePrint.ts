import { useEffect, useState } from "react"

/**
 * Browser printing of one document at a time: set the document, it mounts into #print-root,
 * the print dialog opens, and it unmounts again afterwards.
 */
export function usePrint<T extends string>() {
  const [printing, setPrinting] = useState<T | null>(null)
  useEffect(() => {
    if (!printing) return
    // Let React mount the document before the print dialog snapshots the page.
    const timer = setTimeout(() => {
      window.print()
      setPrinting(null)
    }, 50)
    return () => clearTimeout(timer)
  }, [printing])
  return [printing, setPrinting] as const
}
