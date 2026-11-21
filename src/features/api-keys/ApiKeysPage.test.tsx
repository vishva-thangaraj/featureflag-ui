// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'
import { formatDate, formatDateTime } from '@/lib/format'
import { rotatedName } from './queries'

const TENANT = '461168601842738689'

// An in-memory stand-in for the endpoints this page uses, following the server: keys are listed newest
// first with revoked ones included, the full key appears only in the create response, and revoking is
// idempotent. `use` plays an SDK making its first request with a key.
const backend = vi.hoisted(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // Radix Select scrolls the chosen option into view as it opens; jsdom has no layout to scroll.
  Element.prototype.scrollIntoView = () => {}
  type Key = {
    id: string
    name: string
    envName: string
    prefix: string
    createdAt: string
    lastUsedAt: string | null
    expiresAt: string | null
    revokedAt: string | null
  }
  const state = {
    role: 'OWNER',
    envs: [] as { id: string; name: string; description: null; createdAt: string }[],
    keys: [] as Key[],
    /** Answers the next create instead of the server's rules, once. */
    createFailure: null as { status: number; body: unknown } | null,
    /** While set, creates wait for it: a request still in flight. */
    createGate: null as Promise<void> | null,
    calls: [] as { method: string; path: string; body?: unknown }[],
    nextId: 7400,
    use(id: string) {
      state.keys.find((key) => key.id === id)!.lastUsedAt = new Date().toISOString()
    },
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      const method = request.method
      const body = method === 'POST' ? await request.json() : undefined
      state.calls.push({ method, path, body })

      if (path === '/api/v1/tenants') {
        return reply({ tenants: [{ id: '461168601842738689', name: 'Acme', plan: 'FREE', roles: [{ id: '1', name: state.role }] }] })
      }
      if (path === '/api/v1/envs') {
        return reply({ envs: state.envs })
      }
      if (path === '/api/v1/api-keys' && method === 'GET') {
        return reply({ apiKeys: state.keys })
      }
      if (path === '/api/v1/api-keys' && method === 'POST') {
        await state.createGate
        if (state.createFailure) {
          const { status, body: failure } = state.createFailure
          state.createFailure = null
          return reply(failure, status)
        }
        const { name, envName, expiresAt } = body as { name: string; envName: string; expiresAt?: string }
        if (!state.envs.some((env) => env.name === envName)) {
          return reply({ status: 404, error: 'Not Found', message: 'Environment not found', timestamp: '' }, 404)
        }
        const id = `89407960211060${state.nextId++}`
        const key = `ffsdk_${id}${'k'.repeat(43 - id.length)}`
        const apiKey = {
          id,
          name,
          envName,
          prefix: key.slice(0, 12),
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          expiresAt: expiresAt ?? null,
          revokedAt: null,
        }
        state.keys.unshift(apiKey)
        return reply({ apiKey, key }, 201)
      }
      const key = state.keys.find((candidate) => path === `/api/v1/api-keys/${candidate.id}`)
      if (key && method === 'DELETE') {
        key.revokedAt ??= new Date().toISOString()
        return reply(undefined, 204)
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

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

const DEV = { id: '501', name: 'development', description: null, createdAt: '2026-10-01T00:00:01Z' }
const STAGING = { id: '502', name: 'staging', description: null, createdAt: '2026-10-01T00:00:02Z' }
const PROD = { id: '503', name: 'production', description: null, createdAt: '2026-10-01T00:00:03Z' }

function apiKey(id: string, name: string, envName: string, createdAt: string, extra: Partial<(typeof backend.keys)[number]> = {}) {
  return { id, name, envName, prefix: `ffsdk_${id.slice(-6)}`, createdAt, lastUsedAt: null, expiresAt: null, revokedAt: null, ...extra }
}

const WEB_PROD = () => apiKey('894079602110607473', 'web-prod', 'production', '2026-11-10T09:00:00Z', { lastUsedAt: ago(3 * MINUTE) })

let queryClient: QueryClient

function renderAt(path = `/t/${TENANT}/api-keys`) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const keyNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].firstElementChild?.textContent)

const cellsOf = (name: string) =>
  within(screen.getAllByRole('row').find((row) => within(row).queryAllByRole('cell')[0]?.firstElementChild?.textContent === name)!).getAllByRole('cell')

const callsTo = (method: string, path: string) => backend.calls.filter((call) => call.method === method && call.path === path)

const deleteCalls = () => backend.calls.filter((call) => call.method === 'DELETE')

/** Everything TanStack still holds, mutations included: a full key must not outlive its dialog there. */
const cachedState = () =>
  JSON.stringify([
    ...queryClient.getQueryCache().getAll().map((query) => query.state.data),
    ...queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data),
  ])

