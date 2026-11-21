import createClient from 'openapi-fetch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components, paths } from '@/api/schema'

type RegisterRequest = components['schemas']['RegisterRequest']

/** The signed-in user. Not tenant-scoped. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/v1/auth/me')
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

// The invitee's endpoints are public. Calls that must go out without a session use a client without the
// bearer middleware: sent with a token, a bodyless accept would join instead of asking.
const anonymous = createClient<paths>({ baseUrl: window.location.origin })

// An accepted invitation answers with a session, so it asks for the refresh token as a cookie, as sign-in does.
const COOKIE_TRANSPORT = { 'X-Refresh-Transport': 'cookie' }

const invitationKey = (token: string) => ['invitation', token] as const

// Read once and changed only by this page's own actions, so a background refetch can't swap a half-filled
// form for an error.
const READ_ONCE = { staleTime: Infinity, refetchOnWindowFocus: false } as const

/** Status only: the server doesn't say which organization, role or address. */
export function useInvitation(token: string) {
  return useQuery({
    ...READ_ONCE,
    queryKey: invitationKey(token),
    queryFn: async () => {
      const { data, error, response } = await anonymous.GET('/api/v1/invitations/{inviteToken}', {
        params: { path: { inviteToken: token } },
      })
      if (!data) {
        throw new ApiError(response, error)
      }
      return data
    },
  })
}

async function postAccept(client: typeof api, token: string, registration?: RegisterRequest) {
  const { data, error, response } = await client.POST('/api/v1/invitations/{inviteToken}/accept', {
    params: { path: { inviteToken: token } },
    body: registration,
    headers: COOKIE_TRANSPORT,
  })
  if (!data) {
    throw new ApiError(response, error)
  }
  return data
}

/**
 * Asks, anonymously and without a body, whether the invited address has an account: PENDING_UNREGISTERED
 * if not, 401 if it has. Either way nothing changes on the server.
 */
export function useInviteeAccount(token: string) {
  return useQuery({
    ...READ_ONCE,
    queryKey: [...invitationKey(token), 'account'],
    queryFn: () => postAccept(anonymous, token),
  })
}

/** With a registration, creates the invited account and joins as it; without one, joins as the signed-in user. */
export function useAcceptInvitation(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (registration?: RegisterRequest) =>
      registration ? postAccept(anonymous, token, registration) : postAccept(api, token),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // Accepted or declined meanwhile: the status says which.
        return queryClient.invalidateQueries({ queryKey: invitationKey(token), exact: true })
      }
    },
  })
}

export function useDeclineInvitation(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await anonymous.POST('/api/v1/invitations/{inviteToken}/decline', {
        params: { path: { inviteToken: token } },
      })
      if (!response.ok) {
        throw new ApiError(response, error)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitationKey(token), exact: true }),
  })
}
