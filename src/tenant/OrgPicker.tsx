import { Link, Navigate } from 'react-router'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Button } from '@/components/ui/button'
import { useTenants } from './queries'

/** No organizations: create one. Exactly one: go straight in. Several: choose. */
export function OrgPicker() {
  const tenants = useTenants()

  if (tenants.isPending) {
    return <PageSkeleton />
  }
  if (tenants.isError) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4">
        <h1 className="text-2xl font-semibold tracking-tight">Couldn't load your organizations</h1>
        <Button variant="outline" onClick={() => void tenants.refetch()}>
          Try again
        </Button>
      </main>
    )
  }
  if (tenants.data.length === 0) {
    return <Navigate to="/orgs/new" replace />
  }
  if (tenants.data.length === 1) {
    return <Navigate to={`/t/${tenants.data[0].id}/flags`} replace />
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">Choose an organization</h1>
      <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
        {tenants.data.map((tenant) => (
          <li key={tenant.id}>
            <Link to={`/t/${tenant.id}/flags`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
              <span className="font-medium">{tenant.name}</span>
              <span className="text-sm text-muted-foreground">
                {tenant.roles.map((role) => role.name).join(', ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/orgs/new" className="text-sm font-medium text-link">
        Create an organization
      </Link>
    </main>
  )
}
