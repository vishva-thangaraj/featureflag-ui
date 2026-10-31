import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { getSessionStatus, subscribe } from '@/auth/session'

// A 4xx will not change on its own, and the API client has already retried a 401 once.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) {
    return false
  }
  return failureCount < 2
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: shouldRetry },
  },
})

// Nothing one user loaded may be shown to whoever signs in next in this browser.
subscribe(() => {
  if (getSessionStatus() === 'signedOut') {
    queryClient.clear()
  }
})
