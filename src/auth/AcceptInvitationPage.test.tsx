// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { routes } from '@/app/routes'

const GLOBEX = '461168601842738777'
const ACCEPT_PAGE = '/invitations/accept?token=tok-1'

// An in-memory stand-in for the invitee's endpoints, following InvitationServiceImpl: the lookup reports
// the stored status only, and accepting decides from whether the invited address has an account.
const server = vi.hoisted(() => {
  const state = {
    invitation: { token: 'tok-1', email: 'jo@acme.dev', role: 'ADMIN', status: 'PENDING', expired: false },
    accounts: [] as string[],
    signedInAs: 'jo@acme.dev',
    tenants: [] as unknown[],
    calls: [] as { method: string; path: string; body?: unknown; headers: Headers }[],
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
      state.calls.push({ method, path, body, headers: request.headers })

      if (path === '/api/v1/tenants') {
        return reply({ tenants: state.tenants })
      }
      if (path === '/api/v1/auth/me') {
        return reply({ userId: '1', email: state.signedInAs, firstName: 'Jo', lastName: null, status: 'ACTIVE', tenantId: null, roles: [] })
      }
      const match = path.match(/^\/api\/v1\/invitations\/([^/]+)(?:\/(accept|decline))?$/)
      if (!match) {
        return reply(undefined, 404)
      }
      const [, token, action] = match
      const invitation = state.invitation
      if (token !== invitation.token) {
        return failure(401, 'Invalid invitation token')
      }
      if (!action) {
        return reply({ message: `Invitation status: ${invitation.status}`, status: invitation.status, authResponse: null })
      }
      if (invitation.status !== 'PENDING') {
        return failure(409, 'This invitation has already been processed')
      }
      if (action === 'decline') {
        invitation.status = 'DECLINED'
        return reply(undefined, 204)
      }
      if (invitation.expired) {
        return failure(401, 'Invitation token has expired')
      }
      if (state.accounts.includes(invitation.email)) {
        if (!request.headers.get('Authorization')) {
          return failure(401, 'Sign in as the invited user to accept this invitation')
        }
        if (state.signedInAs !== invitation.email) {
          return failure(403, 'This invitation was not addressed to the signed-in user')
        }
      } else {
        if (!body) {
          return reply({ message: 'Please register to complete your invitation', status: 'PENDING_UNREGISTERED', authResponse: null })
        }
        if ((body as { email: string }).email !== invitation.email) {
          return failure(403, 'Registration details must use the invited email address')
        }
        state.accounts.push(invitation.email)
      }
      invitation.status = 'ACCEPTED'
      state.tenants = [{ id: '461168601842738777', name: 'Globex', plan: 'PRO', roles: [{ id: '2', name: invitation.role }] }]
      return reply({
        message: 'Invitation accepted successfully',
        status: 'ACCEPTED',
        authResponse: {
          accessToken: 'access-2',
          refreshToken: null,
          userId: '1',
          email: invitation.email,
          tenantId: '461168601842738777',
          roles: [invitation.role],
          accessTokenExpiresIn: 900_000,
        },
      })
    }),
  )
  return state
})

