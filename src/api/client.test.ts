// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authBody,
  errorBody,
  installBroadcastBus,
  installLocks,
  json,
  meBody,
  pathOf,
  requestsTo,
  stubFetch,
} from '@/test/fakes'

async function load() {
  vi.resetModules()
  const session = await import('@/auth/session')
  const { api } = await import('./client')
  return { session, api }
}

beforeEach(() => {
  installLocks()
  installBroadcastBus()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('sends the access token as a bearer token', async () => {
    const fetchStub = stubFetch((request) =>
      pathOf(request) === '/api/v1/auth/login' ? json(authBody('access-1')) : json(meBody()),
    )
    const { session, api } = await load()
    await session.login('user@example.com', 'correct horse')

    await api.GET('/api/v1/auth/me')

    const [me] = requestsTo(fetchStub, '/api/v1/auth/me')
    expect(me.headers.get('Authorization')).toBe('Bearer access-1')
  })

  it('refreshes once on a 401 and retries the request with the new token', async () => {
    const fetchStub = stubFetch((request) => {
      switch (pathOf(request)) {
        case '/api/v1/auth/login':
          return json(authBody('access-1'))
        case '/api/v1/auth/refresh':
          return json(authBody('access-2'))
        default:
          return request.headers.get('Authorization') === 'Bearer access-2'
            ? json(meBody())
            : json(errorBody(401), 401)
      }
    })
    const { session, api } = await load()
    await session.login('user@example.com', 'correct horse')

    const { data, response } = await api.GET('/api/v1/auth/me')

    expect(response.status).toBe(200)
    expect(data?.email).toBe('user@example.com')
    expect(requestsTo(fetchStub, '/api/v1/auth/refresh')).toHaveLength(1)
    expect(requestsTo(fetchStub, '/api/v1/auth/me')).toHaveLength(2)
  })

  it('hands back a 401 untouched when the request carried no token', async () => {
    const fetchStub = stubFetch(() => json(errorBody(401), 401))
    const { api } = await load()

    const { response } = await api.GET('/api/v1/auth/me')

    expect(response.status).toBe(401)
    expect(requestsTo(fetchStub, '/api/v1/auth/refresh')).toHaveLength(0)
  })
})
