import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { tenantHeaders, tenantKey, useTenantId } from '@/tenant/context'
import { tenantsQuery } from '@/tenant/queries'
import { highestRole, type RoleName } from './roles'

export type Member = components['schemas']['MemberResponse']
export type Invitation = components['schemas']['InvitationSummary']

const membersKey = (tenantId: string) => tenantKey(tenantId, 'members')
const invitationsKey = (tenantId: string) => tenantKey(tenantId, 'invitations')

export function memberName(member: Member): string {
  return [member.firstName, member.lastName].filter(Boolean).join(' ')
}

export function isOwner(member: Member): boolean {
  return member.roles.some((role) => role.name === 'OWNER')
}

const rankOf = (member: Member) => highestRole(member.roles.map((role) => role.name))?.rank ?? 0

// Module-level, so `select` keeps its result between renders.
function byRankThenName(members: Member[]): Member[] {
  return [...members].sort(
    (a, b) => rankOf(b) - rankOf(a) || a.firstName.localeCompare(b.firstName) || a.email.localeCompare(b.email),
  )
}

/** A 403 on a read can mean the caller's role changed: re-read it before reporting the failure. */
async function readFailed(queryClient: QueryClient, response: Response, error: unknown): Promise<never> {
  if (response.status === 403) {
    await queryClient.invalidateQueries({ queryKey: tenantsQuery.queryKey })
  }
  throw new ApiError(response, error)
}

/** Highest role first, then by name. */
export function useMembers() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: membersKey(tenantId),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/members', { headers: tenantHeaders(tenantId) })
      if (!data) {
        return readFailed(queryClient, response, error)
      }
      return data.members
    },
    select: byRankThenName,
  })
}

/** OWNER/ADMIN only: anyone else gets a 403, so read-only pages don't ask. */
export function useInvitations(enabled = true) {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: invitationsKey(tenantId),
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/invitations', { headers: tenantHeaders(tenantId) })
      if (!data) {
        return readFailed(queryClient, response, error)
      }
      return data.invitations
    },
  })
}

/** Roles are re-read on every request, so a 403 can mean the caller's own role changed: re-read it. */
function refetchOnRefusal(queryClient: QueryClient, tenantId: string, error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: tenantsQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: membersKey(tenantId) }),
    ])
  }
}

export function useUpdateMemberRole() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ membershipId, roleName }: { membershipId: string; roleName: RoleName }) => {
      const { data, error, response } = await api.PUT('/api/v1/members/{membershipId}/role', {
        params: { path: { membershipId } },
        body: { roleName },
        headers: tenantHeaders(tenantId),
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
    // The tenants list too: the member may be the caller, whose permissions just changed.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: membersKey(tenantId) }),
        queryClient.invalidateQueries({ queryKey: tenantsQuery.queryKey }),
      ]),
    onError: (error) => refetchOnRefusal(queryClient, tenantId, error),
  })
}

/** `leaving` when the member is the caller, who then has no access to anything cached for this organization. */
export function useRemoveMember() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ membershipId }: { membershipId: string; leaving: boolean }) => {
      const { error, response } = await api.DELETE('/api/v1/members/{membershipId}', {
        params: { path: { membershipId } },
        headers: tenantHeaders(tenantId),
      })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSuccess: (_data, { leaving }) => {
      if (leaving) {
        queryClient.removeQueries({ queryKey: tenantKey(tenantId) })
        queryClient.removeQueries({ queryKey: tenantsQuery.queryKey })
        return
      }
      return queryClient.invalidateQueries({ queryKey: membersKey(tenantId) })
    },
    onError: (error) => refetchOnRefusal(queryClient, tenantId, error),
  })
}

/** 409 while a live invitation for the address is pending. */
export function useInviteMember() {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { email: string; role: RoleName }) => {
      const { error, response } = await api.POST('/api/v1/invitations', { body, headers: tenantHeaders(tenantId) })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsKey(tenantId) }),
    onError: (error) => refetchOnRefusal(queryClient, tenantId, error),
  })
}

/** Mints a new token with a fresh expiry: the link sent before stops working. */
export function useResendInvitation() {
  return useInvitationAction('resend')
}

/** Frees the address to be invited again. */
export function useCancelInvitation() {
  return useInvitationAction('cancel')
}

function useInvitationAction(action: 'resend' | 'cancel') {
  const tenantId = useTenantId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const options = { params: { path: { invitationId } }, headers: tenantHeaders(tenantId) }
      const { error, response } =
        action === 'resend'
          ? await api.POST('/api/v1/invitations/{invitationId}/resend', options)
          : await api.POST('/api/v1/invitations/{invitationId}/cancel', options)
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSettled: (_data, error) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: invitationsKey(tenantId) }),
        refetchOnRefusal(queryClient, tenantId, error),
      ]),
  })
}
