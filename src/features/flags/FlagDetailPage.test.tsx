// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'

const TENANT = '461168601842738689'
const FEATURE = '9007199254740993'

// An in-memory stand-in for the flag endpoints, following the server's rules: the first write in an
// environment creates the row there (off, rollout 100 unless one is sent), an enable without a rollout
// keeps the existing one, and the SDK config leaves paused rules out.
const backend = vi.hoisted(() => {
  type StoredRule = { id: string; enabled: boolean; attribute: string } & Record<string, unknown>
  type Row = {
    featureKey: string
    environment: string
    enabled: boolean
    rolloutPercentage: number
    rules: StoredRule[]
    overrides: { externalUserId: string; enabled: boolean }[]
    lastModified: string
  }
  const state = {
    role: 'OWNER',
    envs: [
      { id: '501', name: 'development', description: null, createdAt: '2026-10-01T00:00:01Z' },
      { id: '502', name: 'staging', description: null, createdAt: '2026-10-01T00:00:02Z' },
      { id: '503', name: 'production', description: null, createdAt: '2026-10-01T00:00:03Z' },
    ],
    features: [] as { id: string; key: string; description: string | null; createdAt: string }[],
    rows: {} as Record<string, Row>,
    ruleSaveError: null as { status: number; body: unknown } | null,
    calls: [] as { method: string; path: string; body?: unknown }[],
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const notFound = () => reply({ status: 404, error: 'Not Found', message: 'Not found', timestamp: '' }, 404)
  const sdkView = (row: Row) => ({
    featureKey: row.featureKey,
    environment: row.environment,
    enabled: row.enabled,
    rolloutPercentage: row.rolloutPercentage,
    enabledUsers: row.overrides.filter((override) => override.enabled).map((override) => override.externalUserId),
    disabledUsers: row.overrides.filter((override) => !override.enabled).map((override) => override.externalUserId),
    rules: row.rules.filter((rule) => rule.enabled),
    lastModified: row.lastModified,
  })
  let nextRuleId = 900

  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
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
      if (path === '/api/v1/envs') {
        return reply({ envs: state.envs })
      }
      if (path === '/api/v1/features') {
        return reply({ features: state.features })
      }
      if (path === '/api/v1/config') {
        const envName = url.searchParams.get('envName')
        return reply({ environment: envName, flags: Object.values(state.rows).filter((row) => row.environment === envName).map(sdkView), lastModified: '' })
      }
      const configKey = path.match(/^\/api\/v1\/config\/([^/]+)$/)?.[1]
      if (configKey) {
        const row = state.rows[`${url.searchParams.get('envName')}/${configKey}`]
        return row ? reply(sdkView(row)) : notFound()
      }
      const [, featureId, rest] = path.match(/^\/api\/v1\/features\/(\d+)(\/.*)?$/) ?? []
      const feature = state.features.find((candidate) => candidate.id === featureId)
      if (!feature) {
        return notFound()
      }
      const rowIn = (envId: string, create: boolean) => {
        const env = state.envs.find((candidate) => candidate.id === envId)!
        const key = `${env.name}/${feature.key}`
        if (create) {
          state.rows[key] ??= {
            featureKey: feature.key,
            environment: env.name,
            enabled: false,
            rolloutPercentage: 100,
            rules: [],
            overrides: [],
            lastModified: '',
          }
        }
        return state.rows[key] as Row | undefined
      }
      if (rest === '/envs') {
        return reply(
          state.envs
            .filter((env) => state.rows[`${env.name}/${feature.key}`])
            .map((env) => {
              const row = state.rows[`${env.name}/${feature.key}`]
              return { id: `s${env.id}`, featureId: feature.id, envId: env.id, envName: env.name, enabled: row.enabled, rolloutPercentage: row.rolloutPercentage }
            }),
        )
      }
      if (rest === '/rules/attributes') {
        return reply([...new Set(Object.values(state.rows).flatMap((row) => row.rules.map((rule) => rule.attribute)))])
      }
      const rulesEnv = rest?.match(/^\/envs\/(\d+)\/rules$/)?.[1]
      if (rulesEnv && method === 'GET') {
        return reply(rowIn(rulesEnv, false)?.rules ?? [])
      }
      if (rulesEnv && method === 'PUT') {
        if (state.ruleSaveError) {
          return reply(state.ruleSaveError.body, state.ruleSaveError.status)
        }
        const row = rowIn(rulesEnv, true)!
        row.rules = (body as { rules: StoredRule[] }).rules.map((rule) => ({ ...rule, id: String(++nextRuleId) }))
        return reply(row.rules)
      }
      const [, overridesEnv, userId] = rest?.match(/^\/envs\/(\d+)\/overrides(?:\/(.+))?$/) ?? []
      if (overridesEnv && method === 'GET') {
        return reply((rowIn(overridesEnv, false)?.overrides ?? []).map((override) => ({ id: `o-${override.externalUserId}`, ...override })))
      }
      if (overridesEnv && method === 'POST') {
        const row = rowIn(overridesEnv, true)!
        const sent = body as { externalUserId: string; enabled: boolean }
        row.overrides = [...row.overrides.filter((override) => override.externalUserId !== sent.externalUserId), sent]
        return reply({ id: `o-${sent.externalUserId}`, ...sent }, 201)
      }
      if (overridesEnv && method === 'DELETE') {
        const row = rowIn(overridesEnv, false)!
        row.overrides = row.overrides.filter((override) => override.externalUserId !== decodeURIComponent(userId))
        return reply(undefined, 204)
      }
      if (rest === '/enable') {
        const { envId, enabled, rolloutPercentage } = body as { envId: string; enabled: boolean; rolloutPercentage?: number }
        const row = rowIn(envId, true)!
        row.enabled = enabled
        row.rolloutPercentage = rolloutPercentage ?? row.rolloutPercentage
        row.lastModified = '2026-11-21T12:00:00Z'
        return reply(undefined, 200)
      }
      if (method === 'PUT') {
        feature.description = (body as { description: string }).description
        return reply(feature)
      }
      if (method === 'DELETE') {
        state.features = state.features.filter((candidate) => candidate !== feature)
        state.rows = Object.fromEntries(Object.entries(state.rows).filter(([, row]) => row.featureKey !== feature.key))
        return reply(undefined, 204)
      }
      return reply(feature)
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

function row(environment: string, enabled: boolean, rolloutPercentage = 100, extra = {}) {
  return {
    featureKey: 'checkout_v2',
    environment,
    enabled,
    rolloutPercentage,
    rules: [],
    overrides: [],
    lastModified: '2026-11-20T00:00:00Z',
    ...extra,
  }
}

function storedRule(id: string, attribute: string, operator: string, valueType: string, values: unknown[], extra = {}) {
  return { id, attribute, operator, valueType, values, caseSensitive: false, negated: false, enabled: true, priority: 0, ...extra }
}

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

const flagPath = (env?: string) => `/t/${TENANT}/flags/${FEATURE}${env ? `?env=${env}` : ''}`
const posts = (suffix: string) => backend.calls.filter((call) => call.method === 'POST' && call.path.endsWith(suffix))

async function changeRolloutTo(value: number) {
  fireEvent.change(await screen.findByLabelText('Rollout percentage'), { target: { value: String(value) } })
}

beforeEach(() => {
  localStorage.clear()
  backend.role = 'OWNER'
  backend.features = [{ id: FEATURE, key: 'checkout_v2', description: 'New checkout flow', createdAt: '2026-09-03T00:00:00Z' }]
  backend.rows = {
    'development/checkout_v2': row('development', false),
    'staging/checkout_v2': row('staging', true, 25, {
      overrides: [
        { externalUserId: 'u-1', enabled: true },
        { externalUserId: 'u-2', enabled: true },
        { externalUserId: 'u-3', enabled: true },
        { externalUserId: 'u-9', enabled: false },
      ],
      rules: [
        storedRule('701', 'country', 'IN', 'STRING', ['IN', 'US']),
        storedRule('702', 'appVersion', 'SEMVER_GTE', 'SEMVER', ['2.4.0'], { priority: 1 }),
        storedRule('703', 'plan', 'EQUALS', 'STRING', ['beta'], { priority: 2, enabled: false }),
      ],
    }),
  }
  backend.ruleSaveError = null
  backend.calls = []
})

afterEach(() => {
  cleanup()
})

describe('flag page', () => {
  it('says who gets the flag, with every environment summarised in its tab', async () => {
    renderAt(flagPath('staging'))

    expect(
      await screen.findByText('On for 3 allowed users, and for 25% of users who match both rules. 1 user never gets it.'),
    ).toBeDefined()
    expect(screen.getByRole('heading', { name: 'checkout_v2' })).toBeDefined()
    expect(screen.getByRole('tab', { name: /^development/ }).textContent).toContain('Off')
    expect(screen.getByRole('tab', { name: /^staging/ }).textContent).toContain('On · 25%')
    expect(screen.getByRole('tab', { name: /production/ }).textContent).toContain('Not set up')
    expect(screen.getByRole('tab', { name: /^staging/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('sets the flag up switched off where it is not set up yet', async () => {
    renderAt(flagPath('production'))
    expect(await screen.findByText("Not set up in production. SDKs don't receive it.")).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Set up in production' }))

    expect(await screen.findByText('Off for everyone in production.')).toBeDefined()
    expect(posts('/enable')[0].body).toEqual({ envId: '503', enabled: false })
    await waitFor(() => expect(screen.getByRole('tab', { name: /production/ }).textContent).toContain('Off'))
  })

  it('keeps a rollout change as a draft, describes it, and saves it with the current on/off state', async () => {
    renderAt(flagPath('staging'))
    await changeRolloutTo(50)

    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(within(bar).getByText('Rollout 25% → 50%')).toBeDefined()
    expect(screen.getByText(/After saving:/).parentElement?.textContent).toContain('50% of users who match both rules')
    expect(posts('/enable')).toHaveLength(0)

    // Someone switches the flag off meanwhile; the save must not switch it back on.
    backend.rows['staging/checkout_v2'].enabled = false
    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posts('/enable')).toHaveLength(1))
    expect(posts('/enable')[0].body).toEqual({ envId: '502', enabled: false, rolloutPercentage: 50 })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull())
  })

  it('does not announce an outcome the draft leaves unchanged', async () => {
    renderAt(flagPath('development'))
    await changeRolloutTo(50)

    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeDefined()
    expect(screen.getByText('Off for everyone in development.')).toBeDefined()
    expect(screen.queryByText(/After saving:/)).toBeNull()
  })

  it('discards a draft', async () => {
    renderAt(flagPath('staging'))
    await changeRolloutTo(80)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
    expect((screen.getByLabelText('Rollout percentage') as HTMLInputElement).value).toBe('25')
  })

  it('shows the change before saving it to a protected environment', async () => {
    backend.rows['production/checkout_v2'] = row('production', true, 25)
    renderAt(flagPath('production'))
    await changeRolloutTo(50)

    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }))
    const review = await screen.findByRole('alertdialog', { name: 'Save changes to production?' })
    expect(within(review).getByText('Rollout 25% → 50%')).toBeDefined()
    await waitFor(() => expect(document.activeElement).toBe(within(review).getByRole('button', { name: 'Save to production' })))
    expect(posts('/enable')).toHaveLength(0)

    fireEvent.click(within(review).getByRole('button', { name: 'Save to production' }))

    await waitFor(() => expect(posts('/enable')).toHaveLength(1))
    expect(posts('/enable')[0].body).toEqual({ envId: '503', enabled: true, rolloutPercentage: 50 })
  })

  it('stops before overwriting a rollout someone else changed meanwhile', async () => {
    renderAt(flagPath('staging'))
    await changeRolloutTo(50)
    backend.rows['staging/checkout_v2'].rolloutPercentage = 40

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const conflict = await screen.findByRole('alertdialog', { name: 'Someone changed this flag while you were editing' })
    expect(within(conflict).getByText(/The rollout in staging is now 40%\./)).toBeDefined()
    expect(posts('/enable')).toHaveLength(0)

    fireEvent.click(within(conflict).getByRole('button', { name: 'Save mine anyway' }))

    await waitFor(() => expect(posts('/enable')).toHaveLength(1))
    expect(posts('/enable')[0].body).toEqual({ envId: '502', enabled: true, rolloutPercentage: 50 })
  })

  it('can keep the other change instead', async () => {
    renderAt(flagPath('staging'))
    await changeRolloutTo(50)
    backend.rows['staging/checkout_v2'].rolloutPercentage = 40

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard mine' }))

    await waitFor(() => expect((screen.getByLabelText('Rollout percentage') as HTMLInputElement).value).toBe('40'))
    expect(posts('/enable')).toHaveLength(0)
  })

  it('asks before leaving with unsaved changes', async () => {
    const router = renderAt(flagPath('staging'))
    await changeRolloutTo(50)

    fireEvent.click(screen.getByRole('tab', { name: /^development/ }))
    const guard = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })
    fireEvent.click(within(guard).getByRole('button', { name: 'Keep editing' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(new URLSearchParams(router.state.location.search).get('env')).toBe('staging')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeDefined()

    fireEvent.click(screen.getByRole('tab', { name: /^development/ }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }))

    await screen.findByText('Off for everyone in development.')
    expect(new URLSearchParams(router.state.location.search).get('env')).toBe('development')
  })

  it('edits the description in place', async () => {
    renderAt(flagPath('staging'))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit description' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Saved cards at checkout' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved cards at checkout')).toBeDefined()
    expect(backend.calls.find((call) => call.method === 'PUT')?.body).toEqual({ description: 'Saved cards at checkout' })
  })

  it('deletes the flag and returns to the list, asking for the key while it is live in production', async () => {
    backend.rows['production/checkout_v2'] = row('production', true)
    const router = renderAt(flagPath('staging'))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'More actions for checkout_v2' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete flag' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete checkout_v2?' })
    expect(within(dialog).getByText(/setup in 3 environments/)).toBeDefined()
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete flag' })
    expect(deleteButton.hasAttribute('disabled')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Type checkout_v2 to confirm'), { target: { value: 'checkout_v2' } })
    fireEvent.click(deleteButton)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/${TENANT}/flags`))
    expect(backend.calls.some((call) => call.method === 'DELETE')).toBe(true)
  })

  it('says when the flag does not exist', async () => {
    renderAt(`/t/${TENANT}/flags/9007199254749999`)

    expect(await screen.findByRole('heading', { name: 'This flag was deleted or never existed' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back to flags' })).toBeDefined()
  })

  it('shows a viewer everything without a way to change it', async () => {
    backend.role = 'VIEWER'
    renderAt(flagPath('staging'))

    await screen.findByText(/On for 3 allowed users/)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByLabelText('Rollout percentage')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Rollout' })).getByText('25%')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Edit description' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions for checkout_v2' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /production/ }))
    await screen.findByText("Not set up in production. SDKs don't receive it.")
    expect(screen.queryByRole('button', { name: 'Set up in production' })).toBeNull()
  })
})

const ruleSaves = () => backend.calls.filter((call) => call.method === 'PUT' && call.path.endsWith('/rules'))

async function openMenu(name: string) {
  fireEvent.keyDown(await screen.findByRole('button', { name }), { key: 'Enter' })
}

function addValue(group: HTMLElement, value: string) {
  const input = within(group).getByLabelText('Values')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('targeting rules', () => {
  it('shows every rule as a row, paused ones included', async () => {
    renderAt(flagPath('staging'))

    const first = await screen.findByRole('group', { name: 'Rule 1' })
    expect((within(first).getByLabelText('Attribute') as HTMLInputElement).value).toBe('country')
    expect((within(first).getByLabelText('Operator') as HTMLSelectElement).value).toBe('IN')
    expect(within(first).getByRole('button', { name: 'Remove US' })).toBeDefined()
    const third = screen.getByRole('group', { name: 'Rule 3' })
    expect(within(third).getByText('Paused · not sent to SDKs')).toBeDefined()
    expect(screen.getByText('All rules must match. Their order doesn\'t change who matches.')).toBeDefined()
  })

  it('builds a rule and saves it with the rollout after one review', async () => {
    backend.rows['production/checkout_v2'] = row('production', true, 25)
    renderAt(flagPath('production'))

    expect(await screen.findByText('No rules. Everyone in the rollout gets this flag.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const rule = screen.getByRole('group', { name: 'Rule 1' })
    const attribute = within(rule).getByLabelText('Attribute')
    expect(document.activeElement).toBe(attribute)
    expect([...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toContain('country')

    fireEvent.change(attribute, { target: { value: 'plan' } })
    fireEvent.change(within(rule).getByLabelText('Operator'), { target: { value: 'IN' } })
    addValue(rule, 'pro')
    fireEvent.paste(within(rule).getByLabelText('Values'), { clipboardData: { getData: () => 'enterprise, pro' } })
    expect(within(rule).getAllByRole('button', { name: /^Remove / }).map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Remove pro',
      'Remove enterprise',
    ])
    await changeRolloutTo(50)

    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(within(bar).getByText('Rollout 25% → 50% · 1 rule added')).toBeDefined()
    expect(screen.getByText(/After saving:/).parentElement?.textContent).toContain('On for 50% of users who match its rule.')
    fireEvent.click(within(bar).getByRole('button', { name: 'Review and save' }))
    const review = await screen.findByRole('alertdialog', { name: 'Save changes to production?' })
    expect(within(review).getByText('Added: plan is one of pro, enterprise')).toBeDefined()
    expect(backend.calls.some((call) => call.method !== 'GET')).toBe(false)

    fireEvent.click(within(review).getByRole('button', { name: 'Save to production' }))

    await waitFor(() => expect(ruleSaves()).toHaveLength(1))
    expect(backend.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path.split('/').pop()}`)).toEqual([
      'POST enable',
      'PUT rules',
    ])
    expect(ruleSaves()[0].body).toEqual({
      rules: [
        { attribute: 'plan', operator: 'IN', valueType: 'STRING', values: ['pro', 'enterprise'], caseSensitive: false, negated: false, enabled: true, priority: 0 },
      ],
    })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull())
    expect(await screen.findByText('On for 50% of users who match its rule.')).toBeDefined()
  })

  it('starts a rule on a known attribute with that attribute\'s type', async () => {
    renderAt(flagPath('staging'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }))
    const rule = screen.getByRole('group', { name: 'Rule 4' })

    fireEvent.change(within(rule).getByLabelText('Attribute'), { target: { value: 'appVersion' } })

    expect((within(rule).getByLabelText('Type') as HTMLSelectElement).value).toBe('SEMVER')
    expect(within(within(rule).getByLabelText('Operator')).getByRole('option', { name: 'newer than' })).toBeDefined()
  })

  it('points at rule mistakes before anything is sent', async () => {
    renderAt(flagPath('development'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }))
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    const first = screen.getByRole('group', { name: 'Rule 1' })

    // Empty fields aren't errors until a save is tried.
    expect(screen.queryByText('Enter an attribute, like country or plan.')).toBeNull()
    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }))
    expect(within(first).getByText('Enter an attribute, like country or plan.')).toBeDefined()
    expect(within(first).getByText('Enter a value.')).toBeDefined()
    expect(within(bar).getByRole('alert').textContent).toBe('Fix the highlighted rules to save.')
    await waitFor(() => expect(document.activeElement).toBe(within(first).getByLabelText('Attribute')))

    fireEvent.change(within(first).getByLabelText('Attribute'), { target: { value: 'plan' } })
    fireEvent.change(within(first).getByLabelText('Value'), { target: { value: 'free' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const second = screen.getByRole('group', { name: 'Rule 2' })
    fireEvent.change(within(second).getByLabelText('Attribute'), { target: { value: 'plan' } })
    fireEvent.change(within(second).getByLabelText('Value'), { target: { value: 'pro' } })
    expect(within(first).getByText("Can't match together with rule 2: plan can't be both free and pro.")).toBeDefined()
    expect(within(second).getByText("Can't match together with rule 1: plan can't be both free and pro.")).toBeDefined()

    // Narrowing to a one-value operator keeps the values and says what to do with them.
    fireEvent.change(within(second).getByLabelText('Operator'), { target: { value: 'IN' } })
    fireEvent.change(within(second).getByLabelText('Values'), { target: { value: 'team,' } })
    expect(within(second).getByRole('button', { name: 'Remove team' })).toBeDefined()
    fireEvent.change(within(second).getByLabelText('Operator'), { target: { value: 'EQUALS' } })
    expect(within(second).getByText("'is' takes one value. Remove 1, or use 'is one of'.")).toBeDefined()

    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }))
    expect(ruleSaves()).toHaveLength(0)

    await openMenu('More options for rule 2')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete rule' }))
    expect(screen.queryByRole('group', { name: 'Rule 2' })).toBeNull()
    expect(screen.queryByText(/Can't match together/)).toBeNull()
  })

  it('negates, pauses and reorders rules from their menu', async () => {
    renderAt(flagPath('staging'))
    await screen.findByRole('group', { name: 'Rule 1' })

    await openMenu('More options for rule 1')
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Negate (NOT)' }))
    expect(within(screen.getByRole('group', { name: 'Rule 1' })).getByText('NOT')).toBeDefined()
    await openMenu('More options for rule 2')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pause rule' }))
    await openMenu('More options for rule 3')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Resume rule' }))
    await openMenu('More options for rule 3')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))

    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(within(bar).getByText('3 rules changed · Rules reordered')).toBeDefined()
    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ruleSaves()).toHaveLength(1))
    const sent = (ruleSaves()[0].body as { rules: { attribute: string; negated: boolean; enabled: boolean; priority: number }[] }).rules
    expect(sent.map(({ attribute, negated, enabled, priority }) => ({ attribute, negated, enabled, priority }))).toEqual([
      { attribute: 'country', negated: true, enabled: true, priority: 0 },
      { attribute: 'plan', negated: false, enabled: true, priority: 1 },
      { attribute: 'appVersion', negated: false, enabled: false, priority: 2 },
    ])
  })

  it('puts the server\'s rule errors where they belong and keeps the rules draft', async () => {
    backend.ruleSaveError = {
      status: 400,
      body: {
        status: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        timestamp: '',
        fieldErrors: [{ field: 'rules[1].values', message: 'must not be empty' }],
      },
    }
    renderAt(flagPath('staging'))
    const second = await screen.findByRole('group', { name: 'Rule 2' })
    fireEvent.change(within(second).getByLabelText('Value'), { target: { value: '2.5.0' } })
    await changeRolloutTo(50)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText("Rollout saved. Rules weren't: Fix the highlighted rules.")).toBeDefined()
    expect(within(second).getByText('must not be empty')).toBeDefined()
    expect(posts('/enable')[0].body).toEqual({ envId: '502', enabled: true, rolloutPercentage: 50 })
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(within(bar).getByText('1 rule changed')).toBeDefined()

    // A 409 names no rule, so its message goes above the rules.
    backend.ruleSaveError = {
      status: 409,
      body: { status: 409, error: 'Conflict', message: "Rules on 'appVersion' can't all match", timestamp: '' },
    }
    fireEvent.change(within(second).getByLabelText('Value'), { target: { value: '2.6.0' } })
    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("Rules weren't saved: Rules on 'appVersion' can't all match")).toBeDefined()

    backend.ruleSaveError = null
    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stops before replacing rules someone else changed meanwhile', async () => {
    renderAt(flagPath('staging'))
    fireEvent.click(within(await screen.findByRole('group', { name: 'Rule 1' })).getByRole('button', { name: 'Remove US' }))
    backend.rows['staging/checkout_v2'].rules = backend.rows['staging/checkout_v2'].rules.slice(0, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const conflict = await screen.findByRole('alertdialog', { name: 'Someone changed this flag while you were editing' })
    expect(within(conflict).getByText(/The rules in staging were changed\./)).toBeDefined()
    expect(ruleSaves()).toHaveLength(0)

    fireEvent.click(within(conflict).getByRole('button', { name: 'Save mine anyway' }))

    await waitFor(() => expect(ruleSaves()).toHaveLength(1))
    const sent = (ruleSaves()[0].body as { rules: { attribute: string; values: unknown[] }[] }).rules
    expect(sent.map((rule) => [rule.attribute, rule.values])).toEqual([
      ['country', ['IN']],
      ['appVersion', ['2.4.0']],
      ['plan', ['beta']],
    ])
  })
})

