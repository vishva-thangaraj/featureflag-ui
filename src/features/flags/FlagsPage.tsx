import { useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EnvSwitcher } from '@/features/environments/EnvSwitcher'
import { useSelectedEnvironment } from '@/features/environments/useSelectedEnvironment'
import { formatDateTime, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTenantId } from '@/tenant/context'
import { useCan } from '@/tenant/permissions'
import { CreateFlagDialog } from './CreateFlagDialog'
import { FlagSwitch } from './FlagSwitch'
import { useFeatures, useFlagConfig, type Feature, type FlagConfig } from './queries'

type Status = 'on' | 'off' | 'unset'

const FILTERS: { value: Status | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
  { value: 'unset', label: 'Not set up' },
]

interface FlagRow {
  feature: Feature
  config: FlagConfig | undefined
  status: Status
}

export function FlagsPage() {
  const tenantId = useTenantId()
  const canWrite = useCan('write')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { environments, selected, select } = useSelectedEnvironment()
  const features = useFeatures()
  const config = useFlagConfig(selected?.name)
  const [creating, setCreating] = useState(false)

  const query = params.get('q') ?? ''
  const statusFilter = (params.get('status') as Status | null) ?? null

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

  // Two calls for the whole page: keys and descriptions, and this environment's config, joined by key.
  const configByKey = new Map((config.data?.flags ?? []).map((flag) => [flag.featureKey, flag]))
  const rows: FlagRow[] = [...(features.data ?? [])]
    // By key, so a row does not move out from under the cursor when it is toggled.
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((feature) => {
      const flagConfig = configByKey.get(feature.key)
      return { feature, config: flagConfig, status: !flagConfig ? 'unset' : flagConfig.enabled ? 'on' : 'off' }
    })
  const needle = query.trim().toLowerCase()
  const searched = needle
    ? rows.filter(
        ({ feature }) =>
          feature.key.toLowerCase().includes(needle) || (feature.description ?? '').toLowerCase().includes(needle),
      )
    : rows
  const visible = statusFilter ? searched.filter((row) => row.status === statusFilter) : searched
  const countOf = (status: Status | null) => (status ? searched.filter((row) => row.status === status).length : searched.length)

  const detailPath = (feature: Feature) =>
    `/t/${tenantId}/flags/${feature.id}${selected ? `?env=${encodeURIComponent(selected.name)}` : ''}`

  function openRow(event: MouseEvent<HTMLTableRowElement>, feature: Feature) {
    // Dialogs opened from a row render in a portal, but React still bubbles their clicks to the row.
    const target = event.target as HTMLElement
    if (!event.currentTarget.contains(target) || target.closest('a, button, [role="switch"]')) {
      return
    }
    navigate(detailPath(feature))
  }

  const loading = environments.isPending || features.isPending || (selected !== undefined && config.isPending)
  const failed = environments.isError || features.isError || config.isError

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Flags"
        description={
          selected && features.data
            ? `${features.data.length} flag${features.data.length === 1 ? '' : 's'} · state in ${selected.name}`
            : undefined
        }
        viewOnly={!canWrite}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selected && environments.data && (
              <EnvSwitcher environments={environments.data} selected={selected} onSelect={select} />
            )}
            {canWrite && (features.data?.length ?? 0) > 0 && (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" className="size-4" />
                New flag
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <div role="status" aria-label="Loading flags" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-11 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : failed ? (
        <EmptyCard title="Couldn't load flags">
          <Button
            variant="outline"
            onClick={() => {
              void environments.refetch()
              void features.refetch()
              void config.refetch()
            }}
          >
            Try again
          </Button>
        </EmptyCard>
      ) : !selected ? (
        <EmptyCard title="Set up environments first">
          <p className="text-muted-foreground">
            Flags are switched on per environment, and this organization has none yet.
          </p>
          <Button asChild variant="outline">
            <Link to={`/t/${tenantId}/environments`}>Go to Environments</Link>
          </Button>
        </EmptyCard>
      ) : rows.length === 0 ? (
        <EmptyCard title="No flags yet">
          <p className="text-muted-foreground">Flags turn features on and off without a deploy.</p>
          {canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" />
              New flag
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Ask an admin to create one.</p>
          )}
        </EmptyCard>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label="Search flags"
                placeholder="Search flags"
                value={query}
                onChange={(event) => setParam('q', event.target.value)}
                className="h-9 bg-card pl-8"
              />
            </div>
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {FILTERS.map((filter) => {
                const active = statusFilter === filter.value
                return (
                  <button
                    key={filter.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setParam('status', filter.value)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
                      active ? 'border-foreground bg-foreground text-background' : 'bg-card text-ink-secondary hover:bg-accent',
                    )}
                  >
                    {filter.label}
                    <span className="tabular-nums opacity-70">{countOf(filter.value)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyCard title={needle ? `No flags match “${query.trim()}”` : 'No flags in this view'}>
              <Button
                variant="outline"
                onClick={() =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current)
                      next.delete('q')
                      next.delete('status')
                      return next
                    },
                    { replace: true },
                  )
                }
              >
                {needle ? 'Clear search' : 'Show all flags'}
              </Button>
            </EmptyCard>
          ) : (
            <section aria-label="Flags" className="overflow-hidden rounded-xl border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">Flag</TableHead>
                      <TableHead className="w-44 px-4">Status</TableHead>
                      <TableHead className="w-36 px-4">Rollout</TableHead>
                      <TableHead className="w-48 px-4">Targeting</TableHead>
                      <TableHead className="w-32 px-4">Last change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map(({ feature, config: flagConfig }) => (
                      <TableRow
                        key={feature.id}
                        className="cursor-pointer"
                        onClick={(event) => openRow(event, feature)}
                      >
                        <TableCell className="min-w-56 px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <Link to={detailPath(feature)} className="font-mono text-[13px] font-medium hover:underline">
                              {feature.key}
                            </Link>
                            {feature.description && (
                              <span className="block max-w-sm truncate text-sm text-muted-foreground" title={feature.description}>
                                {feature.description}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          {flagConfig ? (
                            <FlagSwitch
                              feature={feature}
                              environment={selected}
                              enabled={flagConfig.enabled}
                              canWrite={canWrite}
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Not set up
                              {canWrite && (
                                <>
                                  {' · '}
                                  <Link to={detailPath(feature)} className="font-medium text-link">
                                    Set up
                                  </Link>
                                </>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-4">
                          <Rollout config={flagConfig} />
                        </TableCell>
                        <TableCell className="px-4">
                          <Targeting config={flagConfig} />
                        </TableCell>
                        <TableCell className="px-4 text-muted-foreground">
                          {flagConfig ? (
                            <time dateTime={flagConfig.lastModified} title={formatDateTime(flagConfig.lastModified)}>
                              {formatRelative(flagConfig.lastModified)}
                            </time>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                Turning a flag on or off in a protected environment asks first. Changes reach SDKs on their next poll.
              </p>
            </section>
          )}
        </>
      )}

      {creating && <CreateFlagDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function Rollout({ config }: { config: FlagConfig | undefined }) {
  if (!config) {
    return <span className="text-muted-foreground">—</span>
  }
  // On, but serving nobody: it reads as live, so say so.
  if (config.enabled && config.rolloutPercentage === 0) {
    return <span className="font-medium text-warning">0% · nobody</span>
  }
  return (
    <span className={cn('inline-flex items-center gap-2 tabular-nums', !config.enabled && 'text-muted-foreground')}>
      {config.rolloutPercentage}%
      <span aria-hidden="true" className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', config.enabled ? 'bg-primary' : 'bg-muted-foreground/40')}
          style={{ width: `${config.rolloutPercentage}%` }}
        />
      </span>
    </span>
  )
}

function Targeting({ config }: { config: FlagConfig | undefined }) {
  if (!config) {
    return <span className="text-muted-foreground">—</span>
  }
  const rules = config.rules.length
  const overrides = config.enabledUsers.length + config.disabledUsers.length
  if (rules === 0 && overrides === 0) {
    return <span className="text-ink-secondary">Everyone</span>
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {rules > 0 && <Badge variant="secondary">{rules} rule{rules === 1 ? '' : 's'}</Badge>}
      {overrides > 0 && <Badge variant="secondary">{overrides} override{overrides === 1 ? '' : 's'}</Badge>}
    </span>
  )
}

function EmptyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}