const session = vi.hoisted(() => {
  type Status = 'restoring' | 'signedIn' | 'signedOut'
  let status: Status = 'signedOut'
  const listeners = new Set<() => void>()
  const setStatus = (next: Status) => {
    status = next
    listeners.forEach((listener) => listener())
  }
  return {
    setStatus,
    adoptSession: vi.fn(),
    login: vi.fn(),
    getSessionStatus: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getAccessToken: () => (status === 'signedIn' ? 'access-1' : null),
  }
})
vi.mock('@/auth/session', () => ({
  getSessionStatus: session.getSessionStatus,
  subscribe: session.subscribe,
  adoptSession: session.adoptSession,
  login: session.login,
  logout: async () => session.setStatus('signedOut'),
  getAccessToken: session.getAccessToken,
  refresh: async () => null,
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

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

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const acceptCalls = () => server.calls.filter((call) => call.path === '/api/v1/invitations/tok-1/accept')

beforeEach(() => {
  session.setStatus('signedOut')
  session.adoptSession.mockReset().mockImplementation(() => session.setStatus('signedIn'))
  session.login.mockReset().mockImplementation(async () => session.setStatus('signedIn'))
  server.invitation = { token: 'tok-1', email: 'jo@acme.dev', role: 'ADMIN', status: 'PENDING', expired: false }
  server.accounts = ['jo@acme.dev', 'sam@acme.dev']
  server.signedInAs = 'jo@acme.dev'
  server.tenants = []
  server.calls = []
  vi.mocked(toast.success).mockClear()
})

afterEach(() => {
  cleanup()
})

describe('accept invitation', () => {
  it('explains a link that has no token', async () => {
    renderAt('/invitations/accept')

    expect(await screen.findByRole('heading', { name: 'This invitation link is incomplete' })).toBeDefined()
    expect(server.calls).toEqual([])
  })

  it('waits while the session is restoring', async () => {
    session.setStatus('restoring')
    renderAt(ACCEPT_PAGE)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeDefined()
    expect(server.calls).toEqual([])

    act(() => session.setStatus('signedOut'))

    expect(await screen.findByRole('heading', { name: 'Sign in to accept' })).toBeDefined()
  })

  it('explains a token that matches no invitation, with no form', async () => {
    renderAt('/invitations/accept?token=nope')

    expect(await screen.findByRole('heading', { name: "This invitation link doesn't work" })).toBeDefined()
    expect(screen.getByText(/Ask whoever invited you/)).toBeDefined()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join organization' })).toBeNull()
  })

  it.each([
    ['EXPIRED', 'This invitation has expired'],
    ['ACCEPTED', 'This invitation has already been accepted'],
    ['DECLINED', 'This invitation was declined'],
    ['CANCELLED', 'This invitation was cancelled'],
  ])('says a %s invitation is over, and who to ask, with no form', async (status, title) => {
    server.invitation.status = status
    session.setStatus('signedIn')
    renderAt(ACCEPT_PAGE)

    expect(await screen.findByRole('heading', { name: title })).toBeDefined()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join organization' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Go to your organizations' })).toBeDefined()
    expect(acceptCalls()).toEqual([])
  })

  it("joins as the signed-in invitee, adopts the new session and opens the organization's flags", async () => {
    session.setStatus('signedIn')
    const router = renderAt(ACCEPT_PAGE)

    fireEvent.click(await screen.findByRole('button', { name: 'Join organization' }))

    await screen.findByRole('heading', { name: 'Flags' })
    expect(router.state.location.pathname).toBe(`/t/${GLOBEX}/flags`)
    expect(session.adoptSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access-2', tenantId: GLOBEX }))
    expect(toast.success).toHaveBeenCalledWith("You've joined Globex as Admin.")
    const [accept] = acceptCalls()
    expect(accept.body).toBeUndefined()
    expect(accept.headers.get('X-Refresh-Transport')).toBe('cookie')
    expect(accept.headers.get('Authorization')).toBe('Bearer access-1')
  })

  it('sends a signed-out invitee who has an account to sign in, then back here to join', async () => {
    renderAt(ACCEPT_PAGE)

    const signIn = await screen.findByRole('link', { name: 'Sign in' })
    expect(screen.getByRole('heading', { name: 'Sign in to accept' })).toBeDefined()
    expect(signIn.getAttribute('href')).toBe(`/login?next=${encodeURIComponent(ACCEPT_PAGE)}`)
    // Asked anonymously and without a body, so nothing was accepted.
    expect(acceptCalls().map((call) => [call.headers.get('Authorization'), call.body])).toEqual([[null, undefined]])

    fireEvent.click(signIn)
    fill('Email', 'jo@acme.dev')
    fill('Password', 'correct horse')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('button', { name: 'Join organization' })).toBeDefined()
    expect(server.invitation.status).toBe('PENDING')
  })

  it('tells someone signed in as another address to sign out, and then asks the invitee to sign in', async () => {
    session.setStatus('signedIn')
    server.signedInAs = 'sam@acme.dev'
    renderAt(ACCEPT_PAGE)

    fireEvent.click(await screen.findByRole('button', { name: 'Join organization' }))

    expect(await screen.findByRole('heading', { name: 'This invitation is for another address' })).toBeDefined()
    expect(await screen.findByText("You're signed in as sam@acme.dev. Sign out to accept it.")).toBeDefined()
    expect(session.adoptSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in to accept' })).toBeDefined()
  })

  it('treats an invitation to an address with no account as another address when signed in', async () => {
    session.setStatus('signedIn')
    server.signedInAs = 'sam@acme.dev'
    server.accounts = ['sam@acme.dev']
    renderAt(ACCEPT_PAGE)

    fireEvent.click(await screen.findByRole('button', { name: 'Join organization' }))

    expect(await screen.findByRole('heading', { name: 'This invitation is for another address' })).toBeDefined()
    expect(server.invitation.status).toBe('PENDING')
  })

  it('tells a signed-out invitee their invitation has expired, rather than asking them to sign in', async () => {
    server.invitation.expired = true
    renderAt(ACCEPT_PAGE)

    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Sign in to accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline invitation' })).toBeNull()
  })

  it('says the invitation has expired when joining finds it so', async () => {
    session.setStatus('signedIn')
    server.invitation.expired = true
    renderAt(ACCEPT_PAGE)

    fireEvent.click(await screen.findByRole('button', { name: 'Join organization' }))

    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeDefined()
    expect(session.adoptSession).not.toHaveBeenCalled()
  })

  it('registers a new invitee with the invited address and joins', async () => {
    server.accounts = []
    const router = renderAt(ACCEPT_PAGE)

    await screen.findByRole('heading', { name: 'Create your account to join' })
    expect(screen.getByText('8 to 128 characters.')).toBeDefined()
    expect(screen.getByLabelText(/Last name/)).toBeDefined()

    fill('First name', 'Jo')
    fill('Email', 'jo@other.dev')
    fill('Password', 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Create account and join' }))
    expect(await screen.findByText('Use at least 8 characters')).toBeDefined()

    fill('Password', 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account and join' }))
    expect(await screen.findByText('Use the address this invitation was sent to.')).toBeDefined()
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true')

    fill('Email', 'jo@acme.dev')
    fireEvent.click(screen.getByRole('button', { name: 'Create account and join' }))

    await screen.findByRole('heading', { name: 'Flags' })
    expect(router.state.location.pathname).toBe(`/t/${GLOBEX}/flags`)
    expect(acceptCalls().map((call) => call.body)).toEqual([
      undefined,
      { firstName: 'Jo', email: 'jo@other.dev', password: 'correct horse' },
      { firstName: 'Jo', email: 'jo@acme.dev', password: 'correct horse' },
    ])
    expect(acceptCalls().at(-1)?.headers.get('X-Refresh-Transport')).toBe('cookie')
    expect(session.adoptSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access-2' }))
    expect(toast.success).toHaveBeenCalledWith("You've joined Globex as Admin.")
  })

  it('declines after saying what that means', async () => {
    renderAt(ACCEPT_PAGE)

    fireEvent.click(await screen.findByRole('button', { name: 'Decline invitation' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Decline this invitation?' })
    expect(within(dialog).getByText("The link stops working. To join later, you'll need a new invitation.")).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline invitation' }))

    expect(await screen.findByRole('heading', { name: 'This invitation was declined' })).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(server.calls.filter((call) => call.path === '/api/v1/invitations/tok-1/decline')).toHaveLength(1)
  })
})
