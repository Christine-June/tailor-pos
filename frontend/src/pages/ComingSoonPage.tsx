import { Hammer } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { NavItem } from "@/lib/nav"

/** Stand-in for pages built in later phases, so navigation and permissions can be tested now. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <div className="mx-auto max-w-2xl pt-6 md:pt-12">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <Badge variant="secondary">
              <Hammer aria-hidden="true" /> Built in phase {item.phase}
            </Badge>
          </div>
          <CardTitle className="text-xl">{item.label}</CardTitle>
          <CardDescription className="text-base">{item.summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The server side of this page is already built and tested. The screen arrives in phase {item.phase} of the checklist.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
