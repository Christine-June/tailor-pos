/**
 * Small key-value store on IndexedDB, which survives reloads and holds far more than localStorage
 * (an offline outbox and a full catalogue). Falls back to localStorage, then to memory, when
 * IndexedDB isn't available (some private-browsing modes), so the app always starts.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

const DB_NAME = "tailorpos"
const STORE = "kv"

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("IndexedDB blocked"))
  })
}

class IdbStore implements KeyValueStore {
  constructor(private readonly db: IDBDatabase) {}
  private tx(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE)
  }
  async get<T>(key: string) {
    return (await promisify(this.tx("readonly").get(key))) as T | undefined
  }
  async set(key: string, value: unknown) {
    await promisify(this.tx("readwrite").put(value, key))
  }
  async del(key: string) {
    await promisify(this.tx("readwrite").delete(key))
  }
}

class LocalStore implements KeyValueStore {
  async get<T>(key: string) {
    const raw = localStorage.getItem(`${DB_NAME}.${key}`)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  }
  async set(key: string, value: unknown) {
    localStorage.setItem(`${DB_NAME}.${key}`, JSON.stringify(value))
  }
  async del(key: string) {
    localStorage.removeItem(`${DB_NAME}.${key}`)
  }
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, unknown>()
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined
  }
  async set(key: string, value: unknown) {
    this.data.set(key, structuredClone(value))
  }
  async del(key: string) {
    this.data.delete(key)
  }
}

export async function openStorage(): Promise<KeyValueStore> {
  try {
    if (typeof indexedDB !== "undefined") {
      const store = new IdbStore(await openDb())
      await store.get("__probe__")
      return store
    }
  } catch {
    // Fall through to localStorage.
  }
  try {
    localStorage.setItem("__probe__", "1")
    localStorage.removeItem("__probe__")
    return new LocalStore()
  } catch {
    return new MemoryStore()
  }
}

/** Asks the browser not to evict our data under storage pressure. Unsynced sales live here. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // Not supported: nothing to do.
  }
}