describe('user overrides', () => {
  it('adds, flips and removes overrides at once, with Undo for a removal', async () => {
    renderAt(flagPath('staging'))
    const input = await screen.findByLabelText('User ID')

    fireEvent.change(input, { target: { value: 'jane@acme.dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('jane@acme.dev')).toBeDefined()
    expect(document.activeElement).toBe(input)
    await waitFor(() => expect(posts('/overrides')[0]?.body).toEqual({ externalUserId: 'jane@acme.dev', enabled: true }))

    // Adding an id that is already there flips it, and says so.
    fireEvent.change(input, { target: { value: 'u-9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('u-9 was denied, now allowed.'))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove override for jane@acme.dev' }))
    await waitFor(() =>
      expect(backend.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/overrides/jane%40acme.dev'))).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('jane@acme.dev')).toBeNull())

    const [message, options] = vi.mocked(toast).mock.calls.at(-1)!
    expect(message).toBe("Removed jane@acme.dev's override")
    ;(options as unknown as { action: { onClick: () => void } }).action.onClick()
    await waitFor(() => expect(posts('/overrides').at(-1)?.body).toEqual({ externalUserId: 'jane@acme.dev', enabled: true }))
    expect(await screen.findByText('jane@acme.dev')).toBeDefined()
  })

  it('changes an override from its menu', async () => {
    renderAt(flagPath('staging'))

    await openMenu('More actions for u-1')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change to deny' }))

    await waitFor(() => expect(posts('/overrides')[0]?.body).toEqual({ externalUserId: 'u-1', enabled: false }))
    expect(await screen.findByText('On for 2 allowed users, and for 25% of users who match both rules. 2 users never get it.')).toBeDefined()
  })

  it('asks before removing an override in a protected environment', async () => {
    backend.rows['production/checkout_v2'] = row('production', true, 100, { overrides: [{ externalUserId: 'u-5', enabled: false }] })
    renderAt(flagPath('production'))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove override for u-5' }))
    const dialog = await screen.findByRole('alertdialog', { name: "Remove u-5's override in production?" })
    expect(backend.calls.some((call) => call.method === 'DELETE')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove override' }))

    await waitFor(() => expect(backend.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/overrides/u-5'))).toBe(true))
  })

  it('shows a viewer the rules and overrides without a way to change them', async () => {
    backend.role = 'VIEWER'
    renderAt(flagPath('staging'))

    expect(await screen.findByText('country is one of IN, US')).toBeDefined()
    expect(screen.getByText('Paused · not sent to SDKs')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull()
    expect(await screen.findByText('u-9')).toBeDefined()
    expect(screen.queryByLabelText('User ID')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove override for u-9' })).toBeNull()
  })
})
