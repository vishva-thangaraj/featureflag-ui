import { useSyncExternalStore } from 'react'
import { Navigate, Outlet, useSearchParams } from 'react-router'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { safeNextPath } from './next'
import { getSessionStatus, subscribe } from './session'

/**
 * Keeps signed-in users off the sign-in and register pages. It is also what moves someone on after
 * signing in: the session turns signedIn, this re-renders, and they go to ?next= -- so the forms
 * never navigate themselves.
 */
export function RequireSignedOut() {
  const status = useSyncExternalStore(subscribe, getSessionStatus)
  const [params] = useSearchParams()

  if (status === 'restoring') {
    return <PageSkeleton />
  }
  if (status === 'signedIn') {
    return <Navigate to={safeNextPath(params.get('next'))} replace />
  }
  return <Outlet />
}
