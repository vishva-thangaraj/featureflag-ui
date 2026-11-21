import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { FormError } from '@/components/form/FormError'
import { TextField } from '@/components/form/TextField'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { applyFieldErrors, fallbackMessage } from '@/lib/form-errors'
import { useTenant } from '@/tenant/context'
import { useCancelInvitation, useInvitations, useInviteMember, useResendInvitation, type Invitation } from './queries'
import { grantableRoles, roleLabel } from './roles'
import { useExplainRefusal } from './useExplainRefusal'

const inviteSchema = z.object({
  email: z.email('Enter an email address'),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'], 'Choose a role'),
})

type InviteValues = z.infer<typeof inviteSchema>

/** The invitation already pending for the address, when the server refused a second one. */
interface Duplicate {
  values: InviteValues
  existing: Invitation | undefined
}

export function InviteMemberSheet({ onClose }: { onClose: () => void }) {
  const tenant = useTenant()
  // No Owner card: making an owner can't be undone, so it isn't a one-click choice here.
  const roles = grantableRoles(tenant.roles.map((role) => role.name)).filter((role) => role.name !== 'OWNER')
  const invitations = useInvitations()
  const invite = useInviteMember()
  const resend = useResendInvitation()
  const cancel = useCancelInvitation()
  const explainRefusal = useExplainRefusal()
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)
  const idPrefix = useId()
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    mode: 'onTouched',
    defaultValues: { email: '', role: 'MEMBER' },
  })

  const email = useWatch({ control, name: 'email' })
  const busy = isSubmitting || invite.isPending || resend.isPending || cancel.isPending

  function fail(error: unknown) {
    const explanation = explainRefusal(error)
    if (explanation) {
      toast.error(explanation)
      onClose()
    } else if (!applyFieldErrors(error, setError, ['email', 'role'])) {
      setError('root.server', { message: fallbackMessage(error) })
    }
  }

  async function sendInvitation(values: InviteValues) {
    await invite.mutateAsync(values)
    toast.success(`Invitation sent to ${values.email}`)
    onClose()
  }

  const onSubmit = handleSubmit(async (values) => {
    setDuplicate(null)
    try {
      await sendInvitation(values)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Another admin may have sent it since this list loaded.
        const { data } = await invitations.refetch()
        const match = data?.find(
          (invitation) => invitation.status === 'PENDING' && invitation.email.toLowerCase() === values.email.toLowerCase(),
        )
        setDuplicate({ values, existing: match })
      } else {
        fail(error)
      }
    }
  })

  async function resendExisting(existing: Invitation) {
    try {
      await resend.mutateAsync(existing.id)
      toast.success(`New invitation sent to ${existing.email}`)
      onClose()
    } catch (error) {
      setDuplicate(null)
      fail(error)
    }
  }

  async function replaceExisting(existing: Invitation, values: InviteValues) {
    try {
      await cancel.mutateAsync(existing.id)
      await sendInvitation(values)
    } catch (error) {
      setDuplicate(null)
      fail(error)
    }
  }

  // Only while the address it was about is still the one in the field.
  const shownDuplicate = duplicate && duplicate.values.email === email ? duplicate : null
  const existing = shownDuplicate?.existing

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Invite a member</SheetTitle>
          <SheetDescription>They'll get an email with a link to join {tenant.name}.</SheetDescription>
        </SheetHeader>
        <form
          id="invite-form"
          onSubmit={onSubmit}
          noValidate
          className="flex flex-1 flex-col gap-5 overflow-y-auto px-4"
        >
          <FormError message={errors.root?.server?.message} />
          <TextField label="Email" type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />

          {shownDuplicate && (
            <div role="alert" className="flex flex-col gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-sm text-warning">
              <p>
                {shownDuplicate.values.email} already has a pending invitation
                {existing ? ` as ${roleLabel(existing.role)}` : ''}.
              </p>
              {existing && (
                <>
                  <p>Resending sends a new link, and the previous one stops working.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void resendExisting(existing)}
                    >
                      Resend it
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void replaceExisting(existing, shownDuplicate.values)}
                    >
                      Cancel it and invite again
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={errors.role ? `${idPrefix}-role-error` : undefined}
          >
            <legend className="mb-1.5 text-sm font-medium">Role</legend>
            {roles.map((role) => (
              <label
                key={role.name}
                className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-checked:border-primary has-checked:bg-primary-soft has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  value={role.name}
                  aria-labelledby={`${idPrefix}-${role.name}-label`}
                  aria-describedby={`${idPrefix}-${role.name}`}
                  className="mt-1 accent-primary outline-none"
                  {...register('role')}
                />
                <span className="flex flex-col gap-0.5">
                  <span id={`${idPrefix}-${role.name}-label`} className="font-medium">
                    {role.label}
                  </span>
                  <span id={`${idPrefix}-${role.name}`} className="text-sm text-muted-foreground">
                    {role.description}
                  </span>
                </span>
              </label>
            ))}
            {errors.role?.message && (
              <p id={`${idPrefix}-role-error`} className="text-sm text-destructive">
                {errors.role.message}
              </p>
            )}
          </fieldset>
        </form>
        <SheetFooter className="flex-row justify-end border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" disabled={busy}>
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Send invitation
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
