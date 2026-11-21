import { useState } from 'react'
import { useNavigate } from 'react-router'
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
import { fallbackMessage } from '@/lib/form-errors'
import { useTenant } from '@/tenant/context'
import { memberName, useRemoveMember, type Member } from './queries'
import { useExplainRefusal } from './useExplainRefusal'

const DANGER = 'bg-danger-strong text-white hover:bg-danger-strong/90'

interface RemoveMemberDialogProps {
  member: Member
  /** The member is the caller. */
  leaving: boolean
  onClose: () => void
}

export function RemoveMemberDialog({ member, leaving, onClose }: RemoveMemberDialogProps) {
  const tenant = useTenant()
  const navigate = useNavigate()
  const removeMember = useRemoveMember()
  const explainRefusal = useExplainRefusal()
  const [failure, setFailure] = useState<string>()
  const name = memberName(member)

  async function confirmRemove() {
    setFailure(undefined)
    try {
      await removeMember.mutateAsync({ membershipId: member.membershipId, leaving })
      if (leaving) {
        toast.success(`You left ${tenant.name}`)
        navigate('/', { replace: true })
      } else {
        toast.success(`${name} removed`)
        onClose()
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        toast.error(explainRefusal(error) ?? `Couldn't remove ${name}. ${fallbackMessage(error)}`)
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
          <AlertDialogTitle>{leaving ? `Leave ${tenant.name}?` : `Remove ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {leaving
              ? 'You lose access to its flags, environments and API keys straight away. Only an owner or admin can invite you back.'
              : `${member.email} loses access to ${tenant.name} straight away. You can invite them again later.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button className={DANGER} disabled={removeMember.isPending} onClick={() => void confirmRemove()}>
            {removeMember.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {leaving ? 'Leave organization' : 'Remove member'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
