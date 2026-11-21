import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fallbackMessage } from '@/lib/form-errors'
import { formatDateTime, formatRelative } from '@/lib/format'
import { TableError, TableSkeleton } from './TableStates'
import { useCancelInvitation, useInvitations, useResendInvitation, type Invitation } from './queries'
import { roleLabel } from './roles'
import { useExplainRefusal } from './useExplainRefusal'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

type Action = 'resend' | 'cancel'

export function InvitationsTable({ onInvite }: { onInvite: () => void }) {
  const invitations = useInvitations()
  const [acting, setActing] = useState<{ action: Action; invitation: Invitation } | null>(null)

  if (invitations.isPending) {
    return <TableSkeleton label="Loading invitations" />
  }
  if (invitations.isError) {
    return <TableError message="Couldn't load invitations." onRetry={() => void invitations.refetch()} />
  }
  if (invitations.data.length === 0) {
    return (
      <section aria-label="Invitations" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
        <p className="text-muted-foreground">No invitations are waiting to be accepted.</p>
        <Button onClick={onInvite}>Invite someone</Button>
      </section>
    )
  }

  return (
    <section aria-label="Invitations" className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Email</TableHead>
              <TableHead className="w-28 px-4">Role</TableHead>
              <TableHead className="hidden w-32 px-4 xl:table-cell">Sent</TableHead>
              <TableHead className="w-44 px-4">Expires</TableHead>
              <TableHead className="w-44 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.data.map((invitation) => {
              const expired = invitation.status === 'EXPIRED'
              return (
                <TableRow key={invitation.id}>
                  <TableCell className="px-4 py-2.5">
                    <div className="font-medium">{invitation.email}</div>
                    {invitation.invitedByEmail && (
                      <div className="text-sm text-muted-foreground">Invited by {invitation.invitedByEmail}</div>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-ink-secondary">{roleLabel(invitation.role)}</TableCell>
                  <TableCell
                    className="hidden px-4 text-muted-foreground xl:table-cell"
                    title={formatDateTime(invitation.createdAt)}
                  >
                    {formatRelative(invitation.createdAt)}
                  </TableCell>
                  <TableCell
                    className={expired ? 'px-4 text-warning' : 'px-4 text-muted-foreground'}
                    title={formatDateTime(invitation.expiresAt)}
                  >
                    {expired ? `Expired ${formatRelative(invitation.expiresAt)}` : formatRelative(invitation.expiresAt)}
                  </TableCell>
                  <TableCell className="px-4 text-right whitespace-nowrap">
                    <Button
                      variant={expired ? 'outline' : 'ghost'}
                      size="sm"
                      aria-label={`Resend invitation to ${invitation.email}`}
                      onClick={() => setActing({ action: 'resend', invitation })}
                    >
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Cancel invitation to ${invitation.email}`}
                      onClick={() => setActing({ action: 'cancel', invitation })}
                    >
                      Cancel
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {acting && (
        <InvitationActionDialog
          key={`${acting.action}-${acting.invitation.id}`}
          action={acting.action}
          invitation={acting.invitation}
          onClose={() => setActing(null)}
        />
      )}
    </section>
  )
}

interface InvitationActionDialogProps {
  action: Action
  invitation: Invitation
  onClose: () => void
}

function InvitationActionDialog({ action, invitation, onClose }: InvitationActionDialogProps) {
  const resend = useResendInvitation()
  const cancel = useCancelInvitation()
  const mutation = action === 'resend' ? resend : cancel
  const explainRefusal = useExplainRefusal()
  const [failure, setFailure] = useState<string>()
  const { email } = invitation

  async function confirmAction() {
    setFailure(undefined)
    try {
      await mutation.mutateAsync(invitation.id)
      toast.success(action === 'resend' ? `New invitation sent to ${email}` : `Invitation to ${email} cancelled`)
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        const failed = action === 'resend' ? "Couldn't resend the invitation." : "Couldn't cancel the invitation."
        toast.error(explainRefusal(error) ?? `${failed} ${fallbackMessage(error)}`)
        onClose()
      } else {
        setFailure(fallbackMessage(error))
      }
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action === 'resend' ? `Resend the invitation to ${email}?` : `Cancel the invitation to ${email}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action === 'resend'
              ? 'A new link will be sent. The previous one stops working.'
              : 'The link they were sent stops working. You can invite them again later.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{action === 'resend' ? 'Cancel' : 'Keep it'}</AlertDialogCancel>
          <Button
            className={action === 'cancel' ? DANGER : undefined}
            disabled={mutation.isPending}
            onClick={() => void confirmAction()}
          >
            {mutation.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {action === 'resend' ? 'Resend invitation' : 'Cancel invitation'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
