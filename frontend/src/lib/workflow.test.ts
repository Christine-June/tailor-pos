import { describe, expect, it } from "vitest"

import { allowedMoves, canMove, dueState, moveCard, moveLabel } from "./workflow"

describe("workflow", () => {
  it("allows the normal path through the workshop", () => {
    expect(canMove("tailor", "bespoke", "confirmed", "cutting")).toBe(true)
    expect(canMove("tailor", "bespoke", "cutting", "stitching")).toBe(true)
    expect(canMove("tailor", "bespoke", "fitting", "alterations")).toBe(true)
    expect(canMove("tailor", "bespoke", "alterations", "ready")).toBe(true)
  })

  it("blocks skipped steps, retail sales and repeats", () => {
    expect(canMove("owner", "bespoke", "confirmed", "stitching")).toBe(false)
    expect(canMove("owner", "retail", "confirmed", "cutting")).toBe(false)
    expect(canMove("owner", "bespoke", "cutting", "cutting")).toBe(false)
  })

  it("keeps tailors to the workshop and reopening to the owner", () => {
    expect(canMove("tailor", "bespoke", "ready", "completed")).toBe(false)
    expect(canMove("cashier", "bespoke", "ready", "completed")).toBe(true)
    expect(canMove("tailor", "bespoke", "draft", "confirmed")).toBe(false)
    expect(canMove("cashier", "bespoke", "completed", "alterations")).toBe(false)
    expect(canMove("owner", "bespoke", "completed", "alterations")).toBe(true)
  })

  it("lists the moves each role may make", () => {
    expect(allowedMoves("tailor", "bespoke", "ready")).toEqual(["alterations", "fitting"])
    expect(allowedMoves("cashier", "bespoke", "ready")).toEqual(["alterations", "fitting", "completed"])
    expect(allowedMoves("owner", "bespoke", "cancelled")).toEqual([])
  })

  it("labels moves in plain words", () => {
    expect(moveLabel("confirmed", "cutting")).toBe("Start cutting")
    expect(moveLabel("stitching", "cutting")).toBe("Back to cutting")
    expect(moveLabel("ready", "completed")).toBe("Hand over to customer")
    expect(moveLabel("draft", "confirmed")).toBe("Confirm order")
  })

  it("flags due dates", () => {
    expect(dueState("2026-11-09", "2026-11-10")).toBe("overdue")
    expect(dueState("2026-11-10", "2026-11-10")).toBe("today")
    expect(dueState("2026-11-12", "2026-11-10")).toBe("soon")
    expect(dueState("2026-11-13", "2026-11-10")).toBeNull()
    expect(dueState("2026-11-09", "2026-11-10", "ready")).toBeNull()
    expect(dueState("2026-12-01", "2026-11-30")).toBe("soon")
    expect(dueState(null, "2026-11-10")).toBeNull()
  })

  it("moves a card without touching the others", () => {
    const cards = [
      { id: "a", status: "cutting" as const },
      { id: "b", status: "confirmed" as const },
    ]
    const moved = moveCard(cards, "a", "stitching")
    expect(moved).toEqual([
      { id: "a", status: "stitching" },
      { id: "b", status: "confirmed" },
    ])
    expect(cards[0]!.status).toBe("cutting")
  })
})
