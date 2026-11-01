// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { json, pathOf } from '@/test/fakes'
import { routes } from './routes'

// Installed before any import runs, because openapi-fetch captures fetch when the client is created.
const http = vi.hoisted(() => {
  const state = {
    respond: (_request: Request): Response | Promise<Response> => new Response(null, { status: 404 }),
  }
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => state.respond(request)))
  return state
})

const session = vi.hoisted(() => {
  let status: 'restoring' | 'signedIn' | 'signedOut' = 'signedIn'
  const listeners = new Set<() => void>()
  return {
    setStatus(next: 'restoring' | 'signedIn' | 'signedOut') {
      status = next
      listeners.forEach((listener) => listener())
    },
    module: {
      getSessionStatus: () => status,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getAccessToken: () => 'access-1',
      refresh: async () => null,
      logout: async () => {},
    },
  }
})
vi.mock('@/auth/session', () => session.module)

const ACME = { id: '461168601842738689', name: 'Acme Robotics', plan: 'FREE', roles: [{ id: '1', name: 'OWNER' }] }
const GLOBEX = { id: '461168601842738777', name: 'Globex', plan: 'PRO', roles: [{ id: '2', name: 'VIEWER' }] }

function memberOf(...tenants: (typeof ACME)[]) {
  http.respond = (request) =>
    pathOf(request) === '/api/v1/tenants' ? json({ tenants }) : new Response(null, { status: 404 })
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

beforeEach(() => {
  session.setStatus('signedIn')
  memberOf(ACME)
})

afterEach(() => {
  cleanup()
})

describe('routes', () => {
  it('sends a signed-out visitor to sign in, remembering where they were going', async () => {
    session.setStatus('signedOut')

    const router = renderAt(`/t/${ACME.id}/flags?env=production`)

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(`/t/${ACME.id}/flags?env=production`)
  })

  it('waits while the session is restoring instead of flashing the sign-in page', async () => {
    session.setStatus('restoring')

    const router = renderAt(`/t/${ACME.id}/flags`)

    expect(screen.getByRole('status', { name: 'Loading' })).toBeDefined()
    expect(router.state.location.pathname).toBe(`/t/${ACME.id}/flags`)

    act(() => session.setStatus('signedIn'))
    await screen.findByRole('heading', { name: 'Flags' })
  })

  it('opens an organization the caller belongs to, inside the shell', async () => {
    const router = renderAt(`/t/${ACME.id}`)

    await screen.findByRole('heading', { name: 'Flags' })
    expect(router.state.location.pathname).toBe(`/t/${ACME.id}/flags`)
    expect(screen.getByRole('link', { name: 'Switch organization: Acme Robotics' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Flags' }).getAttribute('aria-current')).toBe('page')
  })

  it('refuses an organization the caller does not belong to', async () => {
    renderAt(`/t/${GLOBEX.id}/flags`)

    await screen.findByRole('heading', { name: "You don't have access to this organization" })
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })

  it('takes someone with one organization straight into it from the entry', async () => {
    const router = renderAt('/')

    await screen.findByRole('heading', { name: 'Flags' })
    expect(router.state.location.pathname).toBe(`/t/${ACME.id}/flags`)
  })

  it('sends someone with several organizations from the entry to the list', async () => {
    memberOf(ACME, GLOBEX)

    const router = renderAt('/')

    await screen.findByRole('heading', { name: 'Your organizations' })
    expect(router.state.location.pathname).toBe('/orgs')
    expect(screen.getByRole('link', { name: /Globex/ }).getAttribute('href')).toBe(`/t/${GLOBEX.id}/flags`)
  })

  it('opens the organization list from the switcher even with one organization, so another can be created', async () => {
    renderAt(`/t/${ACME.id}/flags`)
    await screen.findByRole('heading', { name: 'Flags' })

    fireEvent.click(screen.getByRole('link', { name: 'Switch organization: Acme Robotics' }))

    await screen.findByRole('heading', { name: 'Your organizations' })
    expect(screen.getByRole('link', { name: /Acme Robotics/ }).getAttribute('href')).toBe(`/t/${ACME.id}/flags`)
    expect(screen.getByRole('link', { name: 'Create an organization' }).getAttribute('href')).toBe('/orgs/new')
  })

  it('leaves for the sign-in page as soon as the session ends mid-visit', async () => {
    const router = renderAt(`/t/${ACME.id}/members`)
    await screen.findByRole('heading', { name: 'Members' })

    act(() => session.setStatus('signedOut'))

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(`/t/${ACME.id}/members`)
  })
})
