// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authBody,
  errorBody,
  installBroadcastBus,
  installLocks,
  json,
  pathOf,
  requestsTo,
  stubFetch,
} from '@/test/fakes'

type SessionModule = typeof import('./session')

/** A fresh copy of the module, as a newly opened tab would have. */
async function openTab(): Promise<SessionModule> {
  vi.resetModules()
  return import('./session')
}

let locks: ReturnType<typeof installLocks>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  locks = installLocks()
  installBroadcastBus()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('session', () => {
  it('keeps the access token in memory and asks for the refresh token as a cookie', async () => {
    const fetchStub = stubFetch(() => json(authBody('access-1')))
    const session = await openTab()
    const onChange = vi.fn()
    session.subscribe(onChange)

    await session.login('user@example.com', 'correct horse')

    const [login] = requestsTo(fetchStub, '/api/v1/auth/login')
    expect(login.headers.get('X-Refresh-Transport')).toBe('cookie')
    expect(session.getAccessToken()).toBe('access-1')
    expect(session.getSessionStatus()).toBe('signedIn')
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('turns a refused login into an ApiError with the server message and field errors', async () => {
    stubFetch(() =>
      json({ ...errorBody(400, 'Validation failed'), fieldErrors: [{ field: 'email', message: 'must be an email' }] }, 400),
    )
    const session = await openTab()
    const { ApiError } = await import('@/api/errors')

    const failure = await session.login('not-an-email', 'x').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({ status: 400, message: 'Validation failed' })
    expect((failure as InstanceType<typeof ApiError>).body?.fieldErrors?.[0].field).toBe('email')
    expect(session.getAccessToken()).toBeNull()
  })

  it('shares one refresh between concurrent callers in a tab', async () => {
    const fetchStub = stubFetch((request) =>
      json(authBody(pathOf(request) === '/api/v1/auth/refresh' ? 'access-2' : 'access-1')),
    )
    const session = await openTab()
    await session.login('user@example.com', 'correct horse')

    const tokens = await Promise.all([session.refresh(), session.refresh(), session.refresh()])

    expect(tokens).toEqual(['access-2', 'access-2', 'access-2'])
    expect(requestsTo(fetchStub, '/api/v1/auth/refresh')).toHaveLength(1)
  })

  it('takes the token another tab broadcast while it waited for the lock, instead of rotating again', async () => {
    const fetchStub = stubFetch(() => json(authBody('access-1')))
    const session = await openTab()
    await session.login('user@example.com', 'correct horse')

    const releaseOtherTab = locks.hold()
    const pending = session.refresh()
    const otherTab = new BroadcastChannel('ff-auth')
    otherTab.postMessage({ type: 'signed-in', accessToken: 'access-2', expiresAt: Date.now() + 900_000 })
    await vi.waitFor(() => expect(session.getAccessToken()).toBe('access-2'))
    releaseOtherTab()

    await expect(pending).resolves.toBe('access-2')
    expect(requestsTo(fetchStub, '/api/v1/auth/refresh')).toHaveLength(0)
    otherTab.close()
  })

  it('ends the session in every tab when the refresh token is refused', async () => {
    stubFetch((request) =>
      pathOf(request) === '/api/v1/auth/refresh' ? json(errorBody(401), 401) : json(authBody('access-1')),
    )
    const tabA = await openTab()
    const tabB = await openTab()
    await tabA.login('user@example.com', 'correct horse')
    await vi.waitFor(() => expect(tabB.getSessionStatus()).toBe('signedIn'))

    await expect(tabA.refresh()).resolves.toBeNull()

    expect(tabA.getSessionStatus()).toBe('signedOut')
    await vi.waitFor(() => expect(tabB.getSessionStatus()).toBe('signedOut'))
    expect(tabB.getAccessToken()).toBeNull()
  })

  it('refreshes a minute before the access token expires', async () => {
    const fetchStub = stubFetch((request) =>
      json(authBody(pathOf(request) === '/api/v1/auth/refresh' ? 'access-2' : 'access-1')),
    )
    const session = await openTab()
    await session.login('user@example.com', 'correct horse')

    await vi.advanceTimersByTimeAsync(13 * 60_000 + 59_000)
    expect(requestsTo(fetchStub, '/api/v1/auth/refresh')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(session.getAccessToken()).toBe('access-2'))
    expect(requestsTo(fetchStub, '/api/v1/auth/refresh')).toHaveLength(1)
  })

  it.each([
    ['the cookie is still good', () => json(authBody('access-1')), 'signedIn'],
    ['there is no usable cookie', () => json(errorBody(401), 401), 'signedOut'],
    ['the API cannot be reached', (): Response => {
      throw new TypeError('Failed to fetch')
    }, 'signedOut'],
  ] as const)('restoreSession settles when %s', async (_situation, respond, expected) => {
    stubFetch(respond)
    const session = await openTab()
    expect(session.getSessionStatus()).toBe('restoring')

    await expect(session.restoreSession()).resolves.toBe(expected)
  })

  it('signs out locally even when the logout call fails, and reports the failure', async () => {
    stubFetch((request) => {
      if (pathOf(request) === '/api/v1/auth/logout') {
        throw new TypeError('Failed to fetch')
      }
      return json(authBody('access-1'))
    })
    const session = await openTab()
    await session.login('user@example.com', 'correct horse')

    await expect(session.logout()).rejects.toThrow('Failed to fetch')

    expect(session.getAccessToken()).toBeNull()
    expect(session.getSessionStatus()).toBe('signedOut')
  })
})
