/**
 * The one way the app talks to the server.
 * - Every failure becomes an ApiError with a code the UI can branch on and a message it can show.
 * - An expired access token is refreshed once (shared by concurrent requests) and the request retried.
 * - If the refresh token is rejected too, the session ends and the app returns to the login page.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }

  /** True when the request never reached the server, so retrying later may succeed. */
  get isNetwork() {
    return this.status === 0
  }
}

export interface SessionHooks {
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  onAccessToken: (token: string) => void
  onSessionEnded: () => void
}

const BASE = "/api"
const TIMEOUT_MS = 20_000

let hooks: SessionHooks | null = null
let refreshing: Promise<string | null> | null = null

export function configureApi(sessionHooks: SessionHooks) {
  hooks = sessionHooks
}

type Method = "GET" | "POST" | "PATCH" | "DELETE"

interface RequestOptions {
  body?: unknown
  signal?: AbortSignal
  /** Send the access token. Off for login. */
  auth?: boolean
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json()
    if (data?.error) {
      return new ApiError(res.status, data.error.code ?? "error", data.error.message ?? "Request failed", data.error.details)
    }
  } catch {
    // Not JSON: a proxy or gateway page. Fall through to a generic message.
  }
  if (res.status === 429) return new ApiError(429, "rate_limited", "Too many attempts. Wait a minute and try again.")
  if (res.status >= 500) return new ApiError(res.status, "server_error", "The server had a problem. Try again in a moment.")
  return new ApiError(res.status, "error", `Request failed (${res.status})`)
}

async function send(method: Method, path: string, token: string | null, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  if (token) headers.Authorization = `Bearer ${token}`

  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  try {
    return await fetch(BASE + path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new ApiError(0, "network", "Can't reach the server. Check the internet connection.")
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = hooks?.getRefreshToken()
  if (!refreshToken) return null
  try {
    const res = await send("POST", "/auth/refresh", refreshToken, {})
    if (!res.ok) return null
    const data = (await res.json()) as { access_token: string }
    hooks?.onAccessToken(data.access_token)
    return data.access_token
  } catch (err) {
    // Offline is not a reason to sign the user out.
    if (err instanceof ApiError && err.isNetwork) throw err
    return null
  }
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const useAuth = opts.auth !== false
  let res = await send(method, path, useAuth ? (hooks?.getAccessToken() ?? null) : null, opts)

  if (res.status === 401 && useAuth) {
    const error = await parseError(res)
    if (error.code !== "token_expired") {
      hooks?.onSessionEnded()
      throw error
    }
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null
    })
    const token = await refreshing
    if (!token) {
      hooks?.onSessionEnded()
      throw new ApiError(401, "unauthorized", "Your session ended. Sign in again.")
    }
    res = await send(method, path, token, opts)
    if (res.status === 401) {
      hooks?.onSessionEnded()
      throw await parseError(res)
    }
  }

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>("PATCH", path, { ...opts, body }),
}

/** A message safe to show to staff for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return "Something went wrong. Try again."
}
