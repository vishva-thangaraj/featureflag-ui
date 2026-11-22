import { isExpired, type ApiKey } from '@/features/api-keys/queries'
import { isProtectedEnvironment, type Environment } from '@/features/environments/queries'
import type { Feature, FlagConfig } from '@/features/flags/queries'

export type StepId = 'environments' | 'flag' | 'enabled' | 'key' | 'read'

export const STEPS: readonly StepId[] = ['environments', 'flag', 'enabled', 'key', 'read']

export interface FirstRunProgress {
  environment: Environment | undefined
  /** The flag that's on there, or else the newest one. */
  flag: Feature | undefined
  /** The newest key an SDK could still use. */
  key: ApiKey | undefined
  /** When any key was last seen in use. */
  readAt: string | undefined
  done: Record<StepId, boolean>
  doneCount: number
  /** The first step not done yet: steps done out of order still count. */
  current: StepId | undefined
}

/** Where the first flag gets turned on: the first environment whose changes don't need confirming. */
export const firstRunEnvironment = (environments: Environment[]): Environment | undefined =>
  environments.find((env) => !isProtectedEnvironment(env.name)) ?? environments[0]

/** Each step is read from what exists, so work done elsewhere, or through the API, ticks it too. */
export function firstRunProgress(
  environments: Environment[],
  features: Feature[],
  flags: FlagConfig[] | undefined,
  keys: ApiKey[],
  now = Date.now(),
): FirstRunProgress {
  const environment = firstRunEnvironment(environments)
  const enabled = flags?.find((flag) => flag.enabled)
  const newest = [...features].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  const flag = (enabled && features.find((feature) => feature.key === enabled.featureKey)) || newest
  const key = keys.find((candidate) => candidate.revokedAt == null && !isExpired(candidate, now))
  const readAt = keys
    .map((candidate) => candidate.lastUsedAt)
    .filter((lastUsedAt): lastUsedAt is string => lastUsedAt != null)
    .sort()
    .at(-1)

  const done: Record<StepId, boolean> = {
    environments: environments.length > 0,
    flag: features.length > 0,
    enabled: enabled !== undefined,
    key: key !== undefined,
    read: readAt !== undefined,
  }
  return {
    environment,
    flag,
    key,
    readAt,
    done,
    doneCount: STEPS.filter((step) => done[step]).length,
    current: STEPS.find((step) => !done[step]),
  }
}
