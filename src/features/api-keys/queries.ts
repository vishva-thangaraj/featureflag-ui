import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'

export type ApiKey = components['schemas']['ApiKeyResponse']

/** Every key in the organization, revoked ones included: they stay listed for the audit trail. */
export function useApiKeys() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'api-keys'),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/api-keys', { headers: tenantHeaders(tenantId) })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data.apiKeys
    },
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
