// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'

const TENANT = '461168601842738689'

// An in-memory stand-in for everything the checklist reads and writes, following the server: enabling a
// flag creates its row in that environment, and a key's first use sets its lastUsedAt.
const backend = vi.hoisted(() => {
  type Env = { id: string; name: string; description: null; createdAt: string }
  type Flag = { featureKey: string; environment: string; enabled: boolean; rolloutPercentage: number; enabledUsers: string[]; disabledUsers: string[]; rules: unknown[]; lastModified: string }
  type Key = { id: string; name: string; envName: string; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null }
  const state = {
    role: 'OWNER',
    envs: [] as Env[],
    features: [] as { id: string; key: string; description: string | null; createdAt: string }[],
    config: {} as Record<string, Flag[]>,
    keys: [] as Key[],
    calls: [] as { method: string; path: string }[],
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method
      const body = method === 'POST' ? await request.json() : undefined
      state.calls.push({ method, path })

      if (path === '/api/v1/tenants') {
        return reply({ tenants: [{ id: '461168601842738689', name: 'Acme', plan: 'FREE', roles: [{ id: '1', name: state.role }] }] })
      }
      if (path === '/api/v1/envs' && method === 'GET') {
        return reply({ envs: state.envs })
      }
      if (path === '/api/v1/envs' && method === 'POST') {
        const env = { id: `50${state.envs.length + 1}`, name: (body as { name: string }).name, description: null, createdAt: `2026-11-21T00:00:0${state.envs.length + 1}Z` }
        state.envs.push(env)
        return reply(env, 201)
      }
      if (path === '/api/v1/features' && method === 'GET') {
        return reply({ features: state.features })
      }
      if (path === '/api/v1/features' && method === 'POST') {
        const feature = { id: `90${state.features.length + 1}`, key: (body as { key: string }).key, description: null, createdAt: '2026-11-21T00:01:00Z' }
        state.features.push(feature)
        return reply(feature, 201)
      }
      if (path === '/api/v1/config') {
        const envName = url.searchParams.get('envName') ?? ''
        return reply({ environment: envName, flags: state.config[envName] ?? [], lastModified: '2026-11-21T00:03:00Z' })
      }
      const featureId = path.match(/^\/api\/v1\/features\/(\d+)\/enable$/)?.[1]
      if (featureId) {
        const { envId, enabled } = body as { envId: string; enabled: boolean }
        const env = state.envs.find((candidate) => candidate.id === envId)!
        const feature = state.features.find((candidate) => candidate.id === featureId)!
        const flags = (state.config[env.name] ??= [])
        flags.push({ featureKey: feature.key, environment: env.name, enabled, rolloutPercentage: 100, enabledUsers: [], disabledUsers: [], rules: [], lastModified: '2026-11-21T00:03:00Z' })
        return reply(undefined, 200)
      }
      if (path === '/api/v1/api-keys' && method === 'GET') {
        return reply({ apiKeys: state.keys })
      }
      if (path === '/api/v1/api-keys' && method === 'POST') {
        const { name, envName } = body as { name: string; envName: string }
        const apiKey = { id: `70${state.keys.length + 1}`, name, envName, prefix: 'ffsdk_first', createdAt: '2026-11-21T00:02:00Z', lastUsedAt: null, expiresAt: null, revokedAt: null }
        state.keys.push(apiKey)
        return reply({ apiKey, key: `ffsdk_first${'k'.repeat(37)}` }, 201)
      }
      return reply(undefined, 404)
    }),
  )
  return state
})

