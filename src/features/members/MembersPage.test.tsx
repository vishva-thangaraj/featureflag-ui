// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'
import { TooltipProvider } from '@/components/ui/tooltip'

const TENANT = '461168601842738689'
const DAY = 24 * 3600 * 1000

// An in-memory stand-in for the members and invitations endpoints, following the server's rules: the
// owner can't be changed or removed, and a second live invitation for an address is a 409.
const backend = vi.hoisted(() => {
  // Radix Select, Tooltip and Sheet measure and scroll; jsdom does neither.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}

  type Member = {
    membershipId: string
    userID: string
    email: string
    firstName: string
    lastName: string | null
    roles: { id: string; name: string }[]
    status: 'ACTIVE'
  }
  type Invitation = {
    id: string
    email: string
    role: string
    status: 'PENDING' | 'EXPIRED'
    invitedByEmail: string | null
    createdAt: string
    expiresAt: string
  }
  const state = {
    role: 'ADMIN',
    meId: '900',
    meFails: false,
    member: true,
    members: [] as Member[],
    invitations: [] as Invitation[],
    /** When set, member writes answer 403, and the caller's role becomes `roleOnRefusal` if given. */
    refuse: null as null | { message: string; roleOnRefusal?: string },
    calls: [] as { method: string; path: string; body?: unknown }[],
    nextId: 800,
  }
  const reply = (body?: unknown, status = 200) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const failure = (status: number, message: string) =>
    reply({ status, error: 'Error', message, timestamp: '2026-11-01T00:00:00Z' }, status)

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname
      const method = request.method
      const text = method === 'GET' ? '' : await request.text()
      const body = text ? JSON.parse(text) : undefined
      state.calls.push({ method, path, body })

      if (path === '/api/v1/tenants') {
        const tenants = state.member ? [{ id: '461168601842738689', name: 'Acme', plan: 'FREE', roles: [{ id: '1', name: state.role }] }] : []
        return reply({ tenants })
      }
      if (path === '/api/v1/auth/me') {
        if (state.meFails) {
          return failure(500, 'Unexpected error')
        }
        return reply({ userId: state.meId, email: 'sam@acme.dev', firstName: 'Sam', lastName: null, status: 'ACTIVE', tenantId: null, roles: [] })
      }
      if (path === '/api/v1/members') {
        return state.member ? reply({ members: state.members }) : failure(403, 'Forbidden')
      }
      const memberMatch = path.match(/^\/api\/v1\/members\/(\d+)(\/role)?$/)
      if (memberMatch) {
        const member = state.members.find((candidate) => candidate.membershipId === memberMatch[1])
        if (!member) {
          return failure(404, 'Membership not found')
        }
        if (state.refuse) {
          if (state.refuse.roleOnRefusal) {
            state.role = state.refuse.roleOnRefusal
          }
          return failure(403, state.refuse.message)
        }
        if (member.roles.some((role) => role.name === 'OWNER')) {
          return failure(403, "Cannot change the owner's role")
        }
        if (method === 'PUT') {
          member.roles = [{ id: '7', name: (body as { roleName: string }).roleName }]
          if (member.userID === state.meId) {
            state.role = member.roles[0].name
          }
          return reply(member)
        }
        state.members = state.members.filter((candidate) => candidate !== member)
        if (member.userID === state.meId) {
          state.member = false
        }
        return reply(undefined, 204)
      }
      if (path === '/api/v1/invitations' && method === 'GET') {
        return state.role === 'OWNER' || state.role === 'ADMIN' ? reply({ invitations: state.invitations }) : failure(403, 'Forbidden')
      }
      if (path === '/api/v1/invitations' && method === 'POST') {
        const { email, role } = body as { email: string; role: string }
        if (state.invitations.some((invitation) => invitation.email === email && invitation.status === 'PENDING')) {
          return failure(409, `An invitation already exists for this email: ${email}`)
        }
        state.invitations.unshift({
          id: String(state.nextId++),
          email,
          role,
          status: 'PENDING',
          invitedByEmail: 'sam@acme.dev',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        })
        return reply(undefined, 200)
      }
      const invitationMatch = path.match(/^\/api\/v1\/invitations\/(\d+)\/(resend|cancel)$/)
      if (invitationMatch) {
        const invitation = state.invitations.find((candidate) => candidate.id === invitationMatch[1])
        if (!invitation) {
          return failure(404, 'Invitation not found')
        }
        if (invitationMatch[2] === 'cancel') {
          state.invitations = state.invitations.filter((candidate) => candidate !== invitation)
        } else {
          invitation.status = 'PENDING'
          invitation.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
        }
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

function member(membershipId: string, userID: string, firstName: string, lastName: string | null, email: string, role: string) {
  return { membershipId, userID, email, firstName, lastName, roles: [{ id: '1', name: role }], status: 'ACTIVE' as const }
}

const ANN = () => member('501', '100', 'Ann', 'Lee', 'ann@acme.dev', 'OWNER')
const SAM = () => member('502', '900', 'Sam', null, 'sam@acme.dev', 'ADMIN')
const JO = () => member('503', '300', 'Jo', 'Park', 'jo@acme.dev', 'VIEWER')

function invitation(id: string, email: string, role: string, expiresInDays: number) {
  return {
    id,
    email,
    role,
    status: expiresInDays < 0 ? ('EXPIRED' as const) : ('PENDING' as const),
    invitedByEmail: 'ann@acme.dev',
    createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * DAY + 3600_000).toISOString(),
  }
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

const bodyRows = () => screen.getAllByRole('row').slice(1)
const rowFor = (text: string) => bodyRows().find((row) => within(row).queryByText(text))!
const firstCells = () => bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent)

const callsTo = (method: string, pathPattern: RegExp) =>
  backend.calls.filter((call) => call.method === method && pathPattern.test(call.path))

async function openRoleMenu(name: string) {
  fireEvent.keyDown(await screen.findByRole('combobox', { name: `Role for ${name}` }), { key: 'Enter' })
  return screen.findAllByRole('option')
}

beforeEach(() => {
  backend.role = 'ADMIN'
  backend.meId = '900'
  backend.meFails = false
  backend.member = true
  backend.members = [JO(), ANN(), SAM()]
  backend.invitations = []
  backend.refuse = null
  backend.calls = []
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  cleanup()
})

describe('members', () => {
  it('lists members highest role first, marks the caller, and counts both tabs', async () => {
    backend.invitations = [invitation('61', 'new@acme.dev', 'MEMBER', 5), invitation('62', 'old@acme.dev', 'VIEWER', -2)]

    renderAt(`/t/${TENANT}/members`)

    await screen.findByText('jo@acme.dev')
    expect(firstCells()).toEqual(['Ann Leeann@acme.dev', 'SamYousam@acme.dev', 'Jo Parkjo@acme.dev'])
    expect(within(rowFor('Sam')).getByText('You')).toBeDefined()
    expect(within(rowFor('Jo Park')).queryByText('You')).toBeNull()
    expect(within(rowFor('Jo Park')).getByText('Active')).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Members (3)' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('tab', { name: 'Invitations (1 pending)' })).toBeDefined()
  })

  it('keeps the selected tab in the URL', async () => {
    backend.invitations = [invitation('61', 'new@acme.dev', 'MEMBER', 5)]
    const router = renderAt(`/t/${TENANT}/members`)

    fireEvent.mouseDown(await screen.findByRole('tab', { name: /^Invitations/ }))

    expect(await screen.findByText('new@acme.dev')).toBeDefined()
    expect(router.state.location.search).toBe('?tab=invitations')

    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Members/ }))

    expect(await screen.findByText('jo@acme.dev')).toBeDefined()
    expect(router.state.location.search).toBe('')
  })

  it('opens on the invitations tab when the URL says so', async () => {
    backend.invitations = [invitation('61', 'new@acme.dev', 'MEMBER', 5)]

    renderAt(`/t/${TENANT}/members?tab=invitations`)

    expect(await screen.findByText('new@acme.dev')).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Invitations (1 pending)' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows a viewer the members without controls, and no invitations', async () => {
    backend.role = 'VIEWER'
    backend.meId = '300'

    renderAt(`/t/${TENANT}/members?tab=invitations`)

    await screen.findByText('jo@acme.dev')
    expect(screen.getByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(within(rowFor('Jo Park')).getByText('You')).toBeDefined()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Members (3)'])
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Remove|Leave)/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull()
    expect(within(rowFor('Ann Lee')).getByText('Owner')).toBeDefined()
    expect(callsTo('GET', /^\/api\/v1\/invitations$/)).toHaveLength(0)
  })

  it("waits for the caller's identity before offering controls, and says so if it can't be read", async () => {
    backend.meFails = true

    renderAt(`/t/${TENANT}/members`)

    expect(await screen.findByText("Couldn't load members.")).toBeDefined()
    expect(screen.queryByRole('button', { name: /^(Remove|Leave)/ })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('turns read-only when the invitations list is refused because the caller was demoted', async () => {
    backend.invitations = [invitation('61', 'new@acme.dev', 'MEMBER', 5)]
    renderAt(`/t/${TENANT}/members`)
    await screen.findByRole('tab', { name: 'Invitations (1 pending)' })
    const tenantReads = callsTo('GET', /^\/api\/v1\/tenants$/).length

    backend.role = 'VIEWER'
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Invitations/ }))

    expect(await screen.findByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(callsTo('GET', /^\/api\/v1\/tenants$/).length).toBeGreaterThan(tenantReads)
    expect(screen.queryByRole('tab', { name: /^Invitations/ })).toBeNull()
    expect(await screen.findByText('jo@acme.dev')).toBeDefined()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it("locks the owner's row and says why on focus", async () => {
    renderAt(`/t/${TENANT}/members`)

    await screen.findByText('ann@acme.dev')
    const owner = rowFor('Ann Lee')
    expect(within(owner).queryByRole('combobox')).toBeNull()
    expect(within(owner).queryByRole('button')).toBeNull()

    fireEvent.focus(within(owner).getByText('Owner'))

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      "The owner's role can't be changed, and the owner can't be removed.",
    )
  })

  it('offers an admin only the roles up to their own', async () => {
    renderAt(`/t/${TENANT}/members`)

    const options = await openRoleMenu('Jo Park')

    expect(options.map((option) => option.textContent)).toEqual(['Admin', 'Member', 'Viewer'])
  })

  it('changes a role', async () => {
    renderAt(`/t/${TENANT}/members`)

    await openRoleMenu('Jo Park')
    fireEvent.click(screen.getByRole('option', { name: 'Member' }))

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Role for Jo Park' }).textContent).toBe('Member'),
    )
    expect(callsTo('PUT', /^\/api\/v1\/members\/503\/role$/).map((call) => call.body)).toEqual([{ roleName: 'MEMBER' }])
    expect(toast.success).toHaveBeenCalledWith("Jo Park's role is now Member")
  })

  it('offers an owner every role, and asks before making another owner', async () => {
    backend.role = 'OWNER'
    backend.meId = '100'
    renderAt(`/t/${TENANT}/members`)

    const options = await openRoleMenu('Jo Park')
    expect(options.map((option) => option.textContent)).toEqual(['Owner', 'Admin', 'Member', 'Viewer'])
    fireEvent.click(screen.getByRole('option', { name: 'Owner' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Make Jo Park an owner?' })
    expect(callsTo('PUT', /role$/)).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make owner' }))

    await waitFor(() => expect(callsTo('PUT', /^\/api\/v1\/members\/503\/role$/).map((call) => call.body)).toEqual([{ roleName: 'OWNER' }]))
  })

  it('asks before an admin demotes themselves, then shows the page read-only', async () => {
    renderAt(`/t/${TENANT}/members`)

    await openRoleMenu('Sam')
    fireEvent.click(screen.getByRole('option', { name: 'Viewer' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Make yourself a Viewer?' })
    expect(callsTo('PUT', /role$/)).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change my role' }))

    expect(await screen.findByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(callsTo('PUT', /^\/api\/v1\/members\/502\/role$/).map((call) => call.body)).toEqual([{ roleName: 'VIEWER' }])
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Your role is now Viewer')
  })

  it('names the person and the consequence before removing them', async () => {
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Jo Park' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Jo Park?' })
    expect(within(dialog).getByText('jo@acme.dev loses access to Acme straight away. You can invite them again later.')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove member' }))

    await waitFor(() => expect(screen.queryByText('jo@acme.dev')).toBeNull())
    expect(callsTo('DELETE', /^\/api\/v1\/members\/503$/)).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('Jo Park removed')
  })

  it('lets an admin leave, and takes them out of the organization', async () => {
    const router = renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Leave Acme' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Acme?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave organization' }))

    await screen.findByRole('heading', { name: 'Create an organization' })
    expect(router.state.location.pathname).toBe('/orgs/new')
    expect(callsTo('DELETE', /^\/api\/v1\/members\/502$/)).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('You left Acme')
  })

  it("corrects itself when a role change is refused because the caller's own role changed", async () => {
    backend.refuse = { message: 'Access denied', roleOnRefusal: 'VIEWER' }
    renderAt(`/t/${TENANT}/members`)

    await openRoleMenu('Jo Park')
    const tenantReads = callsTo('GET', /^\/api\/v1\/tenants$/).length
    const memberReads = callsTo('GET', /^\/api\/v1\/members$/).length
    fireEvent.click(screen.getByRole('option', { name: 'Admin' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Your role in Acme is now Viewer.'))
    expect(callsTo('GET', /^\/api\/v1\/tenants$/).length).toBeGreaterThan(tenantReads)
    expect(callsTo('GET', /^\/api\/v1\/members$/).length).toBeGreaterThan(memberReads)
    expect(screen.getByText('View only. Ask an admin to make changes.')).toBeDefined()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('tab', { name: /^Invitations/ })).toBeNull()
  })

  it("says why a removal was refused when the caller's role didn't change", async () => {
    backend.refuse = { message: 'Not allowed here' }
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Jo Park' }))
    const tenantReads = callsTo('GET', /^\/api\/v1\/tenants$/).length
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove member' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't remove Jo Park. Not allowed here"))
    expect(callsTo('GET', /^\/api\/v1\/tenants$/).length).toBeGreaterThan(tenantReads)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('jo@acme.dev')).toBeDefined()
  })
})

describe('invite', () => {
  it('invites with a role chosen from cards limited to the caller’s rank', async () => {
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    const drawer = await screen.findByRole('dialog', { name: 'Invite a member' })
    expect(within(drawer).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['ADMIN', 'MEMBER', 'VIEWER'])
    expect(within(drawer).getByRole('radio', { name: 'Admin', description: 'Change flags, environments, API keys and members' })).toBeDefined()
    expect(within(drawer).getByRole('radio', { name: 'Member', description: 'View everything, change nothing' })).toBeDefined()
    expect(within(drawer).getByRole('radio', { name: 'Viewer', description: 'Same as Member today: view everything, change nothing' })).toBeDefined()

    fireEvent.change(within(drawer).getByLabelText('Email'), { target: { value: 'new@acme.dev' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Admin' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsTo('POST', /^\/api\/v1\/invitations$/).map((call) => call.body)).toEqual([{ email: 'new@acme.dev', role: 'ADMIN' }])
    expect(toast.success).toHaveBeenCalledWith('Invitation sent to new@acme.dev')
    expect(await screen.findByRole('tab', { name: 'Invitations (1 pending)' })).toBeDefined()
  })

  it('offers an owner no Owner card: making an owner takes the confirm on the members table', async () => {
    backend.role = 'OWNER'
    backend.meId = '100'
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    const drawer = await screen.findByRole('dialog', { name: 'Invite a member' })

    expect(within(drawer).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['ADMIN', 'MEMBER', 'VIEWER'])
  })

  it('checks the address before sending', async () => {
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    const drawer = await screen.findByRole('dialog', { name: 'Invite a member' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invitation' }))

    expect(await within(drawer).findByText('Enter an email address')).toBeDefined()
    expect(callsTo('POST', /^\/api\/v1\/invitations$/)).toHaveLength(0)
  })

  it('offers to resend an invitation that is already pending', async () => {
    backend.invitations = [invitation('61', 'jo2@acme.dev', 'VIEWER', 5)]
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    const drawer = await screen.findByRole('dialog', { name: 'Invite a member' })
    fireEvent.change(within(drawer).getByLabelText('Email'), { target: { value: 'jo2@acme.dev' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invitation' }))

    const notice = await within(drawer).findByRole('alert')
    expect(notice.textContent).toContain('jo2@acme.dev already has a pending invitation as Viewer.')
    fireEvent.click(within(notice).getByRole('button', { name: 'Resend it' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsTo('POST', /^\/api\/v1\/invitations\/61\/resend$/)).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('New invitation sent to jo2@acme.dev')
  })

  it('cancels a pending invitation and invites again with the new role', async () => {
    backend.invitations = [invitation('61', 'jo2@acme.dev', 'VIEWER', 5)]
    renderAt(`/t/${TENANT}/members`)

    fireEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
    const drawer = await screen.findByRole('dialog', { name: 'Invite a member' })
    fireEvent.change(within(drawer).getByLabelText('Email'), { target: { value: 'jo2@acme.dev' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Admin' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send invitation' }))
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Cancel it and invite again' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsTo('POST', /^\/api\/v1\/invitations(\/61\/cancel)?$/).map((call) => [call.path, call.body])).toEqual([
      ['/api/v1/invitations', { email: 'jo2@acme.dev', role: 'ADMIN' }],
      ['/api/v1/invitations/61/cancel', undefined],
      ['/api/v1/invitations', { email: 'jo2@acme.dev', role: 'ADMIN' }],
    ])
    expect(backend.invitations.map((pending) => [pending.email, pending.role])).toEqual([['jo2@acme.dev', 'ADMIN']])
  })
})

describe('invitations', () => {
  it('lists who was invited, by whom and when, and leads with Resend on expired ones', async () => {
    backend.invitations = [invitation('61', 'new@acme.dev', 'MEMBER', 5), invitation('62', 'old@acme.dev', 'ADMIN', -3)]

    renderAt(`/t/${TENANT}/members?tab=invitations`)

    await screen.findByText('new@acme.dev')
    const cells = (email: string) => within(rowFor(email)).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells('new@acme.dev').slice(0, 4)).toEqual(['new@acme.devInvited by ann@acme.dev', 'Member', '2 days ago', 'in 5 days'])
    expect(cells('old@acme.dev').slice(0, 4)).toEqual(['old@acme.devInvited by ann@acme.dev', 'Admin', '2 days ago', 'Expired 3 days ago'])
    const [resend, cancel] = within(rowFor('old@acme.dev')).getAllByRole('button')
    expect(resend.getAttribute('aria-label')).toBe('Resend invitation to old@acme.dev')
    expect(resend.getAttribute('data-variant')).toBe('outline')
    expect(cancel.getAttribute('aria-label')).toBe('Cancel invitation to old@acme.dev')
    expect(within(rowFor('new@acme.dev')).getAllByRole('button')[0].getAttribute('data-variant')).toBe('ghost')
  })

  it('says the old link stops working before resending', async () => {
    backend.invitations = [invitation('62', 'old@acme.dev', 'ADMIN', -3)]
    renderAt(`/t/${TENANT}/members?tab=invitations`)

    fireEvent.click(await screen.findByRole('button', { name: 'Resend invitation to old@acme.dev' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend the invitation to old@acme.dev?' })
    expect(within(dialog).getByText('A new link will be sent. The previous one stops working.')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resend invitation' }))

    await waitFor(() => expect(within(rowFor('old@acme.dev')).getAllByRole('cell')[3].textContent).toBe('in 7 days'))
    expect(callsTo('POST', /^\/api\/v1\/invitations\/62\/resend$/)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Invitations (1 pending)' })).toBeDefined()
  })

  it('cancels an invitation', async () => {
    backend.invitations = [invitation('61', 'new@acme.dev', 'MEMBER', 5)]
    renderAt(`/t/${TENANT}/members?tab=invitations`)

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel invitation to new@acme.dev' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel the invitation to new@acme.dev?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }))

    expect(await screen.findByText('No invitations are waiting to be accepted.')).toBeDefined()
    expect(callsTo('POST', /^\/api\/v1\/invitations\/61\/cancel$/)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Invitations (0 pending)' })).toBeDefined()
  })

  it('offers an invitation when none are waiting', async () => {
    renderAt(`/t/${TENANT}/members?tab=invitations`)

    fireEvent.click(await screen.findByRole('button', { name: 'Invite someone' }))

    expect(await screen.findByRole('dialog', { name: 'Invite a member' })).toBeDefined()
  })
})
