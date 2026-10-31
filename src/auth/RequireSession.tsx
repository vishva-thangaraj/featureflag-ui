import { useSyncExternalStore } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { getSessionStatus, subscribe } from './session'

export function RequireSession() {
  const status = useSyncExternalStore(subscribe, getSessionStatus)
  const location = useLocation()

  // On a reload the cookie usually restores the session within milliseconds; never flash /login.
  if (status === 'restoring') {
    return <PageSkeleton />
  }
  if (status === 'signedOut') {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <Outlet />
}
