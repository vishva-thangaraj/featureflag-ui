import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'

export type Environment = components['schemas']['EnvResponse']

/** Until the backend has a real setting, "protected" is a name: these confirm every change. */
export function isProtectedEnvironment(name: string): boolean {
  return /^prod/i.test(name)
}

export function useEnvironments() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: tenantKey(tenantId, 'envs'),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/envs', { headers: tenantHeaders(tenantId) })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data.envs
    },
  })
}

async function postEnvironment(tenantId: string, body: { name: string; description?: string }) {
  const { data, error, response } = await api.POST('/api/v1/envs', { body, headers: tenantHeaders(tenantId) })
  if (!data) {
    throw new ApiError(response, error)
  }
  return data
}

export function useCreateEnvironment() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => postEnvironment(tenantId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'envs') }),
  })
}

export const STANDARD_ENVIRONMENTS = ['development', 'staging', 'production'] as const

/** One after another, so they list in pipeline order; the list refreshes once, even after a partial failure. */
export function useCreateStandardEnvironments() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      for (const name of STANDARD_ENVIRONMENTS) {
        await postEnvironment(tenantId, { name })
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId, 'envs') }),
  })
}

/** Fields left out are left as they are. */
export function useUpdateEnvironment() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ envId, ...body }: { envId: string; name?: string; description?: string }) => {
      const { data, error, response } = await api.PUT('/api/v1/envs/{envId}', {
        params: { path: { envId } },
        body,
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    // A rename changes the name that keys and config queries are filed under, so refresh everything.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId) }),
  })
}

/** Refused with 409 while any key for the environment is unrevoked. */
export function useDeleteEnvironment() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (envId: string) => {
      const { error, response } = await api.DELETE('/api/v1/envs/{envId}', {
        params: { path: { envId } },
        headers: tenantHeaders(tenantId),
      })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKey(tenantId) }),
  })
}
