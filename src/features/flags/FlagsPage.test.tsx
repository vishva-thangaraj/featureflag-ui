// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'

const TENANT = '461168601842738689'

// An in-memory stand-in for the endpoints the flags page uses. The enable endpoint follows the server:
// it creates the environment's row on first use, and keeps the rollout when none is sent.
const backend = vi.hoisted(() => {
  type Flag = {
    featureKey: string
    environment: string
    enabled: boolean
    rolloutPercentage: number
    enabledUsers: string[]
    disabledUsers: string[]
    rules: unknown[]
    lastModified: string
  }
  const state = {
    role: 'OWNER',
    envs: [] as { id: string; name: string; description: null; createdAt: string }[],
    features: [] as { id: string; key: string; description: string | null; createdAt: string }[],
    config: {} as Record<string, Flag[]>,
    enableStatus: 200,
    calls: [] as { method: string; path: string; search: string; body?: unknown }[],
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const { pathname: path, search } = url
      const method = request.method
      const body = method === 'POST' ? await request.json() : undefined
      state.calls.push({ method, path, search, body })

      if (path === '/api/v1/tenants') {
        return reply({ tenants: [{ id: '461168601842738689', name: 'Acme', plan: 'FREE', roles: [{ id: '1', name: state.role }] }] })
      }
      if (path === '/api/v1/envs') {
        return reply({ envs: state.envs })
      }
      if (path === '/api/v1/features' && method === 'GET') {
        return reply({ features: state.features })
      }
      if (path === '/api/v1/features' && method === 'POST') {
        const { key, description } = body as { key: string; description?: string }
        if (state.features.some((feature) => feature.key === key)) {
          return reply({ status: 409, error: 'Conflict', message: 'Feature already exists', timestamp: '' }, 409)
        }
        const feature = { id: `9007199254741${state.features.length}`, key, description: description ?? null, createdAt: '2026-11-16T00:00:00Z' }
        state.features.push(feature)
        return reply(feature, 201)
      }
      if (path === '/api/v1/config') {
        const envName = url.searchParams.get('envName') ?? ''
        return reply({ environment: envName, flags: state.config[envName] ?? [], lastModified: '2026-11-16T00:00:00Z' })
      }
      const featureId = path.match(/^\/api\/v1\/features\/(\d+)\/enable$/)?.[1]
      if (featureId) {
        if (state.enableStatus !== 200) {
          return reply({ status: state.enableStatus, error: 'Forbidden', message: 'Forbidden', timestamp: '' }, state.enableStatus)
        }
        const { envId, enabled } = body as { envId: string; enabled: boolean }
        const env = state.envs.find((candidate) => candidate.id === envId)!
        const feature = state.features.find((candidate) => candidate.id === featureId)!
        const flags = (state.config[env.name] ??= [])
        const flag = flags.find((candidate) => candidate.featureKey === feature.key)
        if (flag) {
          flag.enabled = enabled
        } else {
          flags.push({ featureKey: feature.key, environment: env.name, enabled, rolloutPercentage: 100, enabledUsers: [], disabledUsers: [], rules: [], lastModified: '2026-11-16T00:00:00Z' })
        }
        return reply(undefined, 200)
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

const DEV = { id: '501', name: 'development', description: null, createdAt: '2026-10-01T00:00:01Z' }
const STAGING = { id: '502', name: 'staging', description: null, createdAt: '2026-10-01T00:00:02Z' }
const PROD = { id: '503', name: 'production', description: null, createdAt: '2026-10-01T00:00:03Z' }

const feature = (id: string, key: string, description: string | null = null) => ({
  id,
  key,
  description,
  createdAt: '2026-10-05T00:00:00Z',
})

const flag = (featureKey: string, environment: string, enabled: boolean, rolloutPercentage = 100, extra = {}) => ({
  featureKey,
  environment,
  enabled,
  rolloutPercentage,
  enabledUsers: [],
  disabledUsers: [],
  rules: [],
  lastModified: '2026-11-15T00:00:00Z',
  ...extra,
})

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const flagKeys = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('link')[0].textContent)

const enableCalls = () => backend.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/enable'))

beforeEach(() => {
  localStorage.clear()
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  backend.role = 'OWNER'
  backend.envs = [DEV, STAGING, PROD]
  backend.features = [
    feature('11', 'search_reranker', 'Vector re-ranking'),
    feature('12', 'checkout_v2', 'New checkout flow'),
    feature('13', 'legacy_api_shim'),
    feature('14', 'dark_mode', 'Theme switcher'),
  ]
  backend.config = {
    staging: [
      flag('checkout_v2', 'staging', true, 25, {
        rules: [{}, {}],
        enabledUsers: ['u-1', 'u-2'],
        disabledUsers: ['u-9'],
      }),
      flag('dark_mode', 'staging', false),
      flag('legacy_api_shim', 'staging', true, 0),
    ],
    production: [flag('checkout_v2', 'production', true)],
  }
  backend.enableStatus = 200
  backend.calls = []
})

afterEach(() => {
  cleanup()
})

describe('flags page', () => {
  it("joins the flag list with the URL's environment, sorted by key", async () => {
    renderAt(`/t/${TENANT}/flags?env=staging`)

    await screen.findByText('4 flags · state in staging')
    await screen.findByRole('switch', { name: 'checkout_v2 in staging' })
    expect(flagKeys()).toEqual(['checkout_v2', 'dark_mode', 'legacy_api_shim', 'search_reranker'])
    expect(screen.getByRole('switch', { name: 'checkout_v2 in staging' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'dark_mode in staging' }).getAttribute('aria-checked')).toBe('false')

    const [checkout, , legacy, reranker] = screen.getAllByRole('row').slice(1)
    expect(within(checkout).getByText('25%')).toBeDefined()
    expect(within(checkout).getByText('2 rules')).toBeDefined()
    expect(within(checkout).getByText('3 overrides')).toBeDefined()
    expect(within(legacy).getByText('0% · nobody')).toBeDefined()
    expect(within(reranker).getByText(/Not set up/)).toBeDefined()
    expect(within(reranker).getByRole('link', { name: 'Set up' }).getAttribute('href')).toBe(
      `/t/${TENANT}/flags/11?env=staging`,
    )
    expect(backend.calls.some((call) => call.path === '/api/v1/config' && call.search === '?envName=staging')).toBe(true)
  })

  it('falls back to the environment last used in this organization, then to the first', async () => {
    renderAt(`/t/${TENANT}/flags`)
    await screen.findByText('4 flags · state in development')
    cleanup()

    renderAt(`/t/${TENANT}/flags?env=production`)
    await screen.findByText('4 flags · state in production')
    cleanup()

    renderAt(`/t/${TENANT}/flags`)
    expect(await screen.findByText('4 flags · state in production')).toBeDefined()
  })

  it('switches environment through the URL', async () => {
    const router = renderAt(`/t/${TENANT}/flags?env=development`)
    await screen.findByText('4 flags · state in development')

    fireEvent.click(screen.getByRole('button', { name: 'staging' }))

    await screen.findByText('4 flags · state in staging')
    expect(new URLSearchParams(router.state.location.search).get('env')).toBe('staging')
    expect(screen.getByRole('button', { name: 'staging' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'production, protected' })).toBeDefined()
  })

  it('searches and filters, keeping both in the URL', async () => {
    const router = renderAt(`/t/${TENANT}/flags?env=staging`)
    await screen.findByRole('switch', { name: 'checkout_v2 in staging' })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search flags' }), { target: { value: 'theme' } })
    expect(flagKeys()).toEqual(['dark_mode'])
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('theme')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search flags' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /^On/ }))
    expect(flagKeys()).toEqual(['checkout_v2', 'legacy_api_shim'])
    expect(new URLSearchParams(router.state.location.search).get('status')).toBe('on')

    fireEvent.click(screen.getByRole('button', { name: /^Not set up/ }))
    expect(flagKeys()).toEqual(['search_reranker'])
  })

  it('turns a flag off at once outside protected environments, and offers to undo it', async () => {
    renderAt(`/t/${TENANT}/flags?env=staging`)
    const toggle = await screen.findByRole('switch', { name: 'checkout_v2 in staging' })

    fireEvent.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    await waitFor(() => expect(enableCalls()).toHaveLength(1))
    expect(enableCalls()[0].body).toEqual({ envId: STAGING.id, enabled: false })

    await waitFor(() => expect(toast).toHaveBeenCalled())
    const [message, options] = vi.mocked(toast).mock.calls[0]
    expect(message).toBe('checkout_v2 turned off in staging')
    const undo = options?.action as { label: string; onClick: (event?: unknown) => void }
    expect(undo.label).toBe('Undo')
    undo.onClick()

    await waitFor(() => expect(enableCalls()).toHaveLength(2))
    expect(enableCalls()[1].body).toEqual({ envId: STAGING.id, enabled: true })
  })

  it('asks before changing a protected environment, with the action focused', async () => {
    renderAt(`/t/${TENANT}/flags?env=production`)
    const toggle = await screen.findByRole('switch', { name: 'checkout_v2 in production' })

    fireEvent.click(toggle)
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off checkout_v2 in production?' })
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Turn off' })))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(enableCalls()).toHaveLength(0)
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn off' }))

    await waitFor(() => expect(enableCalls()).toHaveLength(1))
    expect(enableCalls()[0].body).toEqual({ envId: PROD.id, enabled: false })
    expect(toast).not.toHaveBeenCalled()
  })

  it('puts the switch back when the server refuses the change', async () => {
    backend.enableStatus = 403
    renderAt(`/t/${TENANT}/flags?env=staging`)
    const toggle = await screen.findByRole('switch', { name: 'checkout_v2 in staging' })

    fireEvent.click(toggle)

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  })

  it('shows a viewer the state as words, with no switches and no new flag', async () => {
    backend.role = 'VIEWER'

    renderAt(`/t/${TENANT}/flags?env=staging`)

    await screen.findByText('4 flags · state in staging')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.getByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New flag' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Set up' })).toBeNull()
  })

  it('sends an organization with no environments to set them up first', async () => {
    backend.envs = []

    renderAt(`/t/${TENANT}/flags`)

    await screen.findByRole('heading', { name: 'Set up environments first' })
    expect(screen.getByRole('link', { name: 'Go to Environments' }).getAttribute('href')).toBe(`/t/${TENANT}/environments`)
  })

  it('creates a flag, offering a one-click fix for a key that breaks the rules', async () => {
    backend.features = []
    renderAt(`/t/${TENANT}/flags?env=staging`)

    fireEvent.click(await screen.findByRole('button', { name: 'New flag' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flag' })
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'Checkout V2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create flag' }))

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Use checkout_v2' }))
    expect((within(dialog).getByLabelText('Key') as HTMLInputElement).value).toBe('checkout_v2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create flag' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.calls.find((call) => call.method === 'POST' && call.path === '/api/v1/features')?.body).toEqual({
      key: 'checkout_v2',
    })
    expect(toast.success).toHaveBeenCalledWith("checkout_v2 created. It's off everywhere until you turn it on.")
    await waitFor(() => expect(flagKeys()).toEqual(['checkout_v2']))
  })

  it('points to the existing flag when the key is taken', async () => {
    renderAt(`/t/${TENANT}/flags?env=staging`)

    fireEvent.click(await screen.findByRole('button', { name: 'New flag' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flag' })
    fireEvent.change(within(dialog).getByLabelText('Key'), { target: { value: 'checkout_v2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create flag' }))

    expect(await within(dialog).findByText('A flag with this key already exists.')).toBeDefined()
    expect(within(dialog).getByRole('link', { name: 'Open the existing flag' }).getAttribute('href')).toBe(
      `/t/${TENANT}/flags/12`,
    )
  })
})
