// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ApiKey } from '@/features/api-keys/queries'
import type { FlagConfig } from '@/features/flags/queries'
import { firstRunProgress } from './progress'

const NOW = Date.parse('2026-11-21T12:00:00Z')

const env = (id: string, name: string) => ({ id, name, description: null, createdAt: `2026-11-0${id}T00:00:00Z` })
const DEV = env('1', 'development')
const PROD = env('3', 'production')

const feature = (id: string, key: string, createdAt: string) => ({ id, key, description: null, createdAt })

const flag = (featureKey: string, enabled: boolean): FlagConfig => ({
  featureKey,
  environment: 'development',
  enabled,
  rolloutPercentage: 100,
  enabledUsers: [],
  disabledUsers: [],
  rules: [],
  lastModified: '',
})

const key = (id: string, extra: Partial<ApiKey> = {}): ApiKey => ({
  id,
  name: `key-${id}`,
  envName: 'development',
  prefix: 'ffsdk_abc',
  createdAt: '2026-11-20T00:00:00Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...extra,
})

describe('firstRunProgress', () => {
  it('starts a new organization at step one', () => {
    const progress = firstRunProgress([], [], undefined, [], NOW)

    expect(progress.doneCount).toBe(0)
    expect(progress.current).toBe('environments')
    expect(progress.environment).toBeUndefined()
  })

  it('turns the first flag on where changes need no confirming', () => {
    expect(firstRunProgress([PROD, DEV], [], undefined, [], NOW).environment).toBe(DEV)
    expect(firstRunProgress([PROD], [], undefined, [], NOW).environment).toBe(PROD)
  })

  it('names the flag that is on, or else the newest one', () => {
    const features = [feature('a', 'old_flag', '2026-11-01T00:00:00Z'), feature('b', 'new_flag', '2026-11-10T00:00:00Z')]

    expect(firstRunProgress([DEV], features, [], [], NOW).flag?.key).toBe('new_flag')
    expect(firstRunProgress([DEV], features, [flag('old_flag', true)], [], NOW).flag?.key).toBe('old_flag')
  })

  it('counts a flag that is set up but off as not on yet', () => {
    const progress = firstRunProgress([DEV], [feature('a', 'f', '2026-11-01T00:00:00Z')], [flag('f', false)], [], NOW)

    expect(progress.done.enabled).toBe(false)
    expect(progress.current).toBe('enabled')
  })

  it('only counts a key an SDK could still use, but any key that was ever read', () => {
    const revoked = key('1', { revokedAt: '2026-11-20T10:00:00Z', lastUsedAt: '2026-11-20T09:00:00Z' })
    const expired = key('2', { expiresAt: '2026-11-21T11:00:00Z' })

    const progress = firstRunProgress([DEV], [], undefined, [revoked, expired], NOW)

    expect(progress.done.key).toBe(false)
    expect(progress.key).toBeUndefined()
    expect(progress.done.read).toBe(true)
    expect(progress.readAt).toBe('2026-11-20T09:00:00Z')
  })

  it('ticks steps done out of order, and points at the first one left', () => {
    const progress = firstRunProgress([DEV], [], undefined, [key('1', { lastUsedAt: '2026-11-21T10:00:00Z' })], NOW)

    expect(progress.done).toEqual({ environments: true, flag: false, enabled: false, key: true, read: true })
    expect(progress.doneCount).toBe(3)
    expect(progress.current).toBe('flag')
  })

  it('has no current step once everything is done', () => {
    const progress = firstRunProgress(
      [DEV],
      [feature('a', 'f', '2026-11-01T00:00:00Z')],
      [flag('f', true)],
      [key('1', { lastUsedAt: '2026-11-21T10:00:00Z' })],
      NOW,
    )

    expect(progress.doneCount).toBe(5)
    expect(progress.current).toBeUndefined()
  })
})
