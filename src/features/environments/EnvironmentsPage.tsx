import { useState } from 'react'
import { Loader2, Lock, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { unrevokedKeysFor, useApiKeys } from '@/features/api-keys/queries'
import { fallbackMessage } from '@/lib/form-errors'
import { formatDate } from '@/lib/format'
import { useCan } from '@/tenant/permissions'
import { DeleteEnvironmentDialog } from './DeleteEnvironmentDialog'
import { EnvironmentFormDialog } from './EnvironmentFormDialog'
import {
  isProtectedEnvironment,
  STANDARD_ENVIRONMENTS,
  useCreateStandardEnvironments,
  useEnvironments,
  type Environment,
} from './queries'

export function EnvironmentsPage() {
  const canWrite = useCan('write')
  const environments = useEnvironments()
  const keys = useApiKeys()
  const [editing, setEditing] = useState<Environment | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Environment | null>(null)

  // Creation order is pipeline order for most teams (development, staging, production).
  const sorted = [...(environments.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Environments"
        description="Where flags run. Each one has its own on/off state, rollout, rules and overrides for every flag."
        viewOnly={!canWrite}
        actions={
          canWrite &&
          sorted.length > 0 && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" className="size-4" />
              New environment
            </Button>
          )
        }
      />

      {environments.isPending ? (
        <div role="status" aria-label="Loading environments" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-9 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : environments.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
          <p>Couldn't load environments.</p>
          <Button variant="outline" onClick={() => void environments.refetch()}>
            Try again
          </Button>
        </div>
      ) : sorted.length === 0 ? (
        <NoEnvironments canWrite={canWrite} onNameYourOwn={() => setEditing('new')} />
      ) : (
        <section aria-label="Environments" className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Environment</TableHead>
                  <TableHead className="w-36 px-4">API keys</TableHead>
                  <TableHead className="w-36 px-4">Created</TableHead>
                  {canWrite && (
                    <TableHead className="w-40 px-4">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((environment) => (
                  <TableRow key={environment.id}>
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          {isProtectedEnvironment(environment.name) && (
                            <Lock aria-hidden="true" className="size-3.5 text-muted-foreground" />
                          )}
                          <span className="font-mono text-[13px] font-medium">{environment.name}</span>
                          {isProtectedEnvironment(environment.name) && <Badge variant="secondary">Protected</Badge>}
                        </span>
                        {environment.description && (
                          <span className="text-sm text-muted-foreground">{environment.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 tabular-nums text-ink-secondary">
                      {keys.data ? unrevokedKeysFor(keys.data, environment.name).length : '—'}
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground" title={environment.createdAt}>
                      {formatDate(environment.createdAt)}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="px-4 text-right">
                        <Button variant="ghost" size="sm" aria-label={`Edit ${environment.name}`} onClick={() => setEditing(environment)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${environment.name}`}
                          onClick={() => setDeleting(environment)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
            <span>Names starting with “prod” are protected: changes there ask first.</span>
            <span>
              Renaming changes the name used by <code className="font-mono text-xs">/config?envName=</code>. SDK keys keep
              working.
            </span>
          </div>
        </section>
      )}

      {editing && (
        <EnvironmentFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          environment={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && <DeleteEnvironmentDialog key={deleting.id} environment={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function NoEnvironments({ canWrite, onNameYourOwn }: { canWrite: boolean; onNameYourOwn: () => void }) {
  const createStandard = useCreateStandardEnvironments()

  function createAll() {
    createStandard.mutate(undefined, {
      onSuccess: () => toast.success(`Created ${STANDARD_ENVIRONMENTS.join(', ')}`),
      onError: (error) => toast.error(`Couldn't create them all. ${fallbackMessage(error)}`),
    })
  }

  return (
    <section aria-labelledby="no-environments" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
      <h2 id="no-environments" className="text-base font-semibold">
        No environments yet
      </h2>
      <p className="text-muted-foreground">Flags are switched on per environment. Most teams start with three.</p>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={createAll}
            disabled={createStandard.isPending}
            className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal"
          >
            {createStandard.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Create development, staging and production
          </Button>
          <Button variant="outline" onClick={onNameYourOwn}>
            Name your own
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ask an admin to create one.</p>
      )}
    </section>
  )
}
