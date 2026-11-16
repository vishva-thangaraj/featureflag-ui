// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/app/routes'

const TENANT = '461168601842738689'

// An in-memory stand-in for the endpoints this page uses, following the server's rules: unique names,
// and no deleting an environment while any of its keys is unrevoked.
const backend = vi.hoisted(() => {
  type Env = { id: string; name: string; description: string | null; createdAt: string }
  type Key = { id: string; name: string; envName: string; prefix: string; createdAt: string; revokedAt: string | null }
  const state = {
    role: 'OWNER',
    envs: [] as Env[],
    keys: [] as Key[],
    flagsIn: {} as Record<string, number>,
    calls: [] as { method: string; path: string; body?: unknown }[],
    nextId: 100,
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const conflict = (message: string) =>
    reply({ status: 409, error: 'Conflict', message, timestamp: '2026-11-01T00:00:00Z' }, 409)

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method
      const body = method === 'POST' || method === 'PUT' ? await request.json() : undefined
      state.calls.push({ method, path, body })

      if (path === '/api/v1/tenants') {
        return reply({ tenants: [{ id: '461168601842738689', name: 'Acme', plan: 'FREE', roles: [{ id: '1', name: state.role }] }] })
      }
      if (path === '/api/v1/envs' && method === 'GET') {
        return reply({ envs: state.envs })
      }
      if (path === '/api/v1/envs' && method === 'POST') {
        const { name, description } = body as { name: string; description?: string }
        if (state.envs.some((env) => env.name === name)) {
          return conflict('Environment name already exists')
        }
        const id = String(state.nextId++)
        const env = { id, name, description: description ?? null, createdAt: `2026-10-01T00:00:${id.slice(-2)}Z` }
        state.envs.push(env)
        return reply(env, 201)
      }
      const envId = path.match(/^\/api\/v1\/envs\/(\d+)$/)?.[1]
      const env = state.envs.find((candidate) => candidate.id === envId)
      if (env && method === 'PUT') {
        const { name, description } = body as { name?: string; description?: string }
        if (name !== undefined) env.name = name
        if (description !== undefined) env.description = description
        return reply(env)
      }
      if (env && method === 'DELETE') {
        if (state.keys.some((key) => key.envName === env.name && key.revokedAt === null)) {
          return conflict('Environment still has active API keys')
        }
        state.envs = state.envs.filter((candidate) => candidate !== env)
        return reply(undefined, 204)
      }
      if (path === '/api/v1/api-keys') {
        return reply({ apiKeys: state.keys })
      }
      const key = state.keys.find((candidate) => path === `/api/v1/api-keys/${candidate.id}`)
      if (key && method === 'DELETE') {
        key.revokedAt = '2026-11-01T00:00:00Z'
        return reply(undefined, 204)
      }
      if (path === '/api/v1/config') {
        const envName = url.searchParams.get('envName') ?? ''
        const flags = Array.from({ length: state.flagsIn[envName] ?? 0 }, (_, index) => ({
          featureKey: `flag_${index}`,
          environment: envName,
          enabled: true,
          rolloutPercentage: 100,
          enabledUsers: [],
          disabledUsers: [],
          rules: [],
          lastModified: '2026-10-01T00:00:00Z',
        }))
        return reply({ environment: envName, flags, lastModified: '2026-10-01T00:00:00Z' })
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

function environment(name: string, createdSecond: number) {
  const id = String(backend.nextId++)
  return { id, name, description: null, createdAt: `2026-10-01T00:00:${String(createdSecond).padStart(2, '0')}Z` }
}

function apiKey(id: string, envName: string, revokedAt: string | null = null) {
  return { id, name: `${envName}-service`, envName, prefix: 'ffsdk_3mDw8T', createdAt: '2026-10-02T00:00:00Z', revokedAt }
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: [`/t/${TENANT}/environments`] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const environmentNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].querySelector('.font-mono')?.textContent)

const callsTo = (method: string, pathPattern: RegExp) =>
  backend.calls.filter((call) => call.method === method && pathPattern.test(call.path))

beforeEach(() => {
  backend.role = 'OWNER'
  backend.envs = []
  backend.keys = []
  backend.flagsIn = {}
  backend.calls = []
})

afterEach(() => {
  cleanup()
})

describe('environments page', () => {
  it('lists environments in creation order, with unrevoked keys counted and protected ones marked', async () => {
    backend.envs = [environment('production', 3), environment('development', 1), environment('staging', 2)]
    backend.keys = [apiKey('71', 'production'), apiKey('72', 'staging', '2026-10-20T00:00:00Z')]

    renderPage()

    await screen.findByText('production')
    expect(environmentNames()).toEqual(['development', 'staging', 'production'])
    const [, staging, production] = screen.getAllByRole('row').slice(1)
    await waitFor(() => expect(within(production).getAllByRole('cell')[1].textContent).toBe('1'))
    expect(within(staging).getAllByRole('cell')[1].textContent).toBe('0')
    expect(within(production).getByText('Protected')).toBeDefined()
    expect(within(staging).queryByText('Protected')).toBeNull()
  })

  it('shows a viewer the same list without any way to change it', async () => {
    backend.role = 'VIEWER'
    backend.envs = [environment('staging', 1)]

    renderPage()

    await screen.findByText('staging')
    expect(screen.getByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New environment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit staging' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete staging' })).toBeNull()
  })

  it('creates development, staging and production, in that order, from the empty state', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Create development, staging and production' }))

    await waitFor(() => expect(environmentNames()).toEqual(['development', 'staging', 'production']))
    expect(callsTo('POST', /^\/api\/v1\/envs$/).map((call) => call.body)).toEqual([
      { name: 'development' },
      { name: 'staging' },
      { name: 'production' },
    ])
  })

  it('checks a new name, puts a taken one on the name field, and creates a good one', async () => {
    backend.envs = [environment('development', 1)]
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'New environment' }))
    const dialog = await screen.findByRole('dialog', { name: 'New environment' })
    const name = within(dialog).getByLabelText('Name')

    fireEvent.change(name, { target: { value: '1st' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create environment' }))
    expect(await within(dialog).findByText('Start with a letter, then use letters, digits, _ . or -')).toBeDefined()

    fireEvent.change(name, { target: { value: 'development' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create environment' }))
    expect(await within(dialog).findByText('An environment with this name already exists.')).toBeDefined()

    fireEvent.change(name, { target: { value: 'qa' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create environment' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(environmentNames()).toEqual(['development', 'qa']))
  })

  it('warns before a rename, and sends only what changed', async () => {
    backend.envs = [environment('staging', 1)]
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit staging' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit staging' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'stage' } })

    expect(within(dialog).getByText(/needs the new name/)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(environmentNames()).toEqual(['stage']))
    expect(callsTo('PUT', /^\/api\/v1\/envs\/\d+$/).map((call) => call.body)).toEqual([{ name: 'stage' }])
  })

  it('says what goes with an environment before deleting it', async () => {
    backend.envs = [environment('staging', 1), environment('development', 0)]
    backend.flagsIn = { staging: 2 }
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete staging' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete staging?' })
    expect(await within(dialog).findByText(/2 flags are set up in staging/)).toBeDefined()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete staging' }))

    await waitFor(() => expect(environmentNames()).toEqual(['development']))
    expect(callsTo('DELETE', /^\/api\/v1\/envs\/\d+$/)).toHaveLength(1)
  })

  it("asks for a protected environment's name to be typed before deleting it", async () => {
    backend.envs = [environment('production', 1)]
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete production' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete production?' })
    const confirm = await within(dialog).findByLabelText('Type production to confirm')
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete production' })

    expect(deleteButton.hasAttribute('disabled')).toBe(true)
    fireEvent.change(confirm, { target: { value: 'prod' } })
    expect(deleteButton.hasAttribute('disabled')).toBe(true)
    fireEvent.change(confirm, { target: { value: 'production' } })
    expect(deleteButton.hasAttribute('disabled')).toBe(false)
  })

  it('lists the keys that block a delete, and allows it once they are revoked', async () => {
    backend.envs = [environment('staging', 1)]
    backend.keys = [apiKey('77', 'staging')]
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete staging' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke 1 API key before deleting staging' })
    expect(within(dialog).getByRole('button', { name: 'Delete staging' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke staging-service' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm revoke' }))

    await within(dialog).findByRole('heading', { name: 'Delete staging?' })
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete staging' })
    expect(deleteButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(deleteButton)

    await waitFor(() => expect(screen.queryByRole('row')).toBeNull())
    expect(callsTo('DELETE', /^\/api\/v1\/api-keys\/77$/)).toHaveLength(1)
    expect(callsTo('DELETE', /^\/api\/v1\/envs\/\d+$/)).toHaveLength(1)
  })
})
