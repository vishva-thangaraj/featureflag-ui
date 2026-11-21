import { useId, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Lock, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { isProtectedEnvironment, useEnvironments } from '@/features/environments/queries'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/tenant/context'
import { useCan } from '@/tenant/permissions'
import { CreateApiKeyDialog } from './CreateApiKeyDialog'
import { RevokeApiKeyDialog } from './RevokeApiKeyDialog'
import { RotateApiKeyDialog } from './RotateApiKeyDialog'
import { formatLastUsed, keyStatus, useApiKeys, type ApiKey, type KeyStatus } from './queries'

const ALL_ENVIRONMENTS = 'all'

export function ApiKeysPage() {
  const tenantId = useTenantId()
  const canWrite = useCan('write')
  const environments = useEnvironments()
  const keys = useApiKeys()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [rotating, setRotating] = useState<ApiKey | null>(null)
  const envFilterId = useId()

  const envList = environments.data ?? []
  const requestedEnv = params.get('env')
  const envFilter = envList.some((env) => env.name === requestedEnv) ? requestedEnv : null
  const showRevoked = params.get('revoked') === 'show'

  function setParam(name: string, value: string | null) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) {
          next.set(name, value)
        } else {
          next.delete(name)
        }
        return next
      },
      { replace: true },
    )
  }

  const allKeys = keys.data ?? []
  const inEnv = envFilter ? allKeys.filter((key) => key.envName === envFilter) : allKeys
  const revokedCount = inEnv.filter((key) => key.revokedAt != null).length
  const visible = showRevoked ? inEnv : inEnv.filter((key) => key.revokedAt == null)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="API keys"
        description="SDKs use these to read flags. Each key reads one environment."
        viewOnly={!canWrite}
        actions={
          canWrite &&
          envList.length > 0 &&
          allKeys.length > 0 && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Create key
            </Button>
          )
        }
      />

      {environments.isPending || keys.isPending ? (
        <div role="status" aria-label="Loading API keys" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-9 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : environments.isError || keys.isError ? (
        <EmptyCard title="Couldn't load API keys">
          <Button
            variant="outline"
            onClick={() => {
              void environments.refetch()
              void keys.refetch()
            }}
          >
            Try again
          </Button>
        </EmptyCard>
      ) : envList.length === 0 ? (
        <EmptyCard title="Set up environments first">
          <p className="text-muted-foreground">Each key reads one environment, and this organization has none yet.</p>
          <Button asChild variant="outline">
            <Link to={`/t/${tenantId}/environments`}>Go to Environments</Link>
          </Button>
        </EmptyCard>
      ) : allKeys.length === 0 ? (
        <EmptyCard title="No API keys yet">
          <p className="text-muted-foreground">SDKs use a key to read one environment's flags.</p>
          {canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Create key
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Ask an admin to create one.</p>
          )}
        </EmptyCard>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={envFilterId} className="font-normal text-muted-foreground">
                Environment
              </Label>
              <Select
                value={envFilter ?? ALL_ENVIRONMENTS}
                onValueChange={(value) => setParam('env', value === ALL_ENVIRONMENTS ? null : value)}
              >
                <SelectTrigger id={envFilterId} className={cn('h-9 min-w-40 bg-card', envFilter && 'font-mono text-[13px]')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ENVIRONMENTS}>All</SelectItem>
                  {envList.map((env) => (
                    <SelectItem key={env.id} value={env.name} className="font-mono text-[13px]">
                      {env.name}
                      {isProtectedEnvironment(env.name) && <Lock role="img" aria-label="protected" className="size-3" />}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showRevoked}
                onChange={(event) => setParam('revoked', event.target.checked ? 'show' : null)}
                className="size-4 accent-primary"
              />
              Show revoked
              {revokedCount > 0 && <span className="text-muted-foreground tabular-nums">({revokedCount})</span>}
            </label>
          </div>

          {visible.length === 0 ? (
            inEnv.length === 0 ? (
              <EmptyCard title={`No keys for ${envFilter}`}>
                <Button variant="outline" onClick={() => setParam('env', null)}>
                  Show all environments
                </Button>
              </EmptyCard>
            ) : (
              <EmptyCard title={envFilter ? `Every key for ${envFilter} is revoked` : 'Every key is revoked'}>
                <Button variant="outline" onClick={() => setParam('revoked', 'show')}>
                  Show revoked
                </Button>
              </EmptyCard>
            )
          ) : (
            <section aria-label="API keys" className="overflow-hidden rounded-xl border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">Name</TableHead>
                      <TableHead className="px-4">Environment</TableHead>
                      <TableHead className="px-4">Last used</TableHead>
                      <TableHead className="hidden px-4 xl:table-cell">Expires</TableHead>
                      <TableHead className="px-4">Status</TableHead>
                      {canWrite && (
                        <TableHead className="w-36 px-3">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((key) => {
                      const status = keyStatus(key)
                      return (
                        <TableRow key={key.id} className={cn(status.kind === 'revoked' && 'text-muted-foreground')}>
                          <TableCell className="min-w-40 px-4 py-2.5">
                            <div className="font-medium">{key.name}</div>
                            <code className="font-mono text-xs text-muted-foreground">{key.prefix}…</code>
                          </TableCell>
                          <TableCell className="px-4">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[13px]">
                              {isProtectedEnvironment(key.envName) && (
                                <Lock role="img" aria-label="protected" className="size-3.5 text-muted-foreground" />
                              )}
                              {key.envName}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 whitespace-normal text-ink-secondary">
                            {key.lastUsedAt ? (
                              <time dateTime={key.lastUsedAt} title={formatDateTime(key.lastUsedAt)}>
                                {formatLastUsed(key.lastUsedAt)}
                              </time>
                            ) : (
                              'Never'
                            )}
                          </TableCell>
                          <TableCell className="hidden px-4 text-ink-secondary xl:table-cell">
                            {key.expiresAt ? (
                              <time dateTime={key.expiresAt} title={formatDateTime(key.expiresAt)}>
                                {formatDate(key.expiresAt)}
                              </time>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="px-4">
                            <StatusBadge status={status} expiresAt={key.expiresAt} />
                          </TableCell>
                          {canWrite && (
                            <TableCell className="px-3 text-right">
                              {status.kind !== 'revoked' && (
                                <>
                                  <Button variant="ghost" size="sm" aria-label={`Rotate ${key.name}`} onClick={() => setRotating(key)}>
                                    Rotate
                                  </Button>
                                  <Button variant="ghost" size="sm" aria-label={`Revoke ${key.name}`} onClick={() => setRevoking(key)}>
                                    Revoke
                                  </Button>
                                </>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                Last used is recorded at most every five minutes. Revoking takes effect on the key's next request.
              </p>
            </section>
          )}
        </>
      )}

      {creating && (
        <CreateApiKeyDialog
          environments={envList}
          defaultEnvName={envFilter ?? undefined}
          onClose={() => setCreating(false)}
        />
      )}
      {revoking && <RevokeApiKeyDialog key={revoking.id} apiKey={revoking} onClose={() => setRevoking(null)} />}
      {rotating && <RotateApiKeyDialog key={rotating.id} apiKey={rotating} onClose={() => setRotating(null)} />}
    </div>
  )
}

/** Below xl the Expires column is hidden, so the badge carries the date on hover. */
function StatusBadge({ status, expiresAt }: { status: KeyStatus; expiresAt?: string | null }) {
  return <span title={expiresAt ? `Expires ${formatDateTime(expiresAt)}` : undefined}>{statusBadge(status)}</span>
}

function statusBadge(status: KeyStatus) {
  switch (status.kind) {
    case 'revoked':
      return <Badge variant="secondary">Revoked</Badge>
    case 'expired':
      return <Badge variant="destructive">Expired</Badge>
    case 'expiring':
      return (
        <Badge className="bg-warning-soft text-warning">
          Expires in {status.days} day{status.days === 1 ? '' : 's'}
        </Badge>
      )
    case 'active':
      return <Badge className="bg-success-soft text-success">Active</Badge>
  }
}

function EmptyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}
