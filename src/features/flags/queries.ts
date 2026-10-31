import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'

/** Keys and descriptions only; each flag's state per environment comes from useFlagConfig. */
export function useFeatures() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'features'),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/features', { headers: tenantHeaders(tenantId) })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data.features
    },
  })
}

/** Every flag's configuration in one environment. A flag missing from it is not set up there. */
export function useFlagConfig(envName: string | undefined) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'config', envName),
    enabled: envName !== undefined,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/config', {
        params: { query: { envName: envName! } },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

export interface SetFlagEnabled {
  featureId: string
  envId: string
  enabled: boolean
}

export function useSetFlagEnabled() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ featureId, envId, enabled }: SetFlagEnabled) => {
      // No rolloutPercentage: the server then keeps whatever rollout the environment already has.
      const { error, response } = await api.POST('/api/v1/features/{featureId}/enable', {
        params: { path: { featureId } },
        body: { envId, enabled },
        headers: tenantHeaders(tenantId),
      })
      // The success body is empty, so there is no `data` to check.
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'config') }),
  })
}