vi.mock('@/auth/session', () => ({
  getSessionStatus: () => 'signedIn',
  subscribe: () => () => {},
  getAccessToken: () => 'access-1',
  refresh: async () => null,
  logout: async () => {},
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const DEV = { id: '501', name: 'development', description: null, createdAt: '2026-11-21T00:00:01Z' }
const PROD = { id: '503', name: 'production', description: null, createdAt: '2026-11-21T00:00:03Z' }

function renderFlags() {
  const router = createMemoryRouter(routes, { initialEntries: [`/t/${TENANT}/flags`] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const checklist = () => screen.findByRole('region', { name: 'Get your first flag to an SDK' })
const currentStep = (region: HTMLElement) => region.querySelector('[aria-current="step"] h3')?.textContent

beforeEach(() => {
  localStorage.clear()
  backend.role = 'OWNER'
  backend.envs = []
  backend.features = []
  backend.config = {}
  backend.keys = []
  backend.calls = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('first-run checklist', () => {
  it('takes a new organization from nothing to an SDK reading a flag', async () => {
    renderFlags()

    const region = await checklist()
    expect(within(region).getByText('0 of 5 done')).toBeDefined()
    expect(currentStep(region)).toBe('Next: Create environments')
    expect(within(region).getByRole('link', { name: 'Name them yourself' }).getAttribute('href')).toBe(`/t/${TENANT}/environments`)

    fireEvent.click(within(region).getByRole('button', { name: 'Create development, staging and production' }))
    await waitFor(() => expect(currentStep(region)).toBe('Next: Create your first flag'))
    expect(within(region).getByText('development · staging · production')).toBeDefined()

    fireEvent.click(within(region).getByRole('button', { name: 'Create flag' }))
    const flagDialog = await screen.findByRole('dialog', { name: /flag/i })
    fireEvent.change(within(flagDialog).getByLabelText('Key'), { target: { value: 'checkout_v2' } })
    fireEvent.click(within(flagDialog).getByRole('button', { name: 'Create flag' }))
    await waitFor(() => expect(currentStep(region)).toBe('Next: Turn it on in development'))

    fireEvent.click(within(region).getByRole('switch', { name: 'checkout_v2 in development' }))
    await waitFor(() => expect(currentStep(region)).toBe('Next: Create an API key'))
    expect(within(region).getByText(/is on in development/).textContent).toBe('checkout_v2 is on in development')

    fireEvent.click(within(region).getByRole('button', { name: 'Create a development key' }))
    const keyDialog = await screen.findByRole('dialog', { name: 'Create key' })
    expect(within(keyDialog).getByRole('combobox', { name: 'Environment' }).textContent).toContain('development')
    fireEvent.change(within(keyDialog).getByLabelText('Name'), { target: { value: 'local-dev' } })
    fireEvent.click(within(keyDialog).getByRole('button', { name: 'Create key' }))
    fireEvent.click(await screen.findByLabelText("I've stored this key somewhere safe"))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(currentStep(region)).toBe('Next: Connect an SDK'))
    expect(within(region).getByText('local-dev · development')).toBeDefined()
    expect(within(region).getByText(/Waiting for the first request with/).textContent).toContain('local-dev')

    // The SDK's first request happens elsewhere; checking again picks it up.
    backend.keys[0].lastUsedAt = new Date().toISOString()
    fireEvent.click(within(region).getByRole('button', { name: 'Check again' }))

    const done = await screen.findByRole('region', { name: "You're set up" })
    expect(done.textContent).toContain('checkout_v2 is on in development, and an SDK has read it.')
    fireEvent.click(within(done).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: "You're set up" })).toBeNull()
    expect(localStorage.getItem(`first-run-hidden:${TENANT}`)).toBe('1')
  })

  it('hides on request, offers Undo, and stays hidden on the next visit', async () => {
    backend.envs = [DEV]
    renderFlags()

    const region = await checklist()
    expect(within(region).getByText('1 of 5 done')).toBeDefined()
    fireEvent.click(within(region).getByRole('button', { name: 'Hide the setup checklist' }))

    expect(await screen.findByRole('heading', { name: 'No flags yet' })).toBeDefined()
    const [message, options] = vi.mocked(toast).mock.calls.at(-1)!
    expect(message).toBe('Setup checklist hidden')
    ;(options as unknown as { action: { onClick: () => void } }).action.onClick()
    fireEvent.click(within(await checklist()).getByRole('button', { name: 'Hide the setup checklist' }))
    await screen.findByRole('heading', { name: 'No flags yet' })

    cleanup()
    backend.calls = []
    renderFlags()
    expect(await screen.findByRole('heading', { name: 'No flags yet' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Get your first flag to an SDK' })).toBeNull()
    expect(backend.calls.some((call) => call.path === '/api/v1/api-keys')).toBe(false)
  })

  it('turns the flag on outside production when both exist, and ticks steps done elsewhere', async () => {
    backend.envs = [PROD, DEV]
    backend.features = [{ id: '901', key: 'checkout_v2', description: null, createdAt: '2026-11-21T00:01:00Z' }]
    backend.keys = [{ id: '701', name: 'ci', envName: 'production', prefix: 'ffsdk_ci', createdAt: '', lastUsedAt: null, expiresAt: null, revokedAt: null }]
    renderFlags()

    const region = await checklist()
    expect(within(region).getByText('3 of 5 done')).toBeDefined()
    expect(currentStep(region)).toBe('Next: Turn it on in development')
    expect(within(region).getByText("development isn't protected, so this applies at once, with Undo.")).toBeDefined()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('stays out of the way of an organization that was already set up', async () => {
    backend.envs = [DEV]
    backend.features = [{ id: '901', key: 'checkout_v2', description: null, createdAt: '2026-11-21T00:01:00Z' }]
    backend.config = {
      development: [{ featureKey: 'checkout_v2', environment: 'development', enabled: true, rolloutPercentage: 100, enabledUsers: [], disabledUsers: [], rules: [], lastModified: '2026-11-21T00:03:00Z' }],
    }
    backend.keys = [{ id: '701', name: 'web', envName: 'development', prefix: 'ffsdk_web', createdAt: '', lastUsedAt: '2026-11-20T00:00:00Z', expiresAt: null, revokedAt: null }]
    renderFlags()

    await screen.findByRole('link', { name: 'checkout_v2' })
    expect(screen.queryByRole('region', { name: 'Get your first flag to an SDK' })).toBeNull()
    expect(screen.queryByRole('region', { name: "You're set up" })).toBeNull()
  })

  it('leaves an organization already in use alone, even with a step skipped', async () => {
    backend.envs = [DEV, PROD]
    backend.features = [{ id: '901', key: 'checkout_v2', description: null, createdAt: '2026-11-21T00:01:00Z' }]
    backend.config = {
      production: [{ featureKey: 'checkout_v2', environment: 'production', enabled: true, rolloutPercentage: 100, enabledUsers: [], disabledUsers: [], rules: [], lastModified: '2026-11-21T00:03:00Z' }],
    }
    backend.keys = [{ id: '701', name: 'web', envName: 'production', prefix: 'ffsdk_web', createdAt: '', lastUsedAt: '2026-11-20T00:00:00Z', expiresAt: null, revokedAt: null }]
    renderFlags()

    await screen.findByRole('link', { name: 'checkout_v2' })
    expect(screen.queryByRole('region', { name: 'Get your first flag to an SDK' })).toBeNull()
  })

  it('is not offered to read-only roles', async () => {
    backend.role = 'VIEWER'
    renderFlags()

    expect(await screen.findByRole('heading', { name: 'Set up environments first' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Get your first flag to an SDK' })).toBeNull()
    expect(backend.calls.some((call) => call.path === '/api/v1/api-keys')).toBe(false)
  })
})
