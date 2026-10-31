// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { json, pathOf } from '@/test/fakes'
import { useFeatures, useFlagConfig, useSetFlagEnabled } from './queries'

const http = vi.hoisted(() => {
  const requests: Request[] = []
  const state = {
    requests,
    respond: (_request: Request): Response | Promise<Response> => new Response(null, { status: 404 }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request)
      return state.respond(request)
    }),
  )
  return state
})

vi.mock('@/auth/session', () => ({
  getAccessToken: () => 'access-1',
  refresh: async () => null,
}))

const TENANT = '461168601842738689'
// Above 2^53: a JavaScript number would round both of these to a different id.
const FEATURE = '9007199254740993'
const ENV = '9007199254740995'

function Probe() {
  const features = useFeatures()
  const config = useFlagConfig('production')
  const setEnabled = useSetFlagEnabled()
  return (
    <>
      <p>features: {features.data?.length ?? '-'}</p>
      <p>config: {config.data?.environment ?? '-'}</p>
      <button onClick={() => setEnabled.mutate({ featureId: FEATURE, envId: ENV, enabled: false })}>Turn off</button>
      <p>toggle: {setEnabled.status}</p>
    </>
  )
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/t/:tenantId', element: <Probe /> }], {
    initialEntries: [`/t/${TENANT}`],
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return queryClient
}

const requestsTo = (pathname: string) => http.requests.filter((request) => pathOf(request) === pathname)

beforeEach(() => {
  http.requests.length = 0
  http.respond = (request) => {
    switch (pathOf(request)) {
      case '/api/v1/features':
        return json({ features: [{ id: FEATURE, key: 'checkout_v2', description: null, createdAt: '2026-10-01T00:00:00Z' }] })
      case '/api/v1/config':
        return json({ environment: 'production', flags: [], lastModified: '2026-10-01T00:00:00Z' })
      default:
        return new Response(null, { status: 200 })
    }
  }
})

afterEach(() => {
  cleanup()
})

describe('flag queries', () => {
  it('read the organization from the URL into both the header and the cache key', async () => {
    const queryClient = renderProbe()

    await screen.findByText('features: 1')
    await screen.findByText('config: production')

    expect(requestsTo('/api/v1/features')[0].headers.get('X-Tenant-Id')).toBe(TENANT)
    const [config] = requestsTo('/api/v1/config')
    expect(config.headers.get('X-Tenant-Id')).toBe(TENANT)
    expect(new URL(config.url).searchParams.get('envName')).toBe('production')
    expect(queryClient.getQueryData(['t', TENANT, 'features'])).toHaveLength(1)
    expect(queryClient.getQueryData(['t', TENANT, 'config', 'production'])).toBeDefined()
  })

  it('turn a flag off without sending a rollout, then refetch the environment config', async () => {
    renderProbe()
    await screen.findByText('config: production')

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await screen.findByText('toggle: success')

    const [enable] = requestsTo(`/api/v1/features/${FEATURE}/enable`)
    expect(enable.method).toBe('POST')
    expect(enable.headers.get('X-Tenant-Id')).toBe(TENANT)
    expect(await enable.json()).toEqual({ envId: ENV, enabled: false })
    await waitFor(() => expect(requestsTo('/api/v1/config')).toHaveLength(2))
  })
})
