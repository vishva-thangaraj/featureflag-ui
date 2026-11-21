import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { formatDate } from '@/lib/format'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'

export type ApiKey = components['schemas']['ApiKeyResponse']
export type CreatedApiKey = components['schemas']['CreatedApiKeyResponse']

interface UseApiKeysOptions {
  /** For a screen waiting on a change: refetch after this many ms, given the keys it has; false to stop. */
  refetchInterval?: (keys: ApiKey[] | undefined) => number | false
}

/** Every key in the organization, newest first, revoked ones included: they stay listed for the audit trail. */
export function useApiKeys({ refetchInterval }: UseApiKeysOptions = {}) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'api-keys'),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/api-keys', { headers: tenantHeaders(tenantId) })
      if (!data) {
        throw new ApiError(response, error)
      }
      return [...data.apiKeys].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    },
    refetchInterval: (query) => refetchInterval?.(query.state.data) ?? false,
  })
}

/** The response is the only place the full key ever appears: the server keeps just its hash. */
export function useCreateApiKey() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: components['schemas']['CreateApiKeyRequest']) => {
      const { data, error, response } = await api.POST('/api/v1/api-keys', { body, headers: tenantHeaders(tenantId) })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'api-keys') }),
    // The result holds the full key: drop it from the mutation cache as soon as no dialog shows it.
    gcTime: 0,
  })
}

/** Takes effect on the key's next request. Revoking an already revoked key succeeds too. */
export function useRevokeApiKey() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (apiKeyId: string) => {
      const { error, response } = await api.DELETE('/api/v1/api-keys/{apiKeyId}', {
        params: { path: { apiKeyId } },
        headers: tenantHeaders(tenantId),
      })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'api-keys') }),
  })
}

export function isExpired(key: ApiKey, now = Date.now()): boolean {
  return key.expiresAt != null && Date.parse(key.expiresAt) <= now
}

/** What stands between an environment and its deletion: every key not yet revoked, expired or not. */
export function unrevokedKeysFor(keys: ApiKey[], envName: string): ApiKey[] {
  return keys.filter((key) => key.envName === envName && key.revokedAt == null)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Keys this close to expiring are flagged, so a key inside a shipped app is replaced before it stops. */
export const EXPIRY_WARNING_DAYS = 14

export type KeyStatus =
  | { kind: 'active' }
  | { kind: 'expiring'; days: number }
  | { kind: 'expired' }
  | { kind: 'revoked' }

export function keyStatus(key: ApiKey, now = Date.now()): KeyStatus {
  if (key.revokedAt != null) {
    return { kind: 'revoked' }
  }
  if (isExpired(key, now)) {
    return { kind: 'expired' }
  }
  const days = key.expiresAt != null ? Math.ceil((Date.parse(key.expiresAt) - now) / DAY) : Infinity
  return days <= EXPIRY_WARNING_DAYS ? { kind: 'expiring', days } : { kind: 'active' }
}

export function daysFromNow(days: number, now = Date.now()): string {
  return new Date(now + days * DAY).toISOString()
}

export function rotatedName(name: string, now = Date.now()): string {
  // A key rotated before keeps one suffix, with the latest date.
  return `${name.replace(/( \(rotated [^)]*\))+$/, '')} (rotated ${formatDate(new Date(now).toISOString())})`
}

const approximateFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
const APPROXIMATE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
]

/** "around 3 minutes ago": `lastUsedAt` is written at most every five minutes, so it is never exact. */
export function formatLastUsed(iso: string, now = Date.now()): string {
  const elapsed = now - Date.parse(iso)
  for (const [unit, size] of APPROXIMATE_UNITS) {
    if (elapsed >= size) {
      return `around ${approximateFormat.format(-Math.round(elapsed / size), unit)}`
    }
  }
  return 'just now'
}
