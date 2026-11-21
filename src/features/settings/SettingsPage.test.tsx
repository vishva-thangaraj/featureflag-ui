// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'

const TENANT = '461168601842738689'
const OTHER = '461168601842738700'

// An in-memory stand-in for the endpoints this page uses. Renaming and deleting follow the server: the
// tenant is named in the path, and a delete takes everything in it.
const backend = vi.hoisted(() => {
  type Tenant = { id: string; name: string; plan: string }
  type Failure = { status: number; body: unknown }
  const state = {
    role: 'OWNER',
    tenants: [] as Tenant[],
    features: 0,
    envs: 0,
    keys: [] as { id: string; revokedAt: string | null; expiresAt?: string }[],
    members: 0,
    invitations: [] as { id: string; status: string }[],
    renameFailure: undefined as Failure | undefined,
    deleteFailure: undefined as Failure | undefined,
    // Holds GET /tenants back, the way a slow network would, until the test lets it go.
    tenantsHeld: undefined as Promise<void> | undefined,
    calls: [] as { method: string; path: string; tenant: string | null; body?: unknown }[],
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const asResponse = (tenant: Tenant) => ({ ...tenant, roles: [{ id: '1', name: state.role }] })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      const method = request.method
      const body = method === 'PUT' ? await request.json() : undefined
      state.calls.push({ method, path, tenant: request.headers.get('X-Tenant-Id'), body })

      if (path === '/api/v1/tenants') {
        await state.tenantsHeld
        return reply({ tenants: state.tenants.map(asResponse) })
      }
      const tenant = state.tenants.find((candidate) => path === `/api/v1/tenants/${candidate.id}`)
      if (tenant && method === 'PUT') {
        if (state.renameFailure) {
          return reply(state.renameFailure.body, state.renameFailure.status)
        }
        const { name } = body as { name?: string }
        if (name !== undefined) tenant.name = name
        return reply(asResponse(tenant))
      }
      if (tenant && method === 'DELETE') {
        if (state.deleteFailure) {
          return reply(state.deleteFailure.body, state.deleteFailure.status)
        }
        state.tenants = state.tenants.filter((candidate) => candidate !== tenant)
        return reply(undefined, 204)
      }
      if (path === '/api/v1/features') {
        return reply({
          features: Array.from({ length: state.features }, (_, index) => ({
            id: String(900 + index),
            key: `flag_${index}`,
            description: null,
            createdAt: '2026-10-01T00:00:00Z',
          })),
        })
      }
      if (path === '/api/v1/envs') {
        return reply({
          envs: Array.from({ length: state.envs }, (_, index) => ({
            id: String(500 + index),
            name: `env_${index}`,
            description: null,
            createdAt: `2026-10-01T00:00:0${index}Z`,
          })),
        })
      }
      if (path === '/api/v1/api-keys') {
        return reply({ apiKeys: state.keys })
      }
      if (path === '/api/v1/members') {
        return reply({
          members: Array.from({ length: state.members }, (_, index) => ({
            membershipId: String(700 + index),
            userID: String(800 + index),
            email: `person${index}@acme.dev`,
            firstName: 'Person',
            roles: [{ id: '3', name: 'MEMBER' }],
            status: 'ACTIVE',
          })),
        })
      }
      if (path === '/api/v1/invitations') {
        return reply({ invitations: state.invitations })
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

const writeText = vi.fn(async (_text: string) => {})
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

function renderSettings() {
  const router = createMemoryRouter(routes, { initialEntries: [`/t/${TENANT}/settings`] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const callsTo = (method: string, pathPattern: RegExp) =>
  backend.calls.filter((call) => call.method === method && pathPattern.test(call.path))

const fieldError = (status: number, fieldErrors?: { field: string | null; message: string }[]) => ({
  status,
  body: { status, error: 'Error', message: `Request failed (${status})`, timestamp: '2026-11-01T00:00:00Z', fieldErrors },
})

async function openDeleteDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete organization' }))
  return screen.findByRole('alertdialog', { name: 'Delete Acme Robotics?' })
}

/** Until the returned function is called, the organizations list can only come from the cache. */
function holdTenantsList(): () => void {
  let release!: () => void
  backend.tenantsHeld = new Promise((resolve) => {
    release = resolve
  })
  return release
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  writeText.mockClear()
  backend.role = 'OWNER'
  backend.tenants = [{ id: TENANT, name: 'Acme Robotics', plan: 'PRO' }]
  backend.features = 0
  backend.envs = 0
  backend.keys = []
  backend.members = 1
  backend.invitations = []
  backend.renameFailure = undefined
  backend.deleteFailure = undefined
  backend.tenantsHeld = undefined
  backend.calls = []
})

afterEach(() => {
  cleanup()
})

describe('settings page', () => {
  it('shows the plan as a badge and the organization id in mono, with a way to copy it', async () => {
    renderSettings()

    const general = await screen.findByRole('region', { name: 'General' })
    expect(within(general).getByText('Pro')).toBeDefined()
    expect(within(general).getByText(TENANT).className).toContain('font-mono')

    fireEvent.click(within(general).getByRole('button', { name: 'Copy organization id' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Organization id copied'))
    expect(writeText).toHaveBeenCalledWith(TENANT)
  })

  it('lets the owner rename the organization, and the switcher follows', async () => {
    renderSettings()

    const general = await screen.findByRole('region', { name: 'General' })
    const name = within(general).getByLabelText('Organization name') as HTMLInputElement
    expect(name.value).toBe('Acme Robotics')

    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.click(within(general).getByRole('button', { name: 'Save name' }))
    expect(await within(general).findByText('Enter a name for the organization')).toBeDefined()
    expect(callsTo('PUT', /^\/api\/v1\/tenants\//)).toHaveLength(0)

    fireEvent.change(name, { target: { value: ' Acme Labs ' } })
    fireEvent.click(within(general).getByRole('button', { name: 'Save name' }))

    expect(await screen.findByRole('link', { name: 'Switch organization: Acme Labs' })).toBeDefined()
    expect(callsTo('PUT', new RegExp(`^/api/v1/tenants/${TENANT}$`)).map((call) => call.body)).toEqual([
      { name: 'Acme Labs' },
    ])
    expect(toast.success).toHaveBeenCalledWith('Renamed to Acme Labs')
  })

  it("puts a 400's field error on the name, and turns read-only after a 403", async () => {
    backend.renameFailure = fieldError(400, [{ field: 'name', message: 'Name is too long' }])
    renderSettings()

    const general = await screen.findByRole('region', { name: 'General' })
    fireEvent.change(within(general).getByLabelText('Organization name'), { target: { value: 'Acme Labs' } })
    fireEvent.click(within(general).getByRole('button', { name: 'Save name' }))
    expect(await within(general).findByText('Name is too long')).toBeDefined()

    // Demoted since the page loaded: the server refuses, and the refetched role takes the form away.
    backend.renameFailure = fieldError(403)
    backend.role = 'ADMIN'
    fireEvent.click(within(general).getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(within(general).queryByRole('textbox')).toBeNull())
    expect(toast.error).toHaveBeenCalledWith('Only an owner can rename Acme Robotics. Your role may have changed.')
    expect(screen.queryByRole('region', { name: 'Danger zone' })).toBeNull()
  })

  it.each(['ADMIN', 'VIEWER'])('shows an %s the settings read-only, with no danger zone', async (role) => {
    backend.role = role
    renderSettings()

    const general = await screen.findByRole('region', { name: 'General' })
    expect(within(general).getByText('Acme Robotics')).toBeDefined()
    expect(within(general).getByText('Pro')).toBeDefined()
    expect(within(general).getByText(TENANT)).toBeDefined()
    expect(within(general).queryByRole('textbox')).toBeNull()
    expect(within(general).queryByRole('button', { name: 'Save name' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Danger zone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete organization' })).toBeNull()
  })

  it('lists what goes with the organization, counted live', async () => {
    backend.features = 8
    backend.envs = 3
    backend.keys = [
      ...['71', '72', '73', '74', '75'].map((id) => ({ id, revokedAt: null })),
      { id: '76', revokedAt: '2026-10-20T00:00:00Z' },
      // Unrevoked but expired: no SDK is using it any more.
      { id: '77', revokedAt: null, expiresAt: '2020-01-01T00:00:00Z' },
    ]
    backend.members = 6
    backend.invitations = [
      { id: '61', status: 'PENDING' },
      { id: '62', status: 'PENDING' },
      { id: '63', status: 'EXPIRED' },
    ]
    renderSettings()

    const dialog = await openDeleteDialog()
    expect(within(dialog).getByText(/This can't be undone/)).toBeDefined()
    const consequences = await within(dialog).findByRole('list', { name: 'Deleted with it' })

    expect(within(consequences).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '8 flags, with their rules and overrides',
      '3 environments',
      '5 API keys in use, and SDKs using them stop immediately',
      '6 members, whose access ends; their accounts and other organizations stay',
      '2 pending invitations, whose links stop working',
    ])
    expect(callsTo('GET', /^\/api\/v1\/(members|invitations)$/).map((call) => call.tenant)).toEqual([TENANT, TENANT])
  })

  it("enables delete only once the organization's exact name is typed", async () => {
    renderSettings()

    const dialog = await openDeleteDialog()
    const confirm = within(dialog).getByLabelText('Type Acme Robotics to confirm')
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete organization' })

    expect(deleteButton.hasAttribute('disabled')).toBe(true)
    for (const almost of ['acme robotics', 'Acme Robotics ', 'Acme']) {
      fireEvent.change(confirm, { target: { value: almost } })
      expect(deleteButton.hasAttribute('disabled')).toBe(true)
    }
    fireEvent.change(confirm, { target: { value: 'Acme Robotics' } })
    expect(deleteButton.hasAttribute('disabled')).toBe(false)
  })

  it('deletes the organization once, then lets the entry point pick the next one', async () => {
    backend.tenants.push({ id: OTHER, name: 'Globex', plan: 'FREE' })
    const router = renderSettings()

    const dialog = await openDeleteDialog()
    fireEvent.change(within(dialog).getByLabelText('Type Acme Robotics to confirm'), { target: { value: 'Acme Robotics' } })
    const release = holdTenantsList()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete organization' }))

    // Decided from the cache, without waiting for the refetch and without going back into the deleted one.
    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${OTHER}/flags`))
    release()
    expect(callsTo('DELETE', /^\/api\/v1\/tenants\//)).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('Acme Robotics deleted')
    // Its cached queries went with it, rather than refetching for an organization that no longer exists.
    const deletedAt = backend.calls.findIndex((call) => call.method === 'DELETE')
    expect(backend.calls.slice(deletedAt + 1).filter((call) => call.tenant === TENANT)).toEqual([])
  })

  it('sends the owner of their last organization to create one', async () => {
    const router = renderSettings()

    const dialog = await openDeleteDialog()
    fireEvent.change(within(dialog).getByLabelText('Type Acme Robotics to confirm'), { target: { value: 'Acme Robotics' } })
    const release = holdTenantsList()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete organization' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/orgs/new'))
    release()
    expect(callsTo('DELETE', /^\/api\/v1\/tenants\//)).toHaveLength(1)
    const deletedAt = backend.calls.findIndex((call) => call.method === 'DELETE')
    expect(backend.calls.slice(deletedAt + 1).filter((call) => call.tenant === TENANT)).toEqual([])
  })

  it('keeps the dialog open with the reason when a delete fails', async () => {
    backend.deleteFailure = fieldError(500)
    const router = renderSettings()

    const dialog = await openDeleteDialog()
    fireEvent.change(within(dialog).getByLabelText('Type Acme Robotics to confirm'), { target: { value: 'Acme Robotics' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete organization' }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Request failed (500)')
    expect(router.state.location.pathname).toBe(`/t/${TENANT}/settings`)
    expect(toast.success).not.toHaveBeenCalled()
  })
})
