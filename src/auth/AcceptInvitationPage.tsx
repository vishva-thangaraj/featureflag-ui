import { useState, useSyncExternalStore } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { highestRole } from '@/features/members/roles'
import { useCountdown } from '@/hooks/useCountdown'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { tenantsQuery } from '@/tenant/queries'
import { AuthLayout } from './AuthLayout'
import { useAcceptInvitation, useDeclineInvitation, useInvitation, useInviteeAccount, useMe } from './queries'
import { adoptSession, getSessionStatus, subscribe } from './session'
import { signOut } from './signOut'

type AuthResponse = components['schemas']['AuthResponse']
type OnAccepted = (auth: AuthResponse) => Promise<void>

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

// The lookup returns only a status, so the page can't yet say which organization or role.
const INVITED = "You've been invited to join an organization."

const CLOSED: Record<string, { title: string; description: string }> = {
  INVALID: {
    title: "This invitation link doesn't work",
    description: 'It may have been replaced by a newer invitation. Ask whoever invited you to send it again.',
  },
  EXPIRED: { title: 'This invitation has expired', description: 'Ask whoever invited you to send a new one.' },
  ACCEPTED: {
    title: 'This invitation has already been accepted',
    description: 'Each invitation works once. If it was you, the organization is in your list.',
  },
  DECLINED: {
    title: 'This invitation was declined',
    description: 'If you still want to join, ask whoever invited you to send a new one.',
  },
  CANCELLED: {
    title: 'This invitation was cancelled',
    description: 'Ask whoever invited you whether you should still join.',
  },
  USED: {
    title: 'This invitation has already been used',
    description: 'It was accepted or declined. Ask whoever invited you if you still need to join.',
  },
}

const UNUSABLE = { title: "This invitation can't be used", description: 'Ask whoever invited you to send a new one.' }

// The lookup never reports expiry, and accepting answers 401 both for an expired token and for "sign in
// first", so only the message (invitation.expired in the server's messages.properties) tells them apart.
const EXPIRED_MESSAGE = 'Invitation token has expired'

/** Outside both auth guards: the invitee may be signed in, signed out, or have no account yet. */
export function AcceptInvitationPage() {
  const session = useSyncExternalStore(subscribe, getSessionStatus)
  const [params] = useSearchParams()
  const token = params.get('token')

  if (session === 'restoring') {
    return <PageSkeleton />
  }
  if (!token) {
    return (
      <AuthLayout
        title="This invitation link is incomplete"
        description="Open the link in your invitation email again. If it still doesn't work, ask whoever invited you to send a new one."
      >
        <Onward signedIn={session === 'signedIn'} />
      </AuthLayout>
    )
  }
  return <InvitationFlow key={token} token={token} signedIn={session === 'signedIn'} />
}

function InvitationFlow({ token, signedIn }: { token: string; signedIn: boolean }) {
  const invitation = useInvitation(token)
  const { joining, join } = useJoin()

  // Accepting signs the invitee in, which would otherwise swap the form for the Join button mid-way.
  if (joining) {
    return <PageSkeleton />
  }
  if (!invitation.data) {
    if (!invitation.isError) {
      return <PageSkeleton />
    }
    if (invitation.error instanceof ApiError && invitation.error.status === 401) {
      return <Closed reason="INVALID" signedIn={signedIn} />
    }
    return <LoadFailed error={invitation.error} onRetry={() => void invitation.refetch()} />
  }
  if (invitation.data.status !== 'PENDING') {
    return <Closed reason={invitation.data.status} signedIn={signedIn} />
  }
  return signedIn ? <JoinSignedIn token={token} onAccepted={join} /> : <JoinSignedOut token={token} onAccepted={join} />
}

/** The response's session is already scoped to the organization joined: adopt it and go straight there. */
function useJoin() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)

  async function join(auth: AuthResponse) {
    setJoining(true)
    adoptSession(auth)
    let name: string | undefined
    try {
      // Fetched afresh: a cached list predates this membership, and the organization page would refuse it.
      const tenants = await queryClient.fetchQuery({ ...tenantsQuery, staleTime: 0 })
      name = tenants.find((tenant) => tenant.id === auth.tenantId)?.name
    } catch {
      // The organization page reports it if the list still won't load.
    }
    const role = highestRole(auth.roles)
    toast.success(`You've joined ${name ?? 'the organization'}${role ? ` as ${role.label}` : ''}.`)
    navigate(auth.tenantId ? `/t/${auth.tenantId}/flags` : '/', { replace: true })
  }

  return { joining, join }
}

