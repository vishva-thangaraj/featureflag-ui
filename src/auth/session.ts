import createClient from 'openapi-fetch'
import type { components, paths } from '@/api/schema'
import { ApiError } from '@/api/errors'

/*
 * The browser side of the platform's two-token session.
 *
 * The access token (15 minutes) lives in this module's memory and nowhere else, so nothing persisted is
 * there for an injected script to read later. A page load therefore starts without one and calls
 * restoreSession().
 *
 * The refresh token (7 days) is an HttpOnly cookie scoped to /api/v1/auth, asked for with
 * X-Refresh-Transport: cookie. Script never sees it: refresh and logout send no body, and the cookie is
 * the request.
 *
 * Refresh tokens are single-use, and the server treats a reused one as stolen and revokes the whole
 * chain, so two tabs refreshing at once with the same cookie would sign the user out everywhere. Every
 * refresh therefore runs under a lock shared by all of the origin's tabs. A tab that waited for the lock
 * usually finds another tab already broadcast a new token and skips the call; if not, it sends the cookie
 * the first tab already rotated, because tabs share one cookie jar. See WEB_CLIENT_PLAN.md §5.
 */

type AuthResponse = components['schemas']['AuthResponse']
type RegisterRequest = components['schemas']['RegisterRequest']

/** `restoring` until the first refresh attempt settles, so routes can wait instead of flashing /login. */
export type SessionStatus = 'restoring' | 'signedIn' | 'signedOut'

type Broadcast =
  | { type: 'signed-in'; accessToken: string; expiresAt: number }
  | { type: 'signed-out' }

/** Refresh this long before the access token expires, so a request rarely meets a 401. */
const REFRESH_AHEAD_MS = 60_000
const LOCK_NAME = 'ff-auth-refresh'
const CHANNEL_NAME = 'ff-auth'
const COOKIE_TRANSPORT = { 'X-Refresh-Transport': 'cookie' }

// Deliberately not the shared `api` client: these calls carry the cookie, not a bearer token, and must
// never trigger the 401 retry that would call refresh() from inside a refresh.
const authApi = createClient<paths>({ baseUrl: window.location.origin })
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)

let accessToken: string | null = null
let expiresAt = 0
let status: SessionStatus = 'restoring'
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<string | null> | null = null
const listeners = new Set<() => void>()

export function getAccessToken(): string | null {
  return accessToken
}

export function getSessionStatus(): SessionStatus {
  return status
}

/** For `useSyncExternalStore(subscribe, getSessionStatus)`. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data, error, response } = await authApi.POST('/api/v1/auth/login', {
    body: { email, password },
    headers: COOKIE_TRANSPORT,
  })
  if (!data) {
    throw new ApiError(response, error)
  }
  adoptSession(data)
  return data
}

export async function register(body: RegisterRequest): Promise<AuthResponse> {
  const { data, error, response } = await authApi.POST('/api/v1/auth/register', {
    body,
    headers: COOKIE_TRANSPORT,
  })
  if (!data) {
    throw new ApiError(response, error)
  }
  adoptSession(data)
  return data
}

/**
 * Starts a session from an AuthResponse another call returned -- accepting an invitation answers with
 * one already scoped to the tenant just joined. That call must also have sent X-Refresh-Transport: cookie.
 */
export function adoptSession(auth: AuthResponse): void {
  setToken(auth.accessToken, Date.now() + auth.accessTokenExpiresIn)
  broadcast({ type: 'signed-in', accessToken: auth.accessToken, expiresAt })
}

/**
 * Signs out here and in every other tab, even if the call fails. A failure is rethrown because the
 * cookie may then still be live, and a reload would sign the user straight back in.
 */
export async function logout(): Promise<void> {
  try {
    await authApi.POST('/api/v1/auth/logout')
  } finally {
    clearToken()
    broadcast({ type: 'signed-out' })
  }
}

/** Call once at startup: the access token died with the last page, but the cookie may still be good. */
export async function restoreSession(): Promise<SessionStatus> {
  await refresh()
  return status
}

/**
 * A fresh access token, or null when there is none to be had. Concurrent callers in this tab share one
 * attempt, so five requests failing at once cost one refresh.
 */
export function refresh(): Promise<string | null> {
  inFlight ??= rotate().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function rotate(): Promise<string | null> {
  const tokenBefore = accessToken
  return withRefreshLock(async () => {
    if (accessToken !== null && accessToken !== tokenBefore && !expiresSoon()) {
      // Another tab refreshed while this one waited for the lock, and broadcast the result.
      return accessToken
    }

    let result
    try {
      result = await authApi.POST('/api/v1/auth/refresh')
    } catch {
      settleRestoring()
      return null
    }

    const { data, response } = result
    if (data) {
      setToken(data.accessToken, Date.now() + data.accessTokenExpiresIn)
      broadcast({ type: 'signed-in', accessToken: data.accessToken, expiresAt })
      return data.accessToken
    }
    if (response.status === 401 || response.status === 403) {
      // No cookie, or one that is expired, revoked or replayed. Tabs share the cookie, so it is over
      // for all of them.
      clearToken()
      broadcast({ type: 'signed-out' })
      return null
    }
    settleRestoring()
    return null
  })
}

function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  // Every browser the dashboard supports has the Web Locks API; without it there is nothing to
  // coordinate with, so run unlocked rather than not at all.
  if (!('locks' in navigator)) {
    return work()
  }
  return navigator.locks.request(LOCK_NAME, work)
}

function setToken(token: string, expiry: number): void {
  accessToken = token
  expiresAt = expiry
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    void refresh()
  }, Math.max(0, expiry - REFRESH_AHEAD_MS - Date.now()))
  setStatus('signedIn')
}

function clearToken(): void {
  accessToken = null
  expiresAt = 0
  clearTimeout(refreshTimer)
  refreshTimer = undefined
  setStatus('signedOut')
}

function expiresSoon(): boolean {
  return Date.now() >= expiresAt - REFRESH_AHEAD_MS
}

/** A first refresh that could not reach a verdict still has to let the app leave `restoring`. */
function settleRestoring(): void {
  if (status === 'restoring') {
    setStatus('signedOut')
  }
}

function setStatus(next: SessionStatus): void {
  if (status === next) {
    return
  }
  status = next
  listeners.forEach((listener) => listener())
}

function broadcast(message: Broadcast): void {
  channel?.postMessage(message)
}

channel?.addEventListener('message', (event: MessageEvent<Broadcast>) => {
  if (event.data.type === 'signed-in') {
    setToken(event.data.accessToken, event.data.expiresAt)
  } else {
    clearToken()
  }
})
