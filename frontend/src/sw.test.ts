/**
 * Runs public/sw.js against fake browser APIs to check what it caches and when it falls back.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Handler = (event: { request: Request; respondWith: (p: Promise<Response>) => void; waitUntil: (p: Promise<unknown>) => void }) => void

class FakeCache {
  store = new Map<string, Response>()
  async match(req: Request | string) {
    const hit = this.store.get(typeof req === "string" ? new URL(req, "http://shop.test").href : req.url)
    return hit?.clone()
  }
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === "string" ? new URL(req, "http://shop.test").href : req.url, res)
  }
  async addAll(urls: string[]) {
    for (const u of urls) this.store.set(new URL(u, "http://shop.test").href, new Response(`precached ${u}`))
  }
}

function loadWorker(fetchImpl: (req: Request) => Promise<Response>) {
  const caches = new Map<string, FakeCache>()
  const listeners: Record<string, Handler> = {}
  const self = {
    location: { origin: "http://shop.test" },
    addEventListener: (type: string, fn: Handler) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const cacheStorage = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache())
      return caches.get(name)!
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  }
  const source = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8")
  new Function("self", "caches", "fetch", source)(self, cacheStorage, fetchImpl)

  async function dispatch(type: string, request?: Request) {
    let responded: Promise<Response> | undefined
    let waited: Promise<unknown> | undefined
    listeners[type]!({ request: request!, respondWith: (p) => (responded = p), waitUntil: (p) => (waited = p) })
    if (waited) await waited
    return responded ? await responded : undefined
  }
  return { dispatch, caches }
}

const navigate = (path: string) => {
  const req = new Request(`http://shop.test${path}`)
  Object.defineProperty(req, "mode", { value: "navigate" })
  return req
}

describe("service worker", () => {
  let online: boolean
  const network = vi.fn(async (req: Request) => {
    if (!online) throw new TypeError("Failed to fetch")
    return new Response(`fresh ${new URL(req.url).pathname}`)
  })

  beforeEach(() => {
    online = true
    network.mockClear()
  })

  it("precaches the app shell on install", async () => {
    const sw = loadWorker(network)
    await sw.dispatch("install")
    const shell = await sw.caches.get("tailorpos-shell-v1")!.match("/")
    expect(await shell!.text()).toBe("precached /")
  })

  it("opens any page offline from the saved shell", async () => {
    const sw = loadWorker(network)
    await sw.dispatch("install")
    await sw.dispatch("fetch", navigate("/orders/123")) // online: refreshes the saved shell
    online = false
    const res = await sw.dispatch("fetch", navigate("/sell"))
    expect(await res!.text()).toBe("fresh /orders/123")
  })

  it("keeps built assets after the first load", async () => {
    const sw = loadWorker(network)
    await sw.dispatch("fetch", new Request("http://shop.test/assets/index-abc.js"))
    online = false
    const res = await sw.dispatch("fetch", new Request("http://shop.test/assets/index-abc.js"))
    expect(await res!.text()).toBe("fresh /assets/index-abc.js")
  })

  it("never answers API calls from a cache", async () => {
    const sw = loadWorker(network)
    expect(await sw.dispatch("fetch", new Request("http://shop.test/api/orders"))).toBeUndefined()
    expect(await sw.dispatch("fetch", new Request("http://shop.test/api/orders", { method: "POST", body: "{}" }))).toBeUndefined()
  })

  it("removes caches from older versions on activate", async () => {
    const sw = loadWorker(network)
    sw.caches.set("tailorpos-shell-v0", new FakeCache())
    await sw.dispatch("activate")
    expect([...sw.caches.keys()]).not.toContain("tailorpos-shell-v0")
  })
})
