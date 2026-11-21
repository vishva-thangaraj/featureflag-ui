import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import { tenantKey, useTenantId, type Tenant } from './context'

/** Every organization the caller belongs to, with their roles in each. Not tenant-scoped. */
export const tenantsQuery = queryOptions({
  queryKey: ['tenants'],
  queryFn: async () => {
    const { data, error, response } = await api.GET('/api/v1/tenants')
    if (!data) {
      throw new ApiError(response, error)
    }
    return data.tenants
  },
})

export function useTenants() {
  return useQuery(tenantsQuery)
}

/** The caller becomes its OWNER. */
export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error, response } = await api.POST('/api/v1/tenants', { body: { name } })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    // The picker cached a list without this organization moments ago. Opening it before the refetch
    // lands would have TenantLayout read that list and refuse its own owner.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants'] }),
  })
}

/** OWNER only. The switcher reads the name from the tenants list, so that is what gets refreshed. */
export function useRenameTenant() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error, response } = await api.PUT('/api/v1/tenants/{tenantId}', {
        params: { path: { tenantId } },
        body: { name },
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants'] }),
  })
}

/** OWNER only. A hard delete of everything the organization owns, with no undo. */
export function useDeleteTenant() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE('/api/v1/tenants/{tenantId}', { params: { path: { tenantId } } })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSuccess: () => {
      // Out of the cached list at once, so the entry point can't send anyone back in before the refetch
      // lands; TenantLayout then unmounts this organization's pages along with their queries.
      queryClient.setQueryData<Tenant[]>(['tenants'], (tenants) => tenants?.filter((tenant) => tenant.id !== tenantId))
      queryClient.removeQueries({ queryKey: tenantKey(tenantId) })
      void queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })
}
