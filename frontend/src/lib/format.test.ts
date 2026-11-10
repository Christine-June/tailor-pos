import { describe, expect, it } from "vitest"

import { normalizeKenyanPhone, searchCustomers } from "./format"

describe("phone numbers", () => {
  it("stores Kenyan numbers the way the server does", () => {
    expect(normalizeKenyanPhone("0712 345 678")).toBe("+254712345678")
    expect(normalizeKenyanPhone("254112345678")).toBe("+254112345678")
    expect(normalizeKenyanPhone("712-345-678")).toBe("+254712345678")
    expect(normalizeKenyanPhone("+44 20 7946 0958")).toBe("+442079460958")
    expect(normalizeKenyanPhone("12ab")).toBeNull()
  })
})

describe("offline customer search", () => {
  const people = [
    { first_name: "Wanjiru", last_name: "Kamau", full_name: "Wanjiru Kamau", phone: "+254722111222", email: null },
    { first_name: "Amina", last_name: "Hassan", full_name: "Amina Hassan", phone: "+254711666777", email: "amina@example.com" },
    { first_name: "Old", last_name: "Record", full_name: "Old Record", phone: null, email: null, archived: true },
  ]

  it("finds by name, phone as typed locally, or email", () => {
    expect(searchCustomers(people, "kamau").map((c) => c.first_name)).toEqual(["Wanjiru"])
    expect(searchCustomers(people, "0711 666").map((c) => c.first_name)).toEqual(["Amina"])
    expect(searchCustomers(people, "example.com").map((c) => c.first_name)).toEqual(["Amina"])
  })

  it("lists everyone alphabetically without a search, skipping archived", () => {
    expect(searchCustomers(people, "").map((c) => c.first_name)).toEqual(["Amina", "Wanjiru"])
  })
})