function JoinSignedIn({ token, onAccepted }: { token: string; onAccepted: OnAccepted }) {
  const accept = useAcceptInvitation(token)
  const [refusal, setRefusal] = useState<'another-address' | 'expired'>()
  const [failure, setFailure] = useState<string>()

  async function join() {
    setFailure(undefined)
    try {
      const result = await accept.mutateAsync(undefined)
      if (result.status === 'ACCEPTED' && result.authResponse) {
        await onAccepted(result.authResponse)
      } else {
        // PENDING_UNREGISTERED: the invited address has no account, so it isn't the signed-in one.
        setRefusal('another-address')
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined
      if (status === 403) {
        setRefusal('another-address')
      } else if (status === 401) {
        setRefusal('expired')
      } else if (status !== 409) {
        // A 409 refetches the invitation, whose new status replaces this page.
        setFailure(fallbackMessage(error))
      }
    }
  }

  if (refusal === 'another-address') {
    return <AnotherAddress />
  }
  if (refusal === 'expired') {
    return <Closed reason="EXPIRED" signedIn />
  }
  return (
    <AuthLayout title="Join the organization" description={INVITED} footer={<Decline token={token} />}>
      <div className="flex flex-col gap-4">
        <FormError message={failure} />
        <Button className="h-9" disabled={accept.isPending} onClick={() => void join()}>
          {accept.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Join organization
        </Button>
      </div>
    </AuthLayout>
  )
}

function AnotherAddress() {
  const me = useMe()
  return (
    <AuthLayout
      title="This invitation is for another address"
      description={me.data ? `You're signed in as ${me.data.email}. Sign out to accept it.` : 'Sign out to accept it.'}
    >
      <Button className="h-9 w-full" onClick={signOut}>
        Sign out
      </Button>
    </AuthLayout>
  )
}

function JoinSignedOut({ token, onAccepted }: { token: string; onAccepted: OnAccepted }) {
  const account = useInviteeAccount(token)
  const location = useLocation()

  if (account.data) {
    return account.data.status === 'PENDING_UNREGISTERED' ? (
      <RegisterToAccept token={token} onAccepted={onAccepted} />
    ) : (
      <Closed reason={account.data.status} signedIn={false} />
    )
  }
  if (account.isError) {
    const status = account.error instanceof ApiError ? account.error.status : undefined
    if (status === 401 && account.error.message === EXPIRED_MESSAGE) {
      return <Closed reason="EXPIRED" signedIn={false} />
    }
    if (status === 401) {
      const next = encodeURIComponent(location.pathname + location.search)
      return (
        <AuthLayout
          title="Sign in to accept"
          description={`${INVITED} Sign in with the address it was sent to, and you'll come straight back here to join.`}
          footer={<Decline token={token} />}
        >
          <Button asChild className="h-9 w-full">
            <Link to={`/login?next=${next}`}>Sign in</Link>
          </Button>
        </AuthLayout>
      )
    }
    if (status === 409) {
      return <Closed reason="USED" signedIn={false} />
    }
    return <LoadFailed error={account.error} onRetry={() => void account.refetch()} />
  }
  return <PageSkeleton />
}

const registerSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name'),
  lastName: z.string().trim(),
  email: z.email('Enter an email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters'),
})

type RegisterValues = z.infer<typeof registerSchema>

const FIELDS = ['firstName', 'lastName', 'email', 'password'] as const

function RegisterToAccept({ token, onAccepted }: { token: string; onAccepted: OnAccepted }) {
  const accept = useAcceptInvitation(token)
  const [expired, setExpired] = useState(false)
  const [retryIn, setRetryIn] = useCountdown()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
  })

  const onSubmit = handleSubmit(async ({ lastName, ...values }) => {
    try {
      const result = await accept.mutateAsync({ ...values, lastName: lastName || undefined })
      if (result.authResponse) {
        await onAccepted(result.authResponse)
      } else {
        setError('root.server', { message: result.message })
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined
      if (status === 403) {
        setError('email', { message: 'Use the address this invitation was sent to.' })
      } else if (status === 401) {
        setExpired(true)
      } else if (!applyFieldErrors(error, setError, FIELDS)) {
        setError('root.server', { message: fallbackMessage(error) })
      }
      if (error instanceof ApiError && error.retryAfter) {
        setRetryIn(error.retryAfter)
      }
    }
  })

  if (expired) {
    return <Closed reason="EXPIRED" signedIn={false} />
  }
  return (
    <AuthLayout
      title="Create your account to join"
      description={`${INVITED} Create an account with the address it was sent to.`}
      footer={<Decline token={token} />}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={errors.root?.server?.message} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" autoComplete="given-name" error={errors.firstName?.message} {...register('firstName')} />
          <TextField label="Last name" optional autoComplete="family-name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          hint="The address this invitation was sent to."
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="8 to 128 characters."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" className="h-9" disabled={isSubmitting || retryIn > 0}>
          {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {retryIn > 0 ? `Try again in ${retryIn} s` : 'Create account and join'}
        </Button>
      </form>
    </AuthLayout>
  )
}

/** Can't be taken back: the link stops working, and joining later takes a new invitation. */
function Decline({ token }: { token: string }) {
  const decline = useDeclineInvitation(token)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string>()

  async function confirmDecline() {
    setFailure(undefined)
    try {
      // On success the refetched status replaces this page with the declined one.
      await decline.mutateAsync()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConfirming(false)
      } else {
        setFailure(fallbackMessage(error))
      }
    }
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className="font-medium text-link">
        Decline invitation
      </button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The link stops working. To join later, you'll need a new invitation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button className={DANGER} disabled={decline.isPending} onClick={() => void confirmDecline()}>
              {decline.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              Decline invitation
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Closed({ reason, signedIn }: { reason: string; signedIn: boolean }) {
  const { title, description } = CLOSED[reason] ?? UNUSABLE
  return (
    <AuthLayout title={title} description={description}>
      <Onward signedIn={signedIn} />
    </AuthLayout>
  )
}

function Onward({ signedIn }: { signedIn: boolean }) {
  return (
    <Button asChild variant="outline" className="h-9 w-full">
      {signedIn ? <Link to="/orgs">Go to your organizations</Link> : <Link to="/login">Sign in</Link>}
    </Button>
  )
}

function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <AuthLayout title="Couldn't load this invitation" description={fallbackMessage(error)}>
      <Button variant="outline" className="h-9 w-full" onClick={onRetry}>
        Try again
      </Button>
    </AuthLayout>
  )
}
