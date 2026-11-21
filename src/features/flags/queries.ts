import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'
import type { RuleRequest } from './rules'

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
    // No rolloutPercentage: the server then keeps whatever rollout the environment already has.
    mutationFn: ({ featureId, envId, enabled }: SetFlagEnabled) => postEnable(tenantId, featureId, { envId, enabled }),
    onMutate: async ({ featureKey, envName, enabled }) => {
      // Both the environment's list and this flag's own config, so the list and the flag page move together.
      const listKey = tenantKey(tenantId, 'config', envName)
      const flagKey = tenantKey(tenantId, 'config', envName, featureKey)
      await queryClient.cancelQueries({ queryKey: listKey })
      const previousList = queryClient.getQueryData<FlagConfigList>(listKey)
      const previousFlag = queryClient.getQueryData<FlagConfig | null>(flagKey)
      queryClient.setQueryData<FlagConfigList>(listKey, (current) =>
        current && {
          ...current,
          flags: current.flags.map((flag) => (flag.featureKey === featureKey ? { ...flag, enabled } : flag)),
        },
      )
      queryClient.setQueryData<FlagConfig | null>(flagKey, (current) => current && { ...current, enabled })
      return { listKey, previousList, flagKey, previousFlag }
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(context.listKey, context.previousList)
        queryClient.setQueryData(context.flagKey, context.previousFlag)
      }
    },
    onSettled: (_data, _error, { featureId }) => invalidateFlag(queryClient, tenantId, featureId),
  })
}

async function postEnable(
  tenantId: string,
  featureId: string,
  body: { envId: string; enabled: boolean; rolloutPercentage?: number },
) {
  const { error, response } = await api.POST('/api/v1/features/{featureId}/enable', {
    params: { path: { featureId } },
    body,
    headers: tenantHeaders(tenantId),
  })
  // The success body is empty, so there is no `data` to check.
  if (!response.ok) {
    throw new ApiError(response, error)
  }
}

function invalidateFlag(queryClient: QueryClient, tenantId: string, featureId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'config') }),
    queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'feature-envs', featureId) }),
  ])
}

export function useFeature(featureId: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'features', featureId),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/features/{featureId}', {
        params: { path: { featureId } },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

export type FlagEnvStatus = components['schemas']['FeatureEnvStatusResponse']

/** The flag's on/off state and rollout in each environment where it is set up, in one call. */
export function useFlagEnvStatuses(featureId: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'feature-envs', featureId),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/features/{featureId}/envs', {
        params: { path: { featureId } },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

/**
 * Exactly what an SDK receives for this flag in one environment, or null where it is not set up: the
 * server answers that case with 404, which here is a state rather than an error.
 */
export function useFlagConfigFor(featureKey: string | undefined, envName: string | undefined) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'config', envName, featureKey),
    enabled: featureKey !== undefined && envName !== undefined,
    queryFn: async (): Promise<FlagConfig | null> => {
      const { data, error, response } = await api.GET('/api/v1/config/{featureKey}', {
        params: { path: { featureKey: featureKey! }, query: { envName: envName! } },
        headers: tenantHeaders(tenantId),
      })
      if (response.status === 404) {
        return null
      }
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

export function useUpdateFeature(featureId: string) {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (description: string) => {
      const { data, error, response } = await api.PUT('/api/v1/features/{featureId}', {
        params: { path: { featureId } },
        body: { description },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'features') }),
  })
}

export function useDeleteFeature(featureId: string) {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE('/api/v1/features/{featureId}', {
        params: { path: { featureId } },
        headers: tenantHeaders(tenantId),
      })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: tenantKey(tenantId, 'features', featureId) })
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'features') }),
        queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'config') }),
      ])
    },
  })
}

/**
 * Writes one environment's on/off state and rollout together. Also what sets a flag up in an
 * environment: the first write creates the row there.
 */
export function useSaveFlagState(featureId: string) {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { envId: string; enabled: boolean; rolloutPercentage?: number }) =>
      postEnable(tenantId, featureId, body),
    onSettled: () => invalidateFlag(queryClient, tenantId, featureId),
  })
}

/** Every rule in one environment, paused ones included: the SDK config leaves those out. */
export function useFlagRules(featureId: string, envId: string, enabled: boolean) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'rules', featureId, envId),
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/features/{featureId}/envs/{envId}/rules', {
        params: { path: { featureId, envId } },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

/** Attribute names already used in this organization's rules, for suggestions. */
export function useRuleAttributes(featureId: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'rule-attributes'),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/features/{featureId}/rules/attributes', {
        params: { path: { featureId } },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

/** Replaces the environment's whole rule set in one call, so a save never leaves half of it applied. */
export function useReplaceRules(featureId: string, envId: string) {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (rules: RuleRequest[]) => {
      const { data, error, response } = await api.PUT('/api/v1/features/{featureId}/envs/{envId}/rules', {
        params: { path: { featureId, envId } },
        body: { rules },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    onSuccess: (rules) => {
      queryClient.setQueryData(tenantKey(tenantId, 'rules', featureId, envId), rules)
      return Promise.all([
        invalidateFlag(queryClient, tenantId, featureId),
        queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'rule-attributes') }),
      ])
    },
  })
}

export type Override = components['schemas']['FeatureUserOverrideResponse']

export function useOverrides(featureId: string, envId: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'overrides', featureId, envId),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/features/{featureId}/envs/{envId}/overrides', {
        params: { path: { featureId, envId } },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

/**
 * Overrides apply at once, one row per call. Each shows in the list before the server answers and is
 * put back if it refuses.
 */
function useOverrideMutation<T extends { externalUserId: string }>(
  featureId: string,
  envId: string,
  send: (tenantId: string, variables: T) => Promise<void>,
  apply: (current: Override[], variables: T) => Override[],
) {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  const key = tenantKey(tenantId, 'overrides', featureId, envId)
  return useMutation({
    mutationFn: (variables: T) => send(tenantId, variables),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Override[]>(key)
      queryClient.setQueryData<Override[]>(key, (current) => current && apply(current, variables))
      return { previous }
    },
    onError: (_error, _variables, context) => queryClient.setQueryData(key, context?.previous),
    onSettled: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: key }), invalidateFlag(queryClient, tenantId, featureId)]),
  })
}

export function useUpsertOverride(featureId: string, envId: string) {
  return useOverrideMutation<{ externalUserId: string; enabled: boolean }>(
    featureId,
    envId,
    async (tenantId, body) => {
      const { error, response } = await api.POST('/api/v1/features/{featureId}/envs/{envId}/overrides', {
        params: { path: { featureId, envId } },
        body,
        headers: tenantHeaders(tenantId),
      })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    (current, { externalUserId, enabled }) =>
      current.some((override) => override.externalUserId === externalUserId)
        ? current.map((override) => (override.externalUserId === externalUserId ? { ...override, enabled } : override))
        : [{ id: `pending-${externalUserId}`, externalUserId, enabled }, ...current],
  )
}

export function useDeleteOverride(featureId: string, envId: string) {
  return useOverrideMutation<{ externalUserId: string }>(
    featureId,
    envId,
    async (tenantId, { externalUserId }) => {
      // openapi-fetch encodes path values, which matters here: user ids are often emails.
      const { error, response } = await api.DELETE(
        '/api/v1/features/{featureId}/envs/{envId}/overrides/{externalUserId}',
        { params: { path: { featureId, envId, externalUserId } }, headers: tenantHeaders(tenantId) },
      )
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    (current, { externalUserId }) => current.filter((override) => override.externalUserId !== externalUserId),
  )
}
