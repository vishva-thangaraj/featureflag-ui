// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { ApiError } from '@/api/errors'
import { routes } from '@/app/routes'
import { errorBody } from '@/test/fakes'

const NEW_ORG_ID = '461168601842738999'

// A tiny stand-in for the tenants endpoints, installed before the API client captures fetch.
const server = vi.hoisted(() => {
  const state = { tenants: [] as unknown[], created: [] as unknown[] }
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname !== '/api/v1/tenants') {
        return new Response(null, { status: 404 })
      }
      if (request.method === 'GET') {
        return reply({ tenants: state.tenants })
      }
      const { name } = (await request.json()) as { name: string }
      const tenant = { id: '461168601842738999', name, plan: 'FREE', roles: [{ id: '1', name: 'OWNER' }] }
      state.created.push({ name })
      state.tenants = [...state.tenants, tenant]
      return reply(tenant, 201)
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
    login: vi.fn(),
    register: vi.fn(),
    getSessionStatus: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})
vi.mock('@/auth/session', () => ({
  getSessionStatus: session.getSessionStatus,
  subscribe: session.subscribe,
  login: session.login,
  register: session.register,
  logout: async () => session.setStatus('signedOut'),
  getAccessToken: () => 'access-1',
  refresh: async () => null,
}))

const ACME = { id: '461168601842738689', name: 'Acme', plan: 'FREE', roles: [{ id: '1', name: 'OWNER' }] }

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  // The app's own freshness window: with it, a cached list is reused instead of refetched.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
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

function rejection(status: number, body: unknown, headers?: HeadersInit) {
  return new ApiError(new Response(null, { status, headers }), body)
}

beforeEach(() => {
  session.setStatus('signedOut')
  session.login.mockReset().mockImplementation(async () => session.setStatus('signedIn'))
  session.register.mockReset().mockImplementation(async () => session.setStatus('signedIn'))
  server.tenants = [ACME]
  server.created.length = 0
})

afterEach(() => {
  cleanup()
})

describe('sign in', () => {
  it('signs in and carries on to where the visitor was headed', async () => {
    const router = renderAt(`/login?next=${encodeURIComponent(`/t/${ACME.id}/members`)}`)

    fill('Email', 'user@example.com')
    fill('Password', 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await screen.findByRole('heading', { name: 'Members' })
    expect(session.login).toHaveBeenCalledWith('user@example.com', 'correct horse')
    expect(router.state.location.pathname).toBe(`/t/${ACME.id}/members`)
  })

  it('checks the form before asking the server', async () => {
    renderAt('/login')

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter an email address')).toBeDefined()
    expect(screen.getByText('Enter your password')).toBeDefined()
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true')
    expect(session.login).not.toHaveBeenCalled()
  })

  it('says the email or password is wrong without saying which', async () => {
    session.login.mockRejectedValue(rejection(401, errorBody(401, 'Invalid email or password')))
    renderAt('/login')

    fill('Email', 'user@example.com')
    fill('Password', 'wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Email or password is incorrect.')
  })

  it('turns the button into a countdown after too many attempts', async () => {
    session.login.mockRejectedValue(rejection(429, errorBody(429, 'Too many requests'), { 'Retry-After': '6' }))
    renderAt('/login')

    fill('Email', 'user@example.com')
    fill('Password', 'wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const button = await screen.findByRole('button', { name: 'Try again in 6 s' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('Too many attempts.')
  })

  it('shows and hides the password', () => {
    renderAt('/login')
    const reveal = screen.getByRole('button', { name: 'Show password' })

    fireEvent.click(reveal)

    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text')
    expect(reveal.getAttribute('aria-pressed')).toBe('true')
  })

  it('sends a signed-in visitor on, ignoring a next that points off the site', async () => {
    session.setStatus('signedIn')

    const router = renderAt('/login?next=%2F%2Fevil.example%2F')

    await screen.findByRole('heading', { name: 'Flags' })
    expect(router.state.location.pathname).toBe(`/t/${ACME.id}/flags`)
  })
})

describe('register', () => {
  it('creates the account, then asks for an organization', async () => {
    server.tenants = []
    const router = renderAt('/register')

    fill('First name', 'Jane')
    fill('Email', 'jane@example.com')
    fill('Password', 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await screen.findByRole('heading', { name: 'Create an organization' })
    expect(session.register).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: undefined,
      email: 'jane@example.com',
      password: 'correct horse',
    })
    expect(router.state.location.pathname).toBe('/orgs/new')
  })

  it('puts a taken email on the email field', async () => {
    session.register.mockRejectedValue(rejection(409, errorBody(409, 'Email already in use')))
    renderAt('/register')

    fill('First name', 'Jane')
    fill('Email', 'jane@example.com')
    fill('Password', 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('An account with this email already exists.')).toBeDefined()
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true')
  })

  it("puts the server's field errors on their fields, and the rest above the form", async () => {
    session.register.mockRejectedValue(
      rejection(400, {
        ...errorBody(400, 'Validation failed'),
        fieldErrors: [
          { field: 'password', message: 'size must be between 8 and 128' },
          { field: null, message: 'Registration is closed' },
        ],
      }),
    )
    renderAt('/register')

    fill('First name', 'Jane')
    fill('Email', 'jane@example.com')
    fill('Password', 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('size must be between 8 and 128')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe('Registration is closed')
  })
})

describe('create an organization', () => {
  it('creates it and opens it, instead of reading the cached list that lacks it', async () => {
    session.setStatus('signedIn')
    server.tenants = []
    const router = renderAt('/orgs')
    await screen.findByRole('heading', { name: 'Create an organization' })

    fill('Organization name', '  Acme Robotics  ')
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }))

    await screen.findByRole('heading', { name: 'Flags' })
    expect(server.created).toEqual([{ name: 'Acme Robotics' }])
    expect(router.state.location.pathname).toBe(`/t/${NEW_ORG_ID}/flags`)
    expect(screen.getByRole('link', { name: 'Switch organization: Acme Robotics' })).toBeDefined()
  })

  it('wants a name that is more than spaces', async () => {
    session.setStatus('signedIn')
    renderAt('/orgs/new')

    fill('Organization name', '   ')
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }))

    expect(await screen.findByText('Enter a name for the organization')).toBeDefined()
    expect(server.created).toEqual([])
  })
})
