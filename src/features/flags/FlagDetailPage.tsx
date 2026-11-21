import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { useSelectedEnvironment } from '@/features/environments/useSelectedEnvironment'
import { useTenantId } from '@/tenant/context'
import { useCan } from '@/tenant/permissions'
import { DeleteFlagDialog } from './DeleteFlagDialog'
import { FlagEnvTabs } from './FlagEnvTabs'
import { FlagEnvironmentPanel } from './FlagEnvironmentPanel'
import { FlagHeader } from './FlagHeader'
import { useFeature, useFlagEnvStatuses } from './queries'

export function FlagDetailPage() {
  const { featureId } = useParams() as { featureId: string }
  const tenantId = useTenantId()
  const canWrite = useCan('write')
  const feature = useFeature(featureId)
  const statuses = useFlagEnvStatuses(featureId)
  const { environments, selected, select } = useSelectedEnvironment()
  const [deleting, setDeleting] = useState(false)

  const listPath = `/t/${tenantId}/flags${selected ? `?env=${encodeURIComponent(selected.name)}` : ''}`

  if (feature.isPending || environments.isPending) {
    return (
      <div role="status" aria-label="Loading flag" className="flex flex-col gap-3">
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <div className="h-5 w-96 max-w-full animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }
  if (feature.isError) {
    const notFound = feature.error instanceof ApiError && feature.error.status === 404
    return (
      <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold">{notFound ? 'This flag was deleted or never existed' : "Couldn't load this flag"}</h1>
        {notFound ? (
          <Button asChild variant="outline">
            <Link to={listPath}>Back to flags</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void feature.refetch()}>
            Try again
          </Button>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to={listPath} className="hover:text-foreground">
          Flags
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="font-mono">
          {feature.data.key}
        </span>
      </nav>

      <FlagHeader feature={feature.data} canWrite={canWrite} onDelete={() => setDeleting(true)} />

      {!selected ? (
        <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
          <h2 className="text-base font-semibold">Set up environments first</h2>
          <p className="text-muted-foreground">Flags are switched on per environment, and this organization has none yet.</p>
          <Button asChild variant="outline">
            <Link to={`/t/${tenantId}/environments`}>Go to Environments</Link>
          </Button>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          <FlagEnvTabs
            environments={environments.data ?? []}
            selected={selected}
            statuses={statuses.data}
            onSelect={select}
          />
          <div role="tabpanel" id="env-panel" aria-labelledby={`env-tab-${selected.id}`}>
            <FlagEnvironmentPanel
              key={selected.id}
              feature={feature.data}
              environment={selected}
              canWrite={canWrite}
            />
          </div>
        </div>
      )}

      {deleting && (
        <DeleteFlagDialog feature={feature.data} statuses={statuses.data ?? []} onClose={() => setDeleting(false)} />
      )}
    </div>
  )
}
