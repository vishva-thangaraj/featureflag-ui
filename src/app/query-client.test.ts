import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { queryClient, shouldRetry } from './query-client'

const session = vi.hoisted(() => {
  let status = 'signedIn'
  const listeners = new Set<() => void>()
  return {
    setStatus(next: string) {
      status = next
      listeners.forEach((listener) => listener())
    },
    module: {
      getSessionStatus: () => status,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
})
vi.mock('@/auth/session', () => session.module)

const failure = (status: number) => new ApiError(new Response(null, { status }), undefined)

describe('query client', () => {
  it('does not retry client errors, and retries server and network failures twice', () => {
    expect(shouldRetry(0, failure(403))).toBe(false)
    expect(shouldRetry(0, failure(404))).toBe(false)
    expect(shouldRetry(0, failure(503))).toBe(true)
    expect(shouldRetry(1, failure(503))).toBe(true)
    expect(shouldRetry(2, failure(503))).toBe(false)
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true)
  })

  it('forgets everything it cached when the session ends', () => {
    queryClient.setQueryData(['t', '461168601842738689', 'features'], [])

    session.setStatus('signedOut')

    expect(queryClient.getQueryData(['t', '461168601842738689', 'features'])).toBeUndefined()
  })
})