// TanStack hands a mutation's new state to React on the next task.
const nextTask = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function holdCreates() {
  let release!: () => void
  backend.createGate = new Promise((resolve) => {
    release = resolve
  })
  return release
}

function chooseOption(trigger: HTMLElement, name: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(screen.getByRole('option', { name }))
}

const writeText = vi.fn(async (_text: string) => {})

beforeEach(() => {
  backend.role = 'OWNER'
  backend.envs = [DEV, STAGING, PROD]
  backend.keys = []
  backend.createFailure = null
  backend.createGate = null
  backend.nextId = 7400
  backend.calls = []
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('API keys page', () => {
  it('lists keys newest first with their environment, prefix, approximate last use, expiry and status', async () => {
    const expiresSoon = ahead(4 * DAY)
    const expired = ago(DAY)
    backend.keys = [
      WEB_PROD(),
      apiKey('894079602110607474', 'old-batch', 'staging', '2026-11-01T09:00:00Z', { expiresAt: expired }),
      apiKey('894079602110607475', 'ci-staging', 'staging', '2026-11-14T09:00:00Z'),
      apiKey('894079602110607476', 'ios-prod', 'production', '2026-11-12T09:00:00Z', {
        lastUsedAt: ago(2 * DAY),
        expiresAt: expiresSoon,
      }),
      apiKey('894079602110607477', 'far-off', 'development', '2026-11-11T09:00:00Z', { expiresAt: ahead(60 * DAY) }),
    ]

    renderAt()

    await screen.findByText('web-prod')
    expect(keyNames()).toEqual(['ci-staging', 'ios-prod', 'far-off', 'web-prod', 'old-batch'])

    const [webName, webEnv, webLastUsed, webExpires, webStatus] = cellsOf('web-prod')
    expect(within(webEnv).getByRole('img', { name: 'protected' })).toBeDefined()
    expect(webEnv.textContent).toBe('production')
    expect(webName.querySelector('code')?.textContent).toBe('ffsdk_607473…')
    expect(webLastUsed.textContent).toBe('around 3 minutes ago')
    expect(within(webLastUsed).getByText('around 3 minutes ago').getAttribute('title')).toBe(
      formatDateTime(backend.keys[0].lastUsedAt!),
    )
    expect(webExpires.textContent).toBe('—')
    expect(webStatus.textContent).toBe('Active')

    const [, ciEnv, ciLastUsed, , ciStatus] = cellsOf('ci-staging')
    expect(within(ciEnv).queryByRole('img', { name: 'protected' })).toBeNull()
    expect(ciLastUsed.textContent).toBe('Never')
    expect(ciStatus.textContent).toBe('Active')

    const [, , iosLastUsed, iosExpires, iosStatus] = cellsOf('ios-prod')
    expect(iosLastUsed.textContent).toBe('around 2 days ago')
    expect(iosExpires.textContent).toBe(formatDate(expiresSoon))
    expect(iosStatus.textContent).toBe('Expires in 4 days')

    expect(cellsOf('far-off')[4].textContent).toBe('Active')
    expect(cellsOf('old-batch')[4].textContent).toBe('Expired')
  })

  it('hides revoked keys until asked, filters by environment, and keeps both in the URL', async () => {
    backend.keys = [
      WEB_PROD(),
      apiKey('894079602110607480', 'ci-staging', 'staging', '2026-11-14T09:00:00Z'),
      apiKey('894079602110607481', 'retired', 'staging', '2026-11-02T09:00:00Z', { revokedAt: '2026-11-03T00:00:00Z' }),
    ]
    const router = renderAt()

    await screen.findByText('web-prod')
    expect(keyNames()).toEqual(['ci-staging', 'web-prod'])

    fireEvent.click(screen.getByRole('checkbox', { name: /Show revoked/ }))
    await waitFor(() => expect(keyNames()).toEqual(['ci-staging', 'web-prod', 'retired']))
    expect(cellsOf('retired')[4].textContent).toBe('Revoked')
    expect(new URLSearchParams(router.state.location.search).get('revoked')).toBe('show')

    chooseOption(screen.getByLabelText('Environment'), 'staging')
    await waitFor(() => expect(keyNames()).toEqual(['ci-staging', 'retired']))
    expect(new URLSearchParams(router.state.location.search).get('env')).toBe('staging')

    chooseOption(screen.getByLabelText('Environment'), 'All')
    await waitFor(() => expect(keyNames()).toEqual(['ci-staging', 'web-prod', 'retired']))
    expect(new URLSearchParams(router.state.location.search).has('env')).toBe(false)
  })

  it('opens with the filters a shared URL carries', async () => {
    backend.keys = [
      WEB_PROD(),
      apiKey('894079602110607480', 'ci-staging', 'staging', '2026-11-14T09:00:00Z'),
      apiKey('894079602110607481', 'retired', 'staging', '2026-11-02T09:00:00Z', { revokedAt: '2026-11-03T00:00:00Z' }),
    ]
    renderAt(`/t/${TENANT}/api-keys?env=staging&revoked=show`)

    await screen.findByText('ci-staging')
    expect(keyNames()).toEqual(['ci-staging', 'retired'])
    expect((screen.getByRole('checkbox', { name: /Show revoked/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('says why a filtered view is empty, with the way back', async () => {
    backend.keys = [apiKey('894079602110607481', 'retired', 'staging', '2026-11-02T09:00:00Z', { revokedAt: '2026-11-03T00:00:00Z' })]
    const router = renderAt(`/t/${TENANT}/api-keys?env=development`)

    expect(await screen.findByRole('heading', { name: 'No keys for development' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Show all environments' }))
    expect(screen.getByRole('heading', { name: 'Every key is revoked' })).toBeDefined()
    expect(new URLSearchParams(router.state.location.search).has('env')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Show revoked' }))
    await waitFor(() => expect(keyNames()).toEqual(['retired']))
  })

  it.each(['VIEWER', 'MEMBER'])('shows a %s the same list without create, revoke or rotate', async (role) => {
    backend.role = role
    backend.keys = [WEB_PROD()]

    renderAt()

    await screen.findByText('web-prod')
    expect(screen.getByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke web-prod' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rotate web-prod' })).toBeNull()
    expect(cellsOf('web-prod')).toHaveLength(5)
  })

  it('offers a writer the first key when there are none, and tells a viewer to ask', async () => {
    renderAt()

    expect(await screen.findByRole('heading', { name: 'No API keys yet' })).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Create key' })).toHaveLength(1)

    cleanup()
    backend.role = 'VIEWER'
    renderAt()

    expect(await screen.findByRole('heading', { name: 'No API keys yet' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull()
    expect(screen.getByText('Ask an admin to create one.')).toBeDefined()
  })

  it('points to Environments when there are none to issue a key for', async () => {
    backend.envs = []
    renderAt()

    expect(await screen.findByRole('heading', { name: 'Set up environments first' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Go to Environments' }).getAttribute('href')).toBe(`/t/${TENANT}/environments`)
    expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull()
  })

  it('checks a new key, and puts the server’s field errors and conflicts on the form', async () => {
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create key' })
    expect((within(dialog).getByRole('radio', { name: 'No expiry' }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }))
    expect(await within(dialog).findByText('Enter a name')).toBeDefined()
    expect(within(dialog).getByText('Choose an environment')).toBeDefined()

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x'.repeat(101) } })
    fireEvent.blur(within(dialog).getByLabelText('Name'))
    expect(await within(dialog).findByText('Use at most 100 characters')).toBeDefined()

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'web-prod' } })
    chooseOption(within(dialog).getByLabelText('Environment'), 'staging')
    backend.createFailure = {
      status: 400,
      body: {
        status: 400,
        error: 'Bad Request',
        message: 'Request validation failed',
        timestamp: '',
        fieldErrors: [{ field: 'name', message: 'must not be blank' }],
      },
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }))
    expect(await within(dialog).findByText('must not be blank')).toBeDefined()

    backend.createFailure = {
      status: 409,
      body: { status: 409, error: 'Conflict', message: 'The request conflicts with the current state of the resource.', timestamp: '' },
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The request conflicts with the current state of the resource.')
    expect(within(dialog).queryByText('Key created')).toBeNull()
    expect(backend.keys).toHaveLength(0)
  })

  it('shows a new key once, with copy buttons and a curl to try it, and Done only once it is stored', async () => {
    backend.keys = [WEB_PROD()]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create key' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'ci-staging' } })
    chooseOption(within(dialog).getByLabelText('Environment'), 'staging')
    fireEvent.click(within(dialog).getByRole('radio', { name: '30 days' }))
    expect(within(dialog).getByText(/^Stops working on/)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }))

    const created = await screen.findByRole('dialog', { name: 'Key created' })
    const [post] = callsTo('POST', '/api/v1/api-keys')
    const sent = post.body as { name: string; envName: string; expiresAt: string }
    expect(sent.name).toBe('ci-staging')
    expect(sent.envName).toBe('staging')
    expect(Math.abs(Date.parse(sent.expiresAt) - (Date.now() + 30 * DAY))).toBeLessThan(MINUTE)

    const fullKey = `ffsdk_894079602110607400${'k'.repeat(25)}`
    const curl = `curl -H "X-API-Key: ${fullKey}" ${window.location.origin}/api/v1/sdk/config`
    expect(within(created).getByText(fullKey).tagName).toBe('CODE')
    expect(within(created).getByText(curl)).toBeDefined()
    expect(within(created).getByText(/only time the key is shown/)).toBeDefined()
    await waitFor(() => expect(document.activeElement).toBe(within(created).getByRole('button', { name: 'Copy key' })))

    fireEvent.click(within(created).getByRole('button', { name: 'Copy key' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(fullKey))
    expect(toast.success).toHaveBeenCalledWith('Key copied')
    fireEvent.click(within(created).getByRole('button', { name: 'Copy command' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(curl))

    const done = within(created).getByRole('button', { name: 'Done' })
    expect(done.hasAttribute('disabled')).toBe(true)
    expect(done.getAttribute('aria-describedby')).toBe(within(created).getByText("I've stored this key somewhere safe").id)
    fireEvent.click(within(created).getByRole('checkbox', { name: "I've stored this key somewhere safe" }))
    expect(done.hasAttribute('disabled')).toBe(false)
    fireEvent.click(done)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(keyNames()).toEqual(['ci-staging', 'web-prod']))
    expect(screen.queryByText(fullKey)).toBeNull()
    expect(cellsOf('ci-staging')[0].querySelector('code')?.textContent).toBe('ffsdk_894079…')
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
    expect(cachedState()).not.toContain(fullKey)
  })

  it('stays open while a key is being created, so its secret is never lost', async () => {
    backend.keys = [WEB_PROD()]
    renderAt(`/t/${TENANT}/api-keys?env=production`)

    fireEvent.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create key' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'web-prod-2' } })
    const release = holdCreates()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(callsTo('POST', '/api/v1/api-keys')).toHaveLength(1))
    await nextTask()
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('dialog', { name: 'Create key' })).toBeDefined()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    release()
    const created = await screen.findByRole('dialog', { name: 'Key created' })
    expect(within(created).getByText(`ffsdk_894079602110607400${'k'.repeat(25)}`)).toBeDefined()
  })

  it('asks before closing a new key that has not been marked as stored', async () => {
    backend.keys = [WEB_PROD()]
    renderAt(`/t/${TENANT}/api-keys?env=production`)

    fireEvent.click(await screen.findByRole('button', { name: 'Create key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create key' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'web-prod-2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }))
    const created = await screen.findByRole('dialog', { name: 'Key created' })
    expect((callsTo('POST', '/api/v1/api-keys')[0].body as { envName: string }).envName).toBe('production')

    fireEvent.keyDown(created, { key: 'Escape' })
    const confirm = await screen.findByRole('alertdialog', { name: "You won't be able to see this key again. Close anyway?" })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Go back' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Key created' })).toBeDefined()

    fireEvent.click(within(created).getByRole('button', { name: 'Close' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: /Close anyway/ })).getByRole('button', { name: 'Close anyway' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/ffsdk_894079602110607400/)).toBeNull()
  })

  it('revokes a key after saying what stops, and only when confirmed', async () => {
    backend.keys = [WEB_PROD(), apiKey('894079602110607480', 'ci-staging', 'staging', '2026-11-14T09:00:00Z')]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke web-prod' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Revoke web-prod?' })
    expect(
      within(dialog).getByText("Apps using it stop receiving flags on their next request. This can't be undone."),
    ).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleteCalls()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Revoke web-prod' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Revoke web-prod?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke key' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleteCalls().map((call) => call.path)).toEqual(['/api/v1/api-keys/894079602110607473'])
    expect(toast.success).toHaveBeenCalledWith('web-prod revoked')
    await waitFor(() => expect(keyNames()).toEqual(['ci-staging']))
  })

  it('rotates a key: replacement first, then waits for it to be used before the old key can be revoked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    backend.keys = [WEB_PROD()]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate web-prod' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rotate web-prod' })
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(rotatedName('web-prod'))
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).getByText('production')).toBeDefined()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create replacement' }))
    await within(dialog).findByText("Waiting for the new key's first request")
    expect(callsTo('POST', '/api/v1/api-keys').map((call) => call.body)).toEqual([
      { name: rotatedName('web-prod'), envName: 'production' },
    ])
    const replacementId = backend.keys[0].id
    const replacementKey = `ffsdk_${replacementId}${'k'.repeat(25)}`
    expect(within(dialog).getByText(replacementKey)).toBeDefined()
    expect(within(dialog).getByText(/up to five minutes/)).toBeDefined()
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Copy key' })))
    expect(within(dialog).getByText('Create the replacement').closest('li')?.textContent).toBe('Create the replacement (done)')
    const status = within(dialog).getByRole('status')

    const continueButton = within(dialog).getByRole('button', { name: 'Continue' })
    expect(continueButton.hasAttribute('disabled')).toBe(true)
    expect(within(dialog).queryByRole('button', { name: /Revoke/ })).toBeNull()

    // Polls while waiting, and offers nothing new until the key is seen.
    const listCalls = () => callsTo('GET', '/api/v1/api-keys').length
    const before = listCalls()
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    await waitFor(() => expect(listCalls()).toBe(before + 1))
    expect(continueButton.hasAttribute('disabled')).toBe(true)
    expect(deleteCalls()).toHaveLength(0)

    backend.use(replacementId)
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(await within(dialog).findByText('Seen just now')).toBe(status)
    expect(continueButton.hasAttribute('disabled')).toBe(false)
    expect(deleteCalls()).toHaveLength(0)

    // Seen: no more polling.
    const seenAfter = listCalls()
    await act(() => vi.advanceTimersByTimeAsync(45_000))
    expect(listCalls()).toBe(seenAfter)

    fireEvent.click(continueButton)
    expect(within(dialog).getByText('Revoke web-prod?')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke old key' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteCalls().map((call) => call.path)).toEqual(['/api/v1/api-keys/894079602110607473'])
    expect(backend.keys.find((key) => key.id === replacementId)?.revokedAt).toBeNull()
    expect(toast.success).toHaveBeenCalledWith(`web-prod revoked. ${rotatedName('web-prod')} replaces it.`)
    // The revoke mutation may linger; the create one, which held the key, must not.
    await waitFor(() => expect(cachedState()).not.toContain(replacementKey))
  })

  it('checks for the new key on request, and moves focus to Continue when it is seen', async () => {
    backend.keys = [WEB_PROD()]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate web-prod' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rotate web-prod' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create replacement' }))
    await within(dialog).findByText("Waiting for the new key's first request")

    const checkNow = within(dialog).getByRole('button', { name: 'Check now' })
    const before = callsTo('GET', '/api/v1/api-keys').length
    checkNow.focus()
    fireEvent.click(checkNow)
    await waitFor(() => expect(callsTo('GET', '/api/v1/api-keys')).toHaveLength(before + 1))
    expect(within(dialog).getByRole('status').textContent).toBe("Waiting for the new key's first request")

    backend.use(backend.keys[0].id)
    checkNow.focus()
    fireEvent.click(checkNow)
    expect(await within(dialog).findByText('Seen just now')).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: 'Check now' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Continue' })))
  })

  it('stops polling once a rotation is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    backend.keys = [WEB_PROD()]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate web-prod' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rotate web-prod' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create replacement' }))
    await within(dialog).findByText("Waiting for the new key's first request")
    const before = callsTo('GET', '/api/v1/api-keys').length
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    await waitFor(() => expect(callsTo('GET', '/api/v1/api-keys')).toHaveLength(before + 1))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close anyway' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const afterClose = callsTo('GET', '/api/v1/api-keys').length
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(callsTo('GET', '/api/v1/api-keys')).toHaveLength(afterClose)
  })

  it('stays open while the replacement is being created', async () => {
    backend.keys = [WEB_PROD()]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate web-prod' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rotate web-prod' })
    const release = holdCreates()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create replacement' }))
    await waitFor(() => expect(callsTo('POST', '/api/v1/api-keys')).toHaveLength(1))
    await nextTask()
    expect(within(dialog).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog', { name: 'Rotate web-prod' })).toBeDefined()

    release()
    expect(await within(dialog).findByText("Waiting for the new key's first request")).toBeDefined()
    expect(within(dialog).getByText(`ffsdk_${backend.keys[0].id}${'k'.repeat(25)}`)).toBeDefined()
  })

  it('never revokes the old key when a rotation is closed before the new key is seen', async () => {
    backend.keys = [WEB_PROD()]
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate web-prod' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rotate web-prod' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create replacement' }))
    await within(dialog).findByText("Waiting for the new key's first request")

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    const confirm = await screen.findByRole('alertdialog', { name: "You won't be able to see this key again. Close anyway?" })
    expect(within(confirm).getByText(/web-prod keeps working/)).toBeDefined()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Close anyway' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteCalls()).toHaveLength(0)
    await waitFor(() => expect(keyNames()).toEqual([rotatedName('web-prod'), 'web-prod']))
    expect(cellsOf('web-prod')[4].textContent).toBe('Active')
  })
})
