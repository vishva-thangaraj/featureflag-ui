import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'

export type Feature = components['schemas']['FeatureResponse']
export type FlagConfig = components['schemas']['FlagConfigResponse']
type FlagConfigList = components['schemas']['FlagConfigListResponse']

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

export function useCreateFeature() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { key: string; description?: string }) => {
      const { data, error, response } = await api.POST('/api/v1/features', { body, headers: tenantHeaders(tenantId) })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'features') }),
  })
}

export interface SetFlagEnabled {
  featureId: string
  featureKey: string
  envId: string
  envName: string
  enabled: boolean
}

/**
 * Turns a flag on or off in one environment. The switch moves at once: the cached config is updated
 * before the server answers, and put back if it refuses.
 */
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
    onMutate: async ({ featureKey, envName, enabled }) => {
      const key = tenantKey(tenantId, 'config', envName)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<FlagConfigList>(key)
      queryClient.setQueryData<FlagConfigList>(key, (current) =>
        current && {
          ...current,
          flags: current.flags.map((flag) => (flag.featureKey === featureKey ? { ...flag, enabled } : flag)),
        },
      )
      return { key, previous }
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(context.key, context.previous)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'config') }),
  })
}
