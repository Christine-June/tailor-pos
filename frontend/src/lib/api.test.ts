import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, api, configureApi } from "./api"

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const expired = () => json(401, { error: { code: "token_expired", message: "Session expired.", details: null } })

describe("api client", () => {
  let access: string | null
  let ended: number
  const fetchMock = vi.fn()

  beforeEach(() => {
    access = "old-access"
    ended = 0
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    configureApi({
      getAccessToken: () => access,
      getRefreshToken: () => "refresh",
      onAccessToken: (t) => {
        access = t
      },
      onSessionEnded: () => {
        ended += 1
      },
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it("sends the access token", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }))
    await api.get("/customers")
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("/api/customers")
    expect(init.headers.Authorization).toBe("Bearer old-access")
  })

  it("refreshes an expired token once and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(json(200, { access_token: "new-access" }))
      .mockResolvedValueOnce(json(200, { items: [] }))
    const data = await api.get<{ items: unknown[] }>("/customers")
    expect(data.items).toEqual([])
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/auth/refresh")
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer refresh")
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe("Bearer new-access")
    expect(access).toBe("new-access")
  })

  it("shares one refresh between simultaneous requests", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "/api/auth/refresh") return json(200, { access_token: "new-access" })
      const auth = (init.headers as Record<string, string>).Authorization
      return auth === "Bearer new-access" ? json(200, {}) : expired()
    })
    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")])
    const refreshes = fetchMock.mock.calls.filter(([url]) => url === "/api/auth/refresh")
    expect(refreshes).toHaveLength(1)
  })

  it("ends the session when the refresh token is rejected", async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(json(401, { error: { code: "unauthorized", message: "x" } }))
    await expect(api.get("/customers")).rejects.toMatchObject({ status: 401 })
    expect(ended).toBe(1)
  })

  it("ends the session immediately for a revoked account", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: "unauthorized", message: "Please sign in again." } }))
    await expect(api.get("/customers")).rejects.toBeInstanceOf(ApiError)
    expect(ended).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not sign out when offline during refresh", async () => {
    fetchMock.mockResolvedValueOnce(expired()).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(api.get("/customers")).rejects.toMatchObject({ code: "network" })
    expect(ended).toBe(0)
  })

  it("turns a network failure into a readable error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const err = (await api.get("/customers").catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.isNetwork).toBe(true)
    expect(err.message).toMatch(/internet/)
  })

  it("passes the server's error code and message through", async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: "overpayment", message: "Too much", details: { balance: "10.00" } } }))
    const err = await api.post("/orders/x/payments", {}).catch((e) => e)
    expect(err).toMatchObject({ status: 409, code: "overpayment", message: "Too much", details: { balance: "10.00" } })
  })

  it("handles a non-JSON error page", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }))
    const err = await api.get("/x").catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: "server_error" })
  })

  it("does not send a token for login", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}))
    await api.post("/auth/login", { email: "a", password: "b" }, { auth: false })
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined()
  })
})
