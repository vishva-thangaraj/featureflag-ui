import { useQuery } from '@tanstack/react-query'
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
