import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'

/** Every organization the caller belongs to, with their roles in each. Not tenant-scoped. */
export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/tenants')
      if (!data) {
        throw new ApiError(response, error)
      }
      return data.tenants
    },
  })
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
