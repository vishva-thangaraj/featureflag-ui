import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'

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
