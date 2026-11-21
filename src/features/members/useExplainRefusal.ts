import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { useTenant } from '@/tenant/context'
import { tenantsQuery } from '@/tenant/queries'
import { highestRole } from './roles'

/**
 * For a 403, after the mutation has re-read the tenants list: when the caller's own role is what changed,
 * that is the explanation to give. Otherwise undefined, and the server's message stands.
 */
export function useExplainRefusal() {
  const tenant = useTenant()
  const queryClient = useQueryClient()

  return (error: unknown): string | undefined => {
    if (!(error instanceof ApiError) || error.status !== 403) {
      return undefined
    }
    const tenants = queryClient.getQueryData(tenantsQuery.queryKey)
    if (!tenants) {
      return undefined
    }
    const refreshed = tenants.find((candidate) => candidate.id === tenant.id)
    if (!refreshed) {
      return `You're no longer a member of ${tenant.name}.`
    }
    const before = highestRole(tenant.roles.map((role) => role.name))
    const after = highestRole(refreshed.roles.map((role) => role.name))
    if (after && after.name !== before?.name) {
      return `Your role in ${tenant.name} is now ${after.label}.`
    }
    return undefined
  }
}
