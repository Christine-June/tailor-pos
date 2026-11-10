import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h2 className="mt-2 text-2xl font-semibold">This page doesn't exist</h2>
      <p className="mt-2 text-muted-foreground">Check the address, or go back to the start.</p>
      <Button asChild className="mt-6">
        <Link to="/">Go to start</Link>
      </Button>
    </div>
  )
}
