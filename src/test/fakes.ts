import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { components } from '@/api/schema'

type FetchStub = Mock<(request: Request) => Promise<Response>>

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function authBody(accessToken: string): components['schemas']['AuthResponse'] {
  return {
    accessToken,
    userId: '461168601842738690',
    email: 'user@example.com',
    tenantId: null,
    roles: [],
    accessTokenExpiresIn: 900_000,
  }
}

export function meBody(): components['schemas']['MeResponse'] {
  return {
    userId: '461168601842738690',
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: null,
    status: 'ACTIVE',
    tenantId: null,
    roles: [],
  }
}

export function errorBody(status: number, message = 'Unauthorized') {
  return { status, error: 'Error', message, timestamp: '2026-10-31T00:00:00Z' }
}

export function pathOf(request: Request): string {
  return new URL(request.url).pathname
}

/**
 * Replaces fetch. Install it before importing the module under test: openapi-fetch captures fetch when
 * its client is created.
 */
export function stubFetch(respond: (request: Request) => Response | Promise<Response>): FetchStub {
  const stub: FetchStub = vi.fn(async (request: Request) => respond(request))
  vi.stubGlobal('fetch', stub)
  return stub
}

export function requestsTo(stub: FetchStub, pathname: string): Request[] {
  return stub.mock.calls.map(([request]) => request).filter((request) => pathOf(request) === pathname)
}

/** navigator.locks with one exclusive lock, and a way to hold it the way another tab would. */
export function installLocks(): { hold: () => () => void } {
  let tail: Promise<unknown> = Promise.resolve()
  const request = (_name: string, work: () => Promise<unknown>) => {
    const run = tail.then(() => work())
    tail = run.catch(() => undefined)
    return run
  }
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return {
    hold() {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      tail = tail.then(() => held)
      return release
    },
  }
}

/**
 * BroadcastChannel confined to one test, so session modules left over from earlier tests -- each test
 * imports a fresh copy -- hear nothing from this one.
 */
export function installBroadcastBus(): void {
  const open = new Set<FakeBroadcastChannel>()

  class FakeBroadcastChannel extends EventTarget {
    readonly name: string

    constructor(name: string) {
      super()
      this.name = name
      open.add(this)
    }

    postMessage(data: unknown): void {
      for (const other of open) {
        if (other !== this && other.name === this.name) {
          queueMicrotask(() => other.dispatchEvent(new MessageEvent('message', { data })))
        }
      }
    }

    close(): void {
      open.delete(this)
    }
  }

  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
}
