import { useState } from 'react'
import { useApiKeys, type ApiKey } from '@/features/api-keys/queries'
import { useEnvironments } from '@/features/environments/queries'
import { useFeatures, useFlagConfig } from '@/features/flags/queries'
import { useTenantId } from '@/tenant/context'
import { firstRunEnvironment, firstRunProgress } from './progress'

const POLL_INTERVAL = 15_000

const storageKey = (tenantId: string) => `first-run-hidden:${tenantId}`

// Per browser, like any view preference: when storage is unavailable the checklist simply shows again.
function readHidden(tenantId: string): boolean {
  try {
    return localStorage.getItem(storageKey(tenantId)) === '1'
  } catch {
    return false
  }
}

function writeHidden(tenantId: string, hidden: boolean) {
  try {
    if (hidden) {
      localStorage.setItem(storageKey(tenantId), '1')
    } else {
      localStorage.removeItem(storageKey(tenantId))
    }
  } catch {
    // Nothing to keep it in; it only shows again on the next visit.
  }
}

const waitingForFirstRead = (keys: ApiKey[] | undefined) =>
  keys !== undefined && keys.some((key) => key.revokedAt == null) && !keys.some((key) => key.lastUsedAt != null)

export type FirstRun = ReturnType<typeof useFirstRun>

/**
 * The first-run checklist's state for writers. It shows while setup is unfinished, and once more as
 * "set up" when the last step completes on screen. An organization already in use (it has flags and an
 * SDK has read them) never sees it, even if it skipped a step such as turning a flag on in development.
 */
export function useFirstRun(canWrite: boolean) {
  const tenantId = useTenantId()
  // The flags page stays mounted across a switch of organization, so this state follows the id.
  const [view, setView] = useState(() => ({ tenantId, hidden: readHidden(tenantId), sawUnfinished: false }))
  if (view.tenantId !== tenantId) {
    setView({ tenantId, hidden: readHidden(tenantId), sawUnfinished: false })
  }
  const active = canWrite && !view.hidden

  const environments = useEnvironments()
  const features = useFeatures()
  const target = environments.data && firstRunEnvironment(environments.data)
  const config = useFlagConfig(active ? target?.name : undefined)
  const keys = useApiKeys({
    enabled: active,
    // While a key waits for its first use, check now and then, so step 5 ticks without a reload.
    refetchInterval: (list) => (active && waitingForFirstRead(list) ? POLL_INTERVAL : false),
  })

  const failed = environments.isError || features.isError || keys.isError || config.isError
  // With no flags yet nothing can be on, so the checklist doesn't wait for (or flicker on) that config.
  const needsConfig = target !== undefined && (features.data?.length ?? 0) > 0
  const ready = active && environments.isSuccess && features.isSuccess && keys.isSuccess && (!needsConfig || config.isSuccess)
  const progress = ready
    ? firstRunProgress(environments.data, features.data, config.data?.flags, keys.data)
    : undefined
  const complete = progress?.current === undefined
  const inUse = progress !== undefined && progress.done.flag && progress.done.read
  const unfinished = progress !== undefined && !complete && !inUse

  if (unfinished && !view.sawUnfinished) {
    setView({ ...view, sawUnfinished: true })
  }

  function setHidden(hidden: boolean) {
    writeHidden(tenantId, hidden)
    setView((current) => ({ ...current, hidden }))
  }

  return {
    // Once shown, it stays until done or hidden, so finishing the last steps doesn't make it vanish.
    visible: unfinished || (progress !== undefined && view.sawUnfinished),
    /** Still deciding whether to show: the page waits rather than flash an empty state it then replaces. */
    pending: active && !ready && !failed,
    progress,
    environments: environments.data ?? [],
    checking: keys.isFetching,
    checkAgain: () => void keys.refetch(),
    hide: () => setHidden(true),
    show: () => setHidden(false),
  }
}
