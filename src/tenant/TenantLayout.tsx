import type { ReactNode } from 'react'
import { Link, Outlet } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Button } from '@/components/ui/button'
import { TenantContext, useTenantId } from './context'
import { useTenants } from './queries'

export function TenantLayout() {
  const tenantId = useTenantId()
  const tenants = useTenants()

  if (tenants.isPending) {
    return <PageSkeleton />
  }
  if (tenants.isError) {
    return (
      <CenteredMessage title="Couldn't load your organizations">
        <Button variant="outline" onClick={() => void tenants.refetch()}>
          Try again
        </Button>
      </CenteredMessage>
    )
  }

  // Ids are compared as strings: they are TSIDs, too large for a JavaScript number.
  const tenant = tenants.data.find((candidate) => candidate.id === tenantId)
  if (!tenant) {
    return (
      <CenteredMessage title="You don't have access to this organization">
        <p className="text-muted-foreground">It may have been deleted, or you may have been removed from it.</p>
        <Button asChild variant="outline">
          <Link to="/orgs">Your organizations</Link>
        </Button>
      </CenteredMessage>
    )
  }

  return (
    <TenantContext value={tenant}>
      <AppShell>
        <Outlet />
      </AppShell>
    </TenantContext>
  )
}

function CenteredMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  )
}
